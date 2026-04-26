import { generateText } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { toApiDate } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs } from '@/lib/automo/channel-kpis'
import { buildKPIContext, type PriceImportForPrompt, type KPIPeriod } from '@/lib/agente/system-prompt'
import type { CompanyKPIResponse } from '@/lib/kpis/types'

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

// Labels de canal reutilizados no prompt e no bloco de memória
const CANAL_LABELS: Record<string, string> = {
  balcao_site:    'Balcão/Site',
  site_programada:'Site Programada',
  guia_moteis:    'Guia de Motéis',
}

/**
 * Monta o bloco de memória estratégica: lista as últimas propostas aprovadas
 * com os preços alterados (Δ%) e — quando disponível — o resultado observado
 * (KPIs antes × depois da mudança de tabela) para fechar o ciclo de aprendizado.
 */
function buildStrategicMemoryBlock(
  history: PriceProposal[],
  kpiAfter: CompanyKPIResponse | null,
  kpiBefore: CompanyKPIResponse | null,
): string {
  const relevant = history.filter((p) =>
    (p.rows as ProposedPriceRow[])?.some((r) => Math.abs(r.variacao_pct) >= 1)
  )
  if (!relevant.length) return ''

  function fmtBRL(n: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
  }
  function delta(a: number, b: number) {
    if (!b) return '—'
    const pct = ((a - b) / b) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }

  // Resultado real: compara KPIs do período anterior (antes da tabela ativa)
  // com o período atual (depois) — fecha explicitamente o loop de aprendizado
  let impactBlock = ''
  if (kpiAfter && kpiBefore) {
    const af = kpiAfter.TotalResult
    const bf = kpiBefore.TotalResult
    impactBlock = `### Resultado observado após última mudança de tabela
| KPI | Antes | Depois | Δ |
|-----|-------|--------|---|
| RevPAR | ${fmtBRL(bf.totalRevpar)} | ${fmtBRL(af.totalRevpar)} | **${delta(af.totalRevpar, bf.totalRevpar)}** |
| TRevPAR | ${fmtBRL(bf.totalTrevpar)} | ${fmtBRL(af.totalTrevpar)} | **${delta(af.totalTrevpar, bf.totalTrevpar)}** |
| Giro | ${bf.totalGiro.toFixed(2)} | ${af.totalGiro.toFixed(2)} | **${delta(af.totalGiro, bf.totalGiro)}** |
| Ocupação | ${bf.totalOccupancyRate.toFixed(1)}% | ${af.totalOccupancyRate.toFixed(1)}% | **${delta(af.totalOccupancyRate, bf.totalOccupancyRate)}** |
| Ticket Médio | ${fmtBRL(bf.totalAllTicketAverage)} | ${fmtBRL(af.totalAllTicketAverage)} | **${delta(af.totalAllTicketAverage, bf.totalAllTicketAverage)}** |

> Use este resultado para calibrar a nova proposta: se os KPIs melhoraram, intensifique a direção; se pioraram, recue ou corrija o caminho.

`
  }

  const blocks = relevant.map((p, idx) => {
    const date = p.reviewed_at
      ? new Date(p.reviewed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '?'
    const changed = ((p.rows as ProposedPriceRow[]) ?? []).filter((r) => Math.abs(r.variacao_pct) >= 1)
    const tableLines = changed.map((r) =>
      `| ${r.categoria} | ${r.periodo} | ${CANAL_LABELS[r.canal] ?? r.canal} | ` +
      `${r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos'} | ` +
      `R$ ${r.preco_atual.toFixed(2)} | R$ ${r.preco_proposto.toFixed(2)} | ` +
      `${r.variacao_pct > 0 ? '+' : ''}${r.variacao_pct.toFixed(1)}% |`
    ).join('\n')
    const rank = idx === 0 ? 'mais recente' : `${idx + 1}ª mais recente`
    return `### Proposta aprovada em ${date} (${rank})
Análise registrada: ${p.context ?? 'Não registrado'}

Alterações aplicadas (${changed.length} item${changed.length !== 1 ? 'ns' : ''}):
| Categoria | Período | Canal | Dia | Preço anterior | Preço novo | Δ% |
|-----------|---------|-------|-----|----------------|------------|-----|
${tableLines}`
  }).join('\n\n---\n\n')

  return `## Memória estratégica — ${relevant.length} proposta(s) aprovada(s)

${impactBlock}${blocks}`
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
    .select('id, parsed_data, discount_data, valid_from, valid_until')
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

  // Filtra apenas imports de preços (parsed_data com linhas) para evitar capturar imports de desconto
  const priceOnlyImports = allImports?.filter(
    (i) => (i.parsed_data as unknown as ParsedPriceRow[])?.length > 0
  ) ?? []

  const activeImport = priceOnlyImports.find(
    (i) => i.valid_from <= todayStr && (i.valid_until === null || i.valid_until >= todayStr)
  )
  const previousImport = activeImport
    ? priceOnlyImports.find((i) => i.valid_from < activeImport.valid_from)
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

  // ─── Buscar KPIs + histórico de propostas aprovadas em paralelo ─────────
  const kpiTasks = [
    fetchCompanyKPIsFromAutomo(unit.slug, activePeriod.startDate, activePeriod.endDate),
    ...(prevPeriod
      ? [fetchCompanyKPIsFromAutomo(unit.slug, prevPeriod.startDate, prevPeriod.endDate)]
      : []),
  ]
  const [kpiResults, historyResult, channelResult] = await Promise.all([
    Promise.allSettled(kpiTasks),
    supabase
      .from('price_proposals')
      .select('id, context, rows, reviewed_at, status')
      .eq('unit_id', unit.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(3),
    queryChannelKPIs(unit.slug, activePeriod.startDate, activePeriod.endDate),
  ])
  const kpiActive   = kpiResults[0]?.status === 'fulfilled' ? kpiResults[0].value : null
  const kpiPrevious = kpiResults[1]?.status === 'fulfilled' ? kpiResults[1].value : null
  const channelKPIs = Array.isArray(channelResult) ? channelResult : []
  const approvedHistory = (historyResult.data ?? []) as unknown as PriceProposal[]

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
  const memoryBlock = buildStrategicMemoryBlock(approvedHistory, kpiActive, kpiPrevious)

  const kpiBlocks = kpiData.map((kpi, i) => {
    const label = kpi.label ?? 'Período'
    // Injeta channelKPIs apenas no período mais recente (índice 0 = ativo)
    const ctx = buildKPIContext(unit.name, kpi.period, kpi.company, kpi.bookings, i === 0 ? channelKPIs : undefined)
    return `### ${label}\n${ctx.replace(/^## Dados operacionais[^\n]*\n/, '')}`
  }).join('\n\n---\n\n')

  // Tabela de preços ativa formatada inline
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

  // ─── Buscar guardrails + config do agente + snapshots de concorrentes ───
  const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias
  const snapshotCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_MS).toISOString()

  const [{ data: guardrailsData }, { data: agentConfigData }, { data: competitorSnapshotsData }] = await Promise.all([
    supabase
      .from('agent_price_guardrails')
      .select('categoria, periodo, preco_minimo, preco_maximo')
      .eq('unit_id', unit.id),
    supabase
      .from('rm_agent_config')
      .select('pricing_strategy, max_variation_pct, focus_metric, suite_amenities')
      .eq('unit_id', unit.id)
      .maybeSingle(),
    supabase
      .from('competitor_snapshots')
      .select('competitor_name, mapped_prices, scraped_at, raw_text')
      .eq('unit_id', unit.id)
      .gte('scraped_at', snapshotCutoff)
      .order('scraped_at', { ascending: false }),
  ])

  // Mapa: "categoria|periodo" → { min, max }
  const guardrailMap = new Map<string, { min: number; max: number }>(
    (guardrailsData ?? []).map((g) => [
      `${g.categoria}|${g.periodo}`,
      { min: g.preco_minimo, max: g.preco_maximo },
    ])
  )

  // Bloco de configuração do agente (estratégia + variação + foco)
  const strategy = agentConfigData?.pricing_strategy ?? 'moderado'
  const maxVar   = agentConfigData?.max_variation_pct ?? 20
  const focus    = agentConfigData?.focus_metric ?? 'balanceado'
  const suiteAmenities = (agentConfigData?.suite_amenities ?? {}) as Record<string, string[]>

  const STRATEGY_GUIDE: Record<string, string> = {
    conservador: 'Priorize estabilidade: proponha variações menores (≤10%), evite mudanças simultâneas em muitos itens e prefira ajustes incrementais.',
    moderado:    'Equilíbrio entre receita e volume: proponha variações proporcionais aos dados, ajustando itens com oportunidade clara.',
    agressivo:   'Maximize receita: proponha variações maiores onde a demanda suportar, priorizando RevPAR mesmo que reduza volume.',
  }
  const FOCUS_GUIDE: Record<string, string> = {
    balanceado: 'Otimize todos os KPIs em conjunto: RevPAR, Giro, TRevPAR, Taxa de Ocupação, Ticket Médio e TMO. Não sacrifique um KPI por outro sem justificativa clara nos dados.',
    agressivo:  'Maximize RevPAR e TRevPAR com variações ousadas. Aceite impacto temporário no volume se o ganho de receita for significativo. Priorize itens com maior oportunidade de aumento.',
    revpar:     'Priorize itens que aumentem o RevPAR (receita por apartamento disponível). Use Giro e Ocupação como contexto, mas o critério principal é RevPAR.',
    giro:       'Priorize aumentar o número de locações por suíte. Considere reduções de preço em horários de baixo giro se isso gerar mais rotatividade e receita total.',
    ocupacao:   'Priorize manter ou aumentar a taxa de ocupação. Aceite ticket menor se necessário para preencher mais suítes em períodos de baixa.',
    ticket:     'Priorize aumentar o ticket médio por locação. Aceite redução de volume quando o ganho por locação compensar a queda de giro.',
    trevpar:    'Priorize aumentar o TRevPAR (receita total por apartamento, incluindo serviços). Considere categorias com maior potencial de receita adicional além da locação.',
    tmo:        'Priorize otimizar o Tempo Médio de Ocupação (TMO). Avalie períodos onde o ajuste de preço pode estimular ou desestimular permanências longas conforme a demanda.',
  }
  const focusLabel: Record<string, string> = {
    balanceado: 'Balanceado (todos os KPIs)',
    agressivo:  'Agressivo (maximizar RevPAR + TRevPAR)',
    revpar:     'RevPAR',
    giro:       'Giro',
    ocupacao:   'Ocupação',
    ticket:     'Ticket médio',
    trevpar:    'TRevPAR',
    tmo:        'TMO',
  }

  const agentConfigBlock = `## Configuração do agente para esta unidade
- Estratégia: **${strategy}** — ${STRATEGY_GUIDE[strategy]}
- Variação máxima permitida: **±${maxVar}%** por item (não exceder este limite em nenhuma linha)
- Métrica de foco: **${focusLabel[focus] ?? focus}** — ${FOCUS_GUIDE[focus] ?? ''}`

  // Bloco de preços de concorrentes (snapshots dos últimos 7 dias)
  interface MappedPrice { categoria_concorrente: string; categoria_nossa: string | null; periodo: string; preco: number; dia_tipo?: string; notas?: string }
  interface GuiaMeta { mode: 'guia'; amenities?: string[]; amenitiesBySuite?: Record<string, string[]> }

  const competitorBlock = competitorSnapshotsData?.length
    ? `## Preços de concorrentes (referência — última análise)

${(competitorSnapshotsData as unknown as Array<{ competitor_name: string; mapped_prices: unknown; scraped_at: string; raw_text?: string }>).map((snap) => {
  const prices = (snap.mapped_prices as MappedPrice[]) ?? []
  if (!prices.length) return `**${snap.competitor_name}**: sem preços extraídos`
  const date = new Date(snap.scraped_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const lines = prices.map((p) =>
    `  | ${p.categoria_concorrente} | ${p.periodo} | ${p.dia_tipo ?? 'todos'} | R$ ${p.preco.toFixed(2)} |`
  ).join('\n')
  let amenitiesBlock = ''
  try {
    const meta = JSON.parse(snap.raw_text ?? '') as GuiaMeta
    if (meta.mode === 'guia') {
      if (meta.amenitiesBySuite && Object.keys(meta.amenitiesBySuite).length) {
        const lines2 = Object.entries(meta.amenitiesBySuite)
          .map(([suite, ams]) => `  - **${suite}**: ${ams.join(', ')}`)
          .join('\n')
        amenitiesBlock = `\n  Comodidades por suíte:\n${lines2}`
      } else if (meta.amenities?.length) {
        amenitiesBlock = `\n  Comodidades: ${meta.amenities.join(', ')}`
      }
    }
  } catch { /* não é JSON */ }
  return `**${snap.competitor_name}** (analisado em ${date})${amenitiesBlock}\n  | Suíte | Período | Dia | Preço |\n  |-------|---------|-----|-------|\n${lines}`
}).join('\n\n')}

> Compare categorias com comodidades equivalentes (ex: suíte com hidro vs. concorrente com hidro; piscina vs. piscina).`
    : ''

  const guardrailsBlock = guardrailsData?.length
    ? `## Guardrails de preço (limites obrigatórios — NÃO ULTRAPASSAR)

Estes limites foram configurados pelo gestor. Nenhuma proposta pode ter preco_proposto fora deste intervalo.

| Categoria | Período | Preço Mínimo | Preço Máximo |
|-----------|---------|-------------|-------------|
${guardrailsData.map((g) =>
  `| ${g.categoria} | ${g.periodo} | R$ ${g.preco_minimo.toFixed(2)} | R$ ${g.preco_maximo.toFixed(2)} |`
).join('\n')}

IMPORTANTE: Se o preço ótimo calculado ultrapassar o máximo, use o máximo. Se estiver abaixo do mínimo, use o mínimo.`
    : ''

  // Bloco de política de descontos do Guia de Motéis
  // Coleta de: (1) campo discount_data em imports de preços antigos e (2) imports separados de desconto
  type DiscountRow = { canal: string; categoria: string; periodo: string; dia_semana?: string; dia_tipo?: string; faixa_horaria?: string; tipo_desconto: string; valor: number; condicao?: string }
  const activeDiscounts: DiscountRow[] = (allImports ?? [])
    .filter((i) => i.valid_from <= todayStr && (i.valid_until === null || i.valid_until >= todayStr))
    .flatMap((i) => (i.discount_data as unknown as DiscountRow[]) ?? [])
  const discountBlock = activeDiscounts.length > 0
    ? `## Política de descontos — Guia de Motéis

Estas regras estão configuradas na tabela vigente. Leve-as em conta ao propor ajustes para o canal guia_moteis.

| Categoria | Período | Dia | Horário | Tipo | Desconto | Condição |
|-----------|---------|-----|---------|------|----------|----------|
${activeDiscounts.map((d) => {
  const dia = d.dia_semana ?? (d.dia_tipo === 'semana' ? 'seg–sex' : d.dia_tipo === 'fds_feriado' ? 'fds/feriado' : 'todos')
  const horario = d.faixa_horaria ?? '—'
  return `| ${d.categoria} | ${d.periodo} | ${dia} | ${horario} | ${d.tipo_desconto === 'percentual' ? 'Percentual' : 'Absoluto'} | ${d.tipo_desconto === 'percentual' ? `${d.valor}%` : `R$ ${d.valor.toFixed(2)}`} | ${d.condicao ?? '—'} |`
}).join('\n')}

> Os preços propostos para guia_moteis devem ser os preços BASE (antes do desconto). O desconto é aplicado automaticamente pelo canal.`
    : ''

  const ownAmenitiesBlock = Object.keys(suiteAmenities).length
    ? `## Comodidades das nossas suítes (${unit.name})\n` +
      Object.entries(suiteAmenities)
        .map(([cat, list]) => `- **${cat}**: ${list.join(', ')}`)
        .join('\n')
    : ''

  const prompt = `Você é um especialista em Revenue Management para motéis. Analise os dados abaixo e gere uma proposta de ajuste de preços.

## Dados operacionais — ${unit.name}

${kpiBlocks}
${memoryBlock ? `\n${memoryBlock}\n` : ''}
${agentConfigBlock}
${ownAmenitiesBlock ? `\n${ownAmenitiesBlock}\n` : ''}${competitorBlock ? `\n${competitorBlock}\n` : ''}${guardrailsBlock ? `\n${guardrailsBlock}\n` : ''}${discountBlock ? `\n${discountBlock}\n` : ''}
## Tabelas de preços${priceImports.length > 1 ? ' (histórico — tabela atual primeiro, anterior depois)' : ''}

${priceBlocks}

## Mapa de preços atuais (use estes valores exatos como preco_atual no JSON)

${precoAtualBlock}

---

TAREFA: Com base nos dados acima, gere uma proposta de ajuste de preços.

Critérios:
- Analise giro, ocupação e RevPAR por categoria e dia da semana nas tabelas semanais
${hasPrevious ? '- Compare o desempenho do período atual com o anterior: se KPIs melhoraram após mudança de tabela, a direção estava certa; se pioraram, corrija\n' : ''}${memoryBlock ? '- Use a memória estratégica para calibrar a nova proposta: se as mudanças anteriores melhoraram os KPIs, intensifique a direção; se pioraram, recue ou teste outro caminho\n' : ''}- Proponha apenas ajustes com justificativa clara nos dados
- Variação máxima: ±${maxVar}% por item (configurado pelo gestor — não exceder)
- Priorize itens com maior impacto no RevPAR (alto giro + RevPAR baixo = oportunidade de aumento)
${activeDiscounts.length > 0 ? '- Para guia_moteis: os preços propostos devem ser os valores BASE (o desconto é aplicado automaticamente)\n' : ''}
IMPORTANTE: Use os valores do "Mapa de preços atuais" acima como preco_atual. Não invente valores.

Retorne SOMENTE este JSON minificado (sem nenhum texto antes ou depois):
{"context":"análise em 2-3 frases","rows":[{"canal":"balcao_site","categoria":"nome","periodo":"3h","dia_tipo":"semana","preco_atual":0.00,"preco_proposto":0.00,"variacao_pct":0.0,"justificativa":"razão em 1 frase"}]}

Valores válidos: canal = balcao_site | site_programada | guia_moteis; dia_tipo = semana | fds_feriado | todos
variacao_pct = ((preco_proposto - preco_atual) / preco_atual * 100) arredondado 1 decimal
Omita itens sem dados suficientes. JSON minificado, sem indentação.`

  // Suprimir warning de variável não usada (precoAtualMap disponível para validação futura)
  void precoAtualMap

  console.log('[proposals] kpiActive disponível:', !!kpiActive, '| kpiPrevious disponível:', !!kpiPrevious)
  console.log('[proposals] prompt length (chars):', prompt.length)

  const { text } = await generateText({
    model: PRIMARY_MODEL,
    providerOptions: gatewayOptions,
    prompt,
    maxOutputTokens: 2500,
    temperature: 0.2,
  })

  console.log('[proposals] resposta do modelo (primeiros 500 chars):', text.slice(0, 500))

  const parsed = extractProposalJSON(text)
  if (!parsed || !Array.isArray(parsed.rows)) {
    console.error('[proposals] Resposta não parseável — texto completo:', text)
    return Response.json(
      { error: 'O modelo não retornou JSON válido. Tente novamente.', preview: text.slice(0, 800) },
      { status: 422 }
    )
  }

  // ─── Clamp server-side pelos guardrails (safety net) ────────────────────
  if (guardrailMap.size > 0) {
    for (const row of parsed.rows) {
      const g = guardrailMap.get(`${row.categoria}|${row.periodo}`)
      if (!g) continue
      const clamped = Math.min(g.max, Math.max(g.min, row.preco_proposto))
      if (clamped !== row.preco_proposto) {
        row.preco_proposto = +clamped.toFixed(2)
        row.variacao_pct   = +((clamped - row.preco_atual) / row.preco_atual * 100).toFixed(1)
        row.justificativa  = `${row.justificativa} [ajustado ao limite configurado: R$ ${clamped.toFixed(2)}]`
      }
    }
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

    // Auto-agendar revisão +7 dias após aprovação (às 13:00 UTC = 10:00 BRT)
    const reviewDate = new Date()
    reviewDate.setDate(reviewDate.getDate() + 7)
    reviewDate.setUTCHours(13, 0, 0, 0)
    await admin.from('scheduled_reviews').insert({
      unit_id:      proposal.unit_id,
      created_by:   user.id,
      scheduled_at: reviewDate.toISOString(),
      proposal_id:  proposal.id,
      note:         `Acompanhamento de precificação — verificar impacto da proposta aprovada em ${today} nos KPIs de giro, RevPAR e ocupação.`,
      status:       'pending',
    }).select('id').single()

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

  const admin = getAdminClient()

  // Verificar que a proposta existe e pertence a uma unidade acessível
  const { data: existing } = await admin
    .from('price_proposals')
    .select('id, unit_id')
    .eq('id', id)
    .single()

  if (!existing) return new Response('Proposta não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== existing.unit_id) {
    return new Response('Sem acesso', { status: 403 })
  }

  // Deleta agendas vinculadas à proposta antes de removê-la
  await admin.from('scheduled_reviews').delete().eq('proposal_id', id)

  const { error } = await admin
    .from('price_proposals')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

