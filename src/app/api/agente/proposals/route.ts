import { generateText } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { toApiDate } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildKPIContext, type PriceImportForPrompt, type KPIPeriod } from '@/lib/agente/system-prompt'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProposedPriceRow extends ParsedPriceRow {
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
}

export interface ProposalResponse {
  context: string
  rows: ProposedPriceRow[]
}

export interface PriceProposal {
  id: string
  unit_id: string
  created_by: string
  context: string | null
  rows: ProposedPriceRow[]
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function extractProposalJSON(text: string): ProposalResponse | null {
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
    return JSON.parse(candidate.slice(start, end + 1)) as ProposalResponse
  } catch {
    return null
  }
}

// ─── GET: lista propostas da unidade ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: proposals, error } = await supabase
    .from('price_proposals')
    .select('*')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(proposals as unknown as PriceProposal[])
}

// ─── POST: gera nova proposta via IA com análise comparativa ─────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as { unitSlug: string }
  const { unitSlug } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name, slug')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  // ─── Buscar todas as tabelas de preços ──────────────────────────────────
  const { data: allImports } = await admin
    .from('price_imports')
    .select('id, parsed_data, valid_from, valid_until')
    .eq('unit_id', unit.id)
    .order('valid_from', { ascending: false })

  if (!allImports?.some((i) => (i.parsed_data as unknown as ParsedPriceRow[])?.length > 0)) {
    return Response.json(
      { error: 'Nenhuma tabela de preços importada. Importe uma tabela de preços antes de gerar propostas.' },
      { status: 422 }
    )
  }

  // ─── Identificar tabela ativa e anterior ────────────────────────────────
  const now = new Date()
  const todayOp =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayStr = todayOp.toISOString().slice(0, 10)

  const activeImport = allImports?.find(
    (i) => i.valid_from <= todayStr && (i.valid_until === null || i.valid_until >= todayStr)
  )
  const previousImport = activeImport
    ? allImports?.find((i) => i.valid_from < activeImport.valid_from)
    : undefined

  if (!activeImport || (activeImport.parsed_data as unknown as ParsedPriceRow[])?.length === 0) {
    return Response.json(
      { error: 'Nenhuma tabela de preços ativa encontrada. Verifique as datas de vigência.' },
      { status: 422 }
    )
  }

  // ─── Calcular períodos de KPI ────────────────────────────────────────────
  const yesterday = new Date(todayOp)
  yesterday.setDate(yesterday.getDate() - 1)

  // Período da tabela atual: de valid_from até ontem (mín. 14 dias para ter dados)
  const activeFromDate = new Date(activeImport.valid_from)
  const MIN_DAYS = 14
  const daysActive = Math.floor((todayOp.getTime() - activeFromDate.getTime()) / 86400000)
  const kpiStartDate =
    daysActive >= MIN_DAYS
      ? activeFromDate
      : new Date(yesterday.getTime() - (MIN_DAYS - 1) * 86400000)

  const activePeriod = { startDate: toApiDate(kpiStartDate), endDate: toApiDate(yesterday) }

  // Período anterior: mesma duração, terminando no dia antes da tabela atual entrar
  let prevPeriod: { startDate: string; endDate: string } | null = null
  if (previousImport) {
    const durationDays = Math.floor((yesterday.getTime() - kpiStartDate.getTime()) / 86400000) + 1
    const prevEnd = new Date(activeFromDate)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - (durationDays - 1))
    prevPeriod = { startDate: toApiDate(prevStart), endDate: toApiDate(prevEnd) }
  }

  // ─── Buscar KPIs em paralelo ────────────────────────────────────────────
  const kpiTasks = [
    fetchCompanyKPIsFromAutomo(unit.slug, activePeriod.startDate, activePeriod.endDate),
    ...(prevPeriod
      ? [fetchCompanyKPIsFromAutomo(unit.slug, prevPeriod.startDate, prevPeriod.endDate)]
      : []),
  ]
  const kpiResults = await Promise.allSettled(kpiTasks)
  const kpiActive = kpiResults[0]?.status === 'fulfilled' ? kpiResults[0].value : null
  const kpiPrevious = kpiResults[1]?.status === 'fulfilled' ? kpiResults[1].value : null

  // ─── Montar contexto comparativo para o prompt ──────────────────────────
  const priceImports: PriceImportForPrompt[] = [
    {
      rows: (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? [],
      valid_from: activeImport.valid_from,
      valid_until: activeImport.valid_until,
    },
    ...(previousImport
      ? [{
          rows: (previousImport.parsed_data as unknown as ParsedPriceRow[]) ?? [],
          valid_from: previousImport.valid_from,
          valid_until: previousImport.valid_until,
        }]
      : []),
  ]

  const kpiData: KPIPeriod[] = [
    {
      label: `Período atual (tabela vigente desde ${activeImport.valid_from})`,
      period: activePeriod,
      company: kpiActive,
      bookings: null,
    },
    ...(kpiPrevious && prevPeriod
      ? [{
          label: `Período anterior (tabela de ${previousImport?.valid_from ?? '?'} a ${previousImport?.valid_until ?? activeImport.valid_from})`,
          period: prevPeriod,
          company: kpiPrevious,
          bookings: null,
        }]
      : []),
  ]

  // ─── Montar prompt focado (sem system prompt do chat) ───────────────────
  const hasPrevious = kpiData.length > 1

  const kpiBlocks = kpiData.map((kpi) => {
    const label = kpi.label ?? 'Período'
    const ctx = buildKPIContext(unit.name, kpi.period, kpi.company, kpi.bookings)
    return `### ${label}\n${ctx.replace(/^## Dados operacionais[^\n]*\n/, '')}`
  }).join('\n\n---\n\n')

  // Tabela de preços ativa formatada inline
  const CANAL_LABELS: Record<string, string> = {
    balcao_site: 'Balcão/Site',
    site_programada: 'Site Programada',
    guia_moteis: 'Guia de Motéis',
  }
  const priceBlocks = priceImports.map((imp) => {
    const vigencia = `${imp.valid_from}${imp.valid_until ? ` → ${imp.valid_until}` : ' → atualmente'}`
    const byCanal = new Map<string, ParsedPriceRow[]>()
    for (const r of imp.rows) {
      const list = byCanal.get(r.canal) ?? []
      list.push(r)
      byCanal.set(r.canal, list)
    }
    const sections = [...byCanal.entries()].map(([canal, rows]) => {
      const label = CANAL_LABELS[canal] ?? canal
      const lines = rows.map((r) =>
        `  | ${r.categoria} | ${r.periodo} | ${r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos'} | R$ ${r.preco.toFixed(2)} |`
      )
      return `**${label}**\n  | Categoria | Período | Dia | Preço |\n  |-----------|---------|-----|-------|\n${lines.join('\n')}`
    })
    return `#### Tabela ${vigencia}\n${sections.join('\n\n')}`
  }).join('\n\n---\n\n')

  // Mapa de preços atuais (tabela ativa) para o modelo não precisar inferir
  const activeRows = (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
  const precoAtualMap = Object.fromEntries(
    activeRows.map((r) => [`${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`, r.preco])
  )
  const precoAtualBlock = activeRows.map((r) =>
    `${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo} = R$ ${r.preco.toFixed(2)}`
  ).join('\n')

  const prompt = `Você é um especialista em Revenue Management para motéis. Analise os dados abaixo e gere uma proposta de ajuste de preços.

## Dados operacionais — ${unit.name}

${kpiBlocks}

## Tabelas de preços${priceImports.length > 1 ? ' (histórico — tabela atual primeiro, anterior depois)' : ''}

${priceBlocks}

## Mapa de preços atuais (use estes valores exatos como preco_atual no JSON)

${precoAtualBlock}

---

TAREFA: Com base nos dados acima, gere uma proposta de ajuste de preços.

Critérios:
- Analise giro, ocupação e RevPAR por categoria e dia da semana nas tabelas semanais
${hasPrevious ? '- Compare o desempenho do período atual com o anterior: se KPIs melhoraram após mudança de tabela, a direção estava certa; se pioraram, corrija\n' : ''}- Proponha apenas ajustes com justificativa clara nos dados
- Variação máxima: ±30% por item
- Priorize itens com maior impacto no RevPAR (alto giro + RevPAR baixo = oportunidade de aumento)

IMPORTANTE: Use os valores do "Mapa de preços atuais" acima como preco_atual. Não invente valores.

Retorne SOMENTE este JSON minificado (sem nenhum texto antes ou depois):
{"context":"análise em 2-3 frases","rows":[{"canal":"balcao_site","categoria":"nome","periodo":"3h","dia_tipo":"semana","preco_atual":0.00,"preco_proposto":0.00,"variacao_pct":0.0,"justificativa":"razão em 1 frase"}]}

Valores válidos: canal = balcao_site | site_programada | guia_moteis; dia_tipo = semana | fds_feriado | todos
variacao_pct = ((preco_proposto - preco_atual) / preco_atual * 100) arredondado 1 decimal
Omita itens sem dados suficientes. JSON minificado, sem indentação.`

  // Suprimir warning de variável não usada (precoAtualMap disponível para validação futura)
  void precoAtualMap

  const { text } = await generateText({
    model: PRIMARY_MODEL,
    providerOptions: gatewayOptions,
    prompt,
    maxOutputTokens: 4000,
    temperature: 0.2,
  })

  const parsed = extractProposalJSON(text)
  if (!parsed || !Array.isArray(parsed.rows)) {
    console.error('[proposals] Resposta não parseável:', text.slice(0, 500))
    return Response.json(
      { error: 'O modelo não retornou JSON válido. Tente novamente.', preview: text.slice(0, 300) },
      { status: 422 }
    )
  }

  const { data: saved, error } = await supabase
    .from('price_proposals')
    .insert({
      unit_id: unit.id,
      created_by: user.id,
      context: parsed.context ?? null,
      rows: parsed.rows as unknown as Database['public']['Tables']['price_proposals']['Insert']['rows'],
      status: 'pending',
    })
    .select('*')
    .single()

  if (error) {
    console.error('[proposals] Erro ao salvar:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(saved as unknown as PriceProposal)
}

// ─── PATCH: aprovar, rejeitar ou editar proposta ──────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as {
    id: string
    status?: 'approved' | 'rejected'
    rows?: ProposedPriceRow[]
    context?: string
  }
  const { id } = body

  if (!id) return new Response('id obrigatório', { status: 400 })

  // ─── Edição manual de linhas ─────────────────────────────────────────────
  if (body.rows !== undefined) {
    const { data: updated, error } = await supabase
      .from('price_proposals')
      .update({
        rows: body.rows as unknown as Database['public']['Tables']['price_proposals']['Update']['rows'],
        ...(body.context !== undefined && { context: body.context }),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .single()

    if (error || !updated) {
      return Response.json({ error: 'Proposta não encontrada ou não está pendente' }, { status: 404 })
    }
    return Response.json(updated as unknown as PriceProposal)
  }

  // ─── Aprovação / rejeição ────────────────────────────────────────────────
  const { status } = body
  if (!status || !['approved', 'rejected'].includes(status)) {
    return new Response('status obrigatório (approved/rejected)', { status: 400 })
  }

  const { data: proposal, error: fetchErr } = await supabase
    .from('price_proposals')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !proposal) return Response.json({ error: 'Proposta não encontrada' }, { status: 404 })

  const { data: updated, error } = await supabase
    .from('price_proposals')
    .update({
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (status === 'approved') {
    const proposedRows = (proposal.rows as unknown as ProposedPriceRow[]) ?? []
    const today = new Date().toISOString().slice(0, 10)
    const admin = getAdminClient()

    const rowKey = (r: ParsedPriceRow) => `${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`

    const proposedMap = new Map<string, number>()
    for (const r of proposedRows) {
      proposedMap.set(rowKey(r), r.preco_proposto)
    }

    const { data: activeImport } = await admin
      .from('price_imports')
      .select('id, parsed_data, canals')
      .eq('unit_id', proposal.unit_id)
      .is('valid_until', null)
      .lte('valid_from', today)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const baseRows: ParsedPriceRow[] = activeImport
      ? (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
      : []

    const remainingProposed = new Map(proposedMap)
    const newRows: ParsedPriceRow[] = baseRows.map((r) => {
      const key = rowKey(r)
      const newPrice = remainingProposed.get(key)
      if (newPrice !== undefined) {
        remainingProposed.delete(key)
        return { ...r, preco: newPrice }
      }
      return { ...r }
    })

    for (const [key, preco] of remainingProposed) {
      const src = proposedRows.find((r) => rowKey(r) === key)
      if (src) {
        newRows.push({ canal: src.canal, categoria: src.categoria, periodo: src.periodo, dia_tipo: src.dia_tipo, preco })
      }
    }

    const newCanais = [...new Set(newRows.map((r) => r.canal))]

    if (activeImport) {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await admin
        .from('price_imports')
        .update({ valid_until: yesterday.toISOString().slice(0, 10) })
        .eq('id', activeImport.id)
    }

    await admin
      .from('price_imports')
      .insert({
        unit_id:     proposal.unit_id,
        imported_by: user.id,
        raw_content: `[Agente RM — proposta ${id} aprovada em ${today}]`,
        parsed_data: newRows as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        canals:      newCanais,
        is_active:   true,
        valid_from:  today,
        valid_until: null,
      })
  }

  return Response.json(updated as unknown as PriceProposal)
}

// ─── DELETE: excluir proposta ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const { error } = await supabase
    .from('price_proposals')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
