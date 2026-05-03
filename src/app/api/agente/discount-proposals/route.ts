import { generateText } from 'ai'
import { ANALYSIS_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { queryChannelKPIs } from '@/lib/automo/channel-kpis'
import { toApiDate } from '@/lib/kpis/period'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DiscountProposalRow {
  canal:                  string   // 'guia_moteis'
  categoria:              string
  periodo:                string   // nome exato do período (conforme tabela importada)
  /** Dia da semana específico (ex: "segunda", "domingo") — formato da tabela de descontos */
  dia_semana?:            string
  /** Fallback legado: "semana" | "fds_feriado" | "todos" */
  dia_tipo?:              string
  faixa_horaria?:         string
  desconto_atual_pct:     number
  desconto_proposto_pct:  number
  variacao_pts:           number   // pontos percentuais de variação
  preco_base:             number
  preco_efetivo_atual:    number
  preco_efetivo_proposto: number
  justificativa:          string
}

export interface DiscountProposal {
  id:          string
  unit_id:     string
  status:      'pending' | 'approved' | 'rejected'
  context:     string | null
  rows:        DiscountProposalRow[]
  created_at:  string
  reviewed_at: string | null
  conv_id:     string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function extractJSON(text: string): { context: string; rows: DiscountProposalRow[] } | null {
  const clean = text.trim()
  const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = codeBlock ? codeBlock[1] : clean

  const start = candidate.indexOf('{')
  if (start === -1) return null

  let depth = 0, end = -1
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++
    else if (candidate[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null

  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch { return null }
}

// ─── GET: lista propostas de desconto da unidade ──────────────────────────────

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams
  const unitSlug = sp.get('unitSlug')
  if (!unitSlug) return NextResponse.json({ error: 'unitSlug obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('discount_proposals')
    .select('*')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposals: data ?? [] })
}

// ─── POST: gera proposta de desconto via IA ───────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, unit_id').eq('user_id', user.id).single()
  if (!profile || profile.role === 'viewer')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await req.json() as { unitSlug?: string }
  const { unitSlug } = body

  const admin = getAdminClient()

  // Resolve unidade
  let unit: { id: string; name: string; slug: string } | null = null
  if (unitSlug) {
    const { data } = await admin.from('units').select('id,name,slug').eq('slug', unitSlug).eq('is_active', true).single()
    unit = data
  }
  if (!unit && profile.unit_id) {
    const { data } = await admin.from('units').select('id,name,slug').eq('id', profile.unit_id).single()
    unit = data
  }
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  // Busca tabela de preços ativa
  const { data: activeImport } = await admin
    .from('price_imports')
    .select('id, valid_from, valid_until, parsed_data, discount_data')
    .eq('unit_id', unit.id)
    .eq('import_type', 'prices')
    .lte('valid_from', new Date().toISOString().split('T')[0])
    .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().split('T')[0])
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()

  // Busca tabela de descontos ativa
  const { data: activeDiscountImport } = await admin
    .from('price_imports')
    .select('id, valid_from, discount_data')
    .eq('unit_id', unit.id)
    .eq('import_type', 'discounts')
    .lte('valid_from', new Date().toISOString().split('T')[0])
    .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().split('T')[0])
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()

  // Busca guardrails
  const { data: guardrails } = await admin
    .from('agent_price_guardrails')
    .select('categoria, periodo, preco_minimo, preco_maximo')
    .eq('unit_id', unit.id)

  // Busca KPIs por canal dos últimos 30 dias
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const endDate   = toApiDate(today)
  const startDate = toApiDate(thirtyDaysAgo)

  const channelKPIs = await queryChannelKPIs(unit.slug, startDate, endDate).catch(() => [])

  // Monta contexto de preços (todos os canais — usados como referência de preço base)
  type ParsedRow = { canal: string; categoria: string; periodo: string; dia_tipo: string; preco: number }
  const allPriceRows: ParsedRow[] = (activeImport?.parsed_data as unknown as ParsedRow[] ?? [])
  const priceRows = allPriceRows.filter((r) => r.canal === 'guia_moteis')

  type DiscountRow = {
    categoria: string; periodo: string
    dia_tipo?: string; dia_semana?: string; faixa_horaria?: string
    valor: number; tipo_desconto: string
  }
  const discountRows: DiscountRow[] = [
    ...((activeImport?.discount_data as unknown as DiscountRow[]) ?? []),
    ...((activeDiscountImport?.discount_data as unknown as DiscountRow[]) ?? []),
  ]

  // Normaliza nomes de período: "3h" → "3 HORAS" etc. para fazer lookup no mapa de preços
  function normPeriodo(p: string): string {
    const s = p.trim().toUpperCase()
    if (s === '3H' || s === '3 H' ) return '3 HORAS'
    if (s === '6H' || s === '6 H' ) return '6 HORAS'
    if (s === '12H' || s === '12 H') return '12 HORAS'
    return s
  }
  // Mapeia dia_semana (nome do dia) para dia_tipo (semana/fds_feriado)
  function diaParaTipo(d?: string): 'semana' | 'fds_feriado' {
    if (!d) return 'semana'
    const s = d.toLowerCase().trim()
    if (s === 'sexta' || s === 'sábado' || s === 'sabado' || s === 'domingo') return 'fds_feriado'
    return 'semana'
  }

  // Mapa de preço base: "canal|PERIODO_NORMALIZADO|dia_tipo" → preco
  const priceMap = new Map<string, number>()
  for (const r of allPriceRows) {
    priceMap.set(`${r.canal}|${normPeriodo(r.periodo)}|${r.dia_tipo ?? 'todos'}`, r.preco)
  }

  // Lookup de preço base para uma linha de desconto: tenta balcao_site se guia_moteis não encontrar
  function getPrecoBase(cat: string, periodo: string, diaSemana?: string): number {
    const pNorm = normPeriodo(periodo)
    const tipo  = diaParaTipo(diaSemana)
    return (
      priceMap.get(`guia_moteis|${pNorm}|${tipo}`) ??
      priceMap.get(`balcao_site|${pNorm}|${tipo}`) ??
      priceMap.get(`guia_moteis|${pNorm}|todos`) ??
      priceMap.get(`balcao_site|${pNorm}|todos`) ??
      0
    )
    void cat
  }

  // Mapa de desconto atual: "categoria|periodo|dia_semana|faixa" → valor%
  const discountMap = new Map<string, number>()
  for (const d of discountRows) {
    if (d.tipo_desconto === 'percentual') {
      const key = `${d.categoria}|${d.periodo}|${d.dia_semana ?? d.dia_tipo ?? 'todos'}|${d.faixa_horaria ?? ''}`
      discountMap.set(key, d.valor)
    }
  }

  const guiaCanal     = channelKPIs.find((c) => c.canal === 'GUIA_GO' || c.canal === 'GUIA_SCHEDULED')
  const internalCanal = channelKPIs.find((c) => c.canal === 'INTERNAL')
  const totalReceita  = channelKPIs.reduce((s, c) => s + c.receita, 0)

  const channelCtx = channelKPIs.length
    ? `### Desempenho por canal (últimos 30 dias)
| Canal | Reservas | Receita | Ticket | % Total |
|-------|----------|---------|--------|---------|
${channelKPIs.map((c) => `| ${c.label} | ${c.reservas} | R$ ${c.receita.toFixed(2)} | R$ ${c.ticket.toFixed(2)} | ${c.representatividade.toFixed(1)}% |`).join('\n')}

Receita total canais: R$ ${totalReceita.toFixed(2)}
Guia de Motéis (Go+Prog): ${guiaCanal ? `${guiaCanal.representatividade.toFixed(1)}% do total` : 'sem dados'}
Balcão/Interno: ${internalCanal ? `${internalCanal.representatividade.toFixed(1)}% do total` : 'sem dados'}`
    : ''

  // Tabela de descontos atual — base para a proposta
  const discountCtx = discountRows.length
    ? `### Tabela de descontos atual (Guia de Motéis)
| Categoria | Período | Dia | Horário | Desconto atual | Preço base | Preço efetivo |
|-----------|---------|-----|---------|----------------|------------|---------------|
${discountRows.map((d) => {
  const pb   = getPrecoBase(d.categoria, d.periodo, d.dia_semana)
  const desc = d.tipo_desconto === 'percentual' ? d.valor : 0
  const ef   = pb > 0 ? pb * (1 - desc / 100) : 0
  const dia  = d.dia_semana ?? d.dia_tipo ?? '—'
  const hora = d.faixa_horaria ?? '—'
  return `| ${d.categoria} | ${d.periodo} | ${dia} | ${hora} | ${desc}% | ${pb > 0 ? `R$ ${pb.toFixed(2)}` : '—'} | ${ef > 0 ? `R$ ${ef.toFixed(2)}` : '—'} |`
}).join('\n')}`
    : 'Sem tabela de descontos importada para esta unidade.'

  const guardrailCtx = guardrails?.length
    ? `### Guardrails (preço mínimo/máximo)\n| Categoria | Período | Mínimo | Máximo |\n|-----------|---------|--------|--------|\n${guardrails.map((g) => `| ${g.categoria} | ${g.periodo} | R$ ${g.preco_minimo?.toFixed(2) ?? '—'} | R$ ${g.preco_maximo?.toFixed(2) ?? '—'} |`).join('\n')}`
    : ''

  // Mapa de linhas de desconto para COBERTURA TOTAL
  const discountRowsBlock = discountRows.map((d) =>
    `${d.categoria}|${d.periodo}|${d.dia_semana ?? d.dia_tipo ?? 'todos'}|${d.faixa_horaria ?? ''} = ${d.valor}%`
  ).join('\n')

  const validPeriodos = [...new Set(discountRows.map((r) => r.periodo))].join(' | ')
  const validDias     = [...new Set(discountRows.map((r) => r.dia_semana ?? r.dia_tipo ?? ''))].filter(Boolean).join(' | ')

  const prompt = `Você é um especialista em Revenue Management de motéis. Analise os dados abaixo e gere uma proposta de ajuste de **desconto** para o canal Guia de Motéis de ${unit.name}.

${channelCtx}

${discountCtx}

${guardrailCtx ? `${guardrailCtx}\n` : ''}
## Mapa de descontos atuais (referência para preco_base e desconto_atual_pct no JSON)
${discountRowsBlock}

---

## Critérios de decisão
- Se o Guia de Motéis representa < 15% da receita total → avaliar aumento de desconto para atrair mais volume
- Se o Guia representa > 40% da receita → avaliar redução de desconto (canal já performando bem)
- O preço efetivo (base × (1 − desconto/100)) NUNCA pode ficar abaixo do guardrail mínimo
- Prefira ajustes graduais (±2 a ±5 pontos percentuais) — evite variações bruscas

## Cobertura da proposta
Inclua APENAS as linhas com alteração de desconto (variacao_pts ≠ 0). Para categorias/períodos sem mudança, NÃO liste linha por linha — mencione no campo \`context\` quais foram mantidos e o motivo.

## Valores válidos para o JSON (copie EXATAMENTE)
- **periodo**: ${validPeriodos}
- **dia_semana**: ${validDias}

⚠️ REGRA CRÍTICA SOBRE O CAMPO DIA: use SEMPRE o campo \`dia_semana\` com o nome exato do dia da semana conforme aparece na coluna "Dia" do mapa acima (ex: "segunda", "terca", "domingo"). NUNCA use o campo \`dia_tipo\` na saída (semana/fds_feriado são conceitos da tabela de preços, não da tabela de descontos).

## Formato obrigatório (JSON minificado, sem texto fora do JSON)
{"context":"Resumo: quais categorias/dias foram alterados e por quê; quais foram mantidos","rows":[{"canal":"guia_moteis","categoria":"LUSH POP","periodo":"3h","dia_semana":"segunda","faixa_horaria":"00:00-23:59","desconto_atual_pct":30,"desconto_proposto_pct":25,"variacao_pts":-5,"preco_base":150.00,"preco_efetivo_atual":105.00,"preco_efetivo_proposto":112.50,"justificativa":"motivo específico"}]}`

  let parsed: { context: string; rows: DiscountProposalRow[] } | null = null

  try {
    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      ...gatewayOptions,
      prompt,
      maxOutputTokens: 8000,
    })
    parsed = extractJSON(text)
  } catch (err) {
    console.error('[discount-proposals/POST] generateText falhou:', err)
    return NextResponse.json({ error: 'Falha ao gerar proposta com IA' }, { status: 502 })
  }

  if (!parsed?.rows?.length) {
    return NextResponse.json({ error: 'IA não retornou proposta válida' }, { status: 422 })
  }

  // Clamp pelo guardrail server-side
  if (guardrails?.length) {
    for (const row of parsed.rows) {
      const guard = guardrails.find(
        (g) => g.categoria === row.categoria && g.periodo === row.periodo
      )
      if (guard?.preco_minimo) {
        const efetivo = row.preco_base * (1 - row.desconto_proposto_pct / 100)
        if (efetivo < guard.preco_minimo) {
          row.desconto_proposto_pct = Math.max(
            0,
            +(100 * (1 - guard.preco_minimo / row.preco_base)).toFixed(1)
          )
          row.preco_efetivo_proposto = +(row.preco_base * (1 - row.desconto_proposto_pct / 100)).toFixed(2)
          row.variacao_pts = +(row.desconto_proposto_pct - row.desconto_atual_pct).toFixed(1)
        }
      }
    }
  }

  const { data: saved, error: saveError } = await admin
    .from('discount_proposals')
    .insert({
      unit_id: unit.id,
      context: parsed.context,
      rows:    parsed.rows as unknown as Database['public']['Tables']['discount_proposals']['Insert']['rows'],
      status:  'pending',
    })
    .select('id')
    .single()

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })
  return NextResponse.json({ proposal: { id: saved.id, ...parsed } }, { status: 201 })
}

// ─── PATCH: aprovar / rejeitar / editar linhas ────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single()
  if (!profile || profile.role === 'viewer')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await req.json() as {
    id: string
    status?: 'approved' | 'rejected'
    rows?: DiscountProposalRow[]
    rejection_reason_type?: string
    rejection_reason_text?: string
    rejected_items?: Array<{ categoria: string; periodo: string; dia_semana?: string; faixa_horaria?: string; motivo: string }>
  }
  const { id, status, rows } = body
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const VALID_DISCOUNT_REJECTION_REASONS = [
    'desconto_alto_demais', 'desconto_baixo_demais',
    'condicao_inadequada', 'momento_inadequado', 'outro',
  ]

  const admin = getAdminClient()

  if (status) {
    // Aprovar / rejeitar — exige admin+
    if (!['super_admin', 'admin'].includes(profile.role))
      return NextResponse.json({ error: 'Sem permissão para aprovar/rejeitar' }, { status: 403 })

    if (status === 'rejected') {
      if (!body.rejection_reason_type) {
        return NextResponse.json({ error: 'rejection_reason_type é obrigatório ao rejeitar' }, { status: 422 })
      }
      if (!VALID_DISCOUNT_REJECTION_REASONS.includes(body.rejection_reason_type)) {
        return NextResponse.json({ error: 'rejection_reason_type inválido' }, { status: 400 })
      }
    }

    const { data: proposal } = await admin
      .from('discount_proposals')
      .select('id, unit_id')
      .eq('id', id)
      .single()

    const { error } = await admin
      .from('discount_proposals')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        ...(status === 'rejected' ? {
          rejection_reason_type: body.rejection_reason_type ?? null,
          rejection_reason_text: body.rejection_reason_text ?? null,
          rejected_items: (body.rejected_items ?? null) as unknown as Database['public']['Tables']['discount_proposals']['Update']['rejected_items'],
        } : {}),
      })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (status === 'approved' && proposal) {
      const today = new Date().toISOString().slice(0, 10)
      const reviewDate = new Date()
      reviewDate.setDate(reviewDate.getDate() + 7)
      reviewDate.setUTCHours(13, 0, 0, 0)
      await admin.from('scheduled_reviews').insert({
        unit_id:      proposal.unit_id,
        created_by:   user.id,
        scheduled_at: reviewDate.toISOString(),
        note:         `Acompanhamento de descontos — verificar impacto da proposta de desconto aprovada em ${today} no volume e receita do canal Guia de Motéis.`,
        status:       'pending',
      })
    }

    return NextResponse.json({ ok: true })
  }

  if (rows) {
    // Edição de linhas de proposta pendente
    const rowsWithCalc = rows.map((r) => ({
      ...r,
      variacao_pts:           +(r.desconto_proposto_pct - r.desconto_atual_pct).toFixed(1),
      preco_efetivo_proposto: +(r.preco_base * (1 - r.desconto_proposto_pct / 100)).toFixed(2),
    }))

    const { error } = await admin
      .from('discount_proposals')
      .update({ rows: rowsWithCalc as unknown as Database['public']['Tables']['discount_proposals']['Update']['rows'] })
      .eq('id', id)
      .eq('status', 'pending')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Informe status ou rows' }, { status: 400 })
}

// ─── DELETE: remove proposta ──────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single()
  if (!profile || !['super_admin', 'admin'].includes(profile.role))
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await admin.from('discount_proposals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
