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
  periodo:                string   // '3h' | '6h' | '12h' | 'pernoite'
  dia_tipo:               string   // 'semana' | 'fds_feriado' | 'todos'
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

  // Monta contexto de preços
  type ParsedRow = { canal: string; categoria: string; periodo: string; dia_tipo: string; preco: number }
  const priceRows: ParsedRow[] = (activeImport?.parsed_data as unknown as ParsedRow[] ?? [])
    .filter((r) => r.canal === 'guia_moteis')

  type DiscountRow = { categoria: string; periodo: string; dia_tipo?: string; dia_semana?: string; faixa_horaria?: string; valor: number; tipo_desconto: string }
  const discountRows: DiscountRow[] = [
    ...((activeImport?.discount_data as unknown as DiscountRow[]) ?? []),
    ...((activeDiscountImport?.discount_data as unknown as DiscountRow[]) ?? []),
  ]

  // Constrói mapa base: categoria|periodo|dia_tipo → preco
  const priceMap = new Map<string, number>()
  for (const r of priceRows) {
    priceMap.set(`${r.categoria}|${r.periodo}|${r.dia_tipo ?? 'todos'}`, r.preco)
  }

  // Constrói mapa desconto atual: categoria|periodo|dia_tipo → desconto%
  const discountMap = new Map<string, number>()
  for (const d of discountRows) {
    if (d.tipo_desconto === 'percentual') {
      const key = `${d.categoria}|${d.periodo}|${d.dia_tipo ?? d.dia_semana ?? 'todos'}`
      discountMap.set(key, d.valor)
    }
  }

  const guiaCanal = channelKPIs.find((c) => c.canal === 'GUIA_GO' || c.canal === 'GUIA_SCHEDULED')
  const internalCanal = channelKPIs.find((c) => c.canal === 'INTERNAL')
  const totalReceita = channelKPIs.reduce((s, c) => s + c.receita, 0)

  const channelCtx = channelKPIs.length
    ? `### Desempenho por canal (últimos 30 dias)
| Canal | Reservas | Receita | Ticket | % Total |
|-------|----------|---------|--------|---------|
${channelKPIs.map((c) => `| ${c.label} | ${c.reservas} | R$ ${c.receita.toFixed(2)} | R$ ${c.ticket.toFixed(2)} | ${c.representatividade.toFixed(1)}% |`).join('\n')}

Receita total canais: R$ ${totalReceita.toFixed(2)}
Guia de Motéis (Go+Prog): ${guiaCanal ? `${guiaCanal.representatividade.toFixed(1)}% do total` : 'sem dados'}
Balcão/Interno: ${internalCanal ? `${internalCanal.representatividade.toFixed(1)}% do total` : 'sem dados'}`
    : ''

  const priceCtx = priceRows.length
    ? `### Tabela de preços base (canal Guia de Motéis)
| Categoria | Período | Dia | Preço base | Desconto atual | Preço efetivo |
|-----------|---------|-----|------------|----------------|---------------|
${priceRows.map((r) => {
  const key = `${r.categoria}|${r.periodo}|${r.dia_tipo ?? 'todos'}`
  const desc = discountMap.get(key) ?? 0
  const efetivo = r.preco * (1 - desc / 100)
  return `| ${r.categoria} | ${r.periodo} | ${r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos'} | R$ ${r.preco.toFixed(2)} | ${desc}% | R$ ${efetivo.toFixed(2)} |`
}).join('\n')}`
    : 'Sem tabela de preços para o canal Guia de Motéis.'

  const guardrailCtx = guardrails?.length
    ? `### Guardrails (preço mínimo/máximo)\n| Categoria | Período | Mínimo | Máximo |\n|-----------|---------|--------|--------|\n${guardrails.map((g) => `| ${g.categoria} | ${g.periodo} | R$ ${g.preco_minimo?.toFixed(2) ?? '—'} | R$ ${g.preco_maximo?.toFixed(2) ?? '—'} |`).join('\n')}`
    : ''

  const prompt = `Você é um especialista em Revenue Management de motéis. Analise os dados abaixo e gere uma proposta de ajuste de **desconto** para o canal Guia de Motéis de ${unit.name}.

${channelCtx}

${priceCtx}

${guardrailCtx}

## Critérios de decisão
- Se o Guia de Motéis representa < 15% da receita total → avaliar aumento de desconto para atrair mais volume
- Se o Guia representa > 40% da receita → avaliar redução de desconto (canal já performando bem)
- O preço efetivo (base × (1 − desconto/100)) NUNCA pode ficar abaixo do guardrail mínimo
- Prefira ajustes graduais (±2 a ±5 pontos percentuais) — evite variações bruscas
- Justifique cada linha com base nos dados de canal e demanda

Valores válidos para periodo (copie EXATAMENTE da tabela acima, nunca abrevie):
${[...new Set(priceRows.map((r) => r.periodo))].join(' | ')}

Gere UMA linha por combinação categoria × periodo × dia_tipo. Nunca agrupe períodos diferentes.

## Formato obrigatório (JSON puro, sem markdown)
{
  "context": "Resumo em 2-3 frases da lógica da proposta",
  "rows": [
    {
      "canal": "guia_moteis",
      "categoria": "Nome exato da categoria",
      "periodo": "6 horas",
      "dia_tipo": "semana",
      "desconto_atual_pct": 20,
      "desconto_proposto_pct": 25,
      "variacao_pts": 5,
      "preco_base": 100.00,
      "preco_efetivo_atual": 80.00,
      "preco_efetivo_proposto": 75.00,
      "justificativa": "Motivo específico baseado nos dados"
    }
  ]
}

Gere APENAS o JSON. Não inclua texto fora do JSON.`

  let parsed: { context: string; rows: DiscountProposalRow[] } | null = null

  try {
    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      ...gatewayOptions,
      prompt,
      maxOutputTokens: 4000,
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
  }
  const { id, status, rows } = body
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const admin = getAdminClient()

  if (status) {
    // Aprovar / rejeitar — exige admin+
    if (!['super_admin', 'admin'].includes(profile.role))
      return NextResponse.json({ error: 'Sem permissão para aprovar/rejeitar' }, { status: 403 })

    const { error } = await admin
      .from('discount_proposals')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
