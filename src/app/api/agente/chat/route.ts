import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { gatewayOptions, STRATEGY_MAX_OUTPUT_TOKENS, STRATEGY_MAX_STEPS, createChatModel, DEFAULT_CHAT_MODEL_ID } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { trailingYear } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs, queryCancellationByChannel, buildCancellationBlock } from '@/lib/automo/channel-kpis'
import { buildSystemPrompt, buildKPIContext } from '@/lib/agente/system-prompt'
import { buildUnitStructureBlock } from '@/lib/agente/unit-structure'
import { getSuiteAvailabilityByCategory } from '@/lib/automo/suite-availability'
import { getRealtimeOccupancyByCategory } from '@/lib/automo/realtime-occupancy'
import { getReservationPace, buildPaceBlock, getWeeklyPickup, buildPickupBlock } from '@/lib/automo/reservation-pace'
import { buildRejectionLessonsBlock } from '@/lib/agente/rejection-lessons'
import { buildLessonsBlockForUnit } from '@/lib/agente/pricing-lessons'
import { getUpcomingSeasonalFactors, buildSeasonalityBlock } from '@/lib/seasonality/compute'
import { getElasticityForUnit, buildElasticityBlock } from '@/lib/pricing/elasticity'
import { buildWeatherCorrelationBlock } from '@/lib/agente/weather-insight'
import { getRecentGaps, buildCompetitorGapBlock } from '@/lib/competitors/detect-changes'
import { computeRevenueForecast, buildForecastBlock } from '@/lib/forecast/revenue-forecast'
import {
  buildStrategicMemoryBlock,
  buildGuardrailsBlock,
} from '@/lib/agente/context-blocks'
import { fetchWeatherContext } from '@/lib/agente/weather'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, getUnitCategoryIds } from '@/lib/automo/client'
import { queryDemandPattern, buildDemandPatternBlock } from '@/lib/automo/demand-pattern'
import { getDayTimeDemand, buildDayTimeDemandBlock } from '@/lib/automo/day-time-demand'
import { queryCategoryPeriodKPIs, buildCategoryPeriodBlock } from '@/lib/automo/category-period-kpis'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow, ParsedDiscountRow } from '@/app/api/agente/import-prices/route'
import type { PriceImportForPrompt, KPIPeriod, VigenciaInfo } from '@/lib/agente/system-prompt'
import { generateDayBandGrid, isLegacyTable, summarizeProposalRows, explodeRowsToPerDay, shapeIncreaseByGiro } from '@/lib/pricing/day-band-grid'
import { queryBandDemandByCategory } from '@/lib/automo/band-demand'
import { makeCurrencyFormatter } from '@/lib/utils/currency'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface PricingThresholds {
  giro_high?: number | null
  giro_low?: number | null
  ocupacao_high?: number | null
  ocupacao_low?: number | null
  adjustment_pct?: number | null
}

interface UnitGoals {
  revpar?: number | null
  trevpar?: number | null
  ocupacao?: number | null
  receita_mensal?: number | null
  giro?: number | null
  ticket?: number | null
}

interface BudgetMonthData {
  receita: number | null
  ticket:  number | null
  giro:    number | null
  revpar:  number | null
}
type BudgetYearly = Record<string, Record<string, BudgetMonthData>>

const MONTHS_PT_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function buildGoalsBlock(
  goals: UnitGoals | null,
  kpiPeriods: { company: import('@/lib/kpis/types').CompanyKPIResponse | null }[],
  budgetYearly?: BudgetYearly | null,
  fmtMoney?: (n: number, decimals?: number) => string,
): string {
  const fmtBRL = fmtMoney ?? ((n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n))
  const fmtNum = (n: number, dec = 2) => n.toFixed(dec)

  const LABELS: Record<string, string> = {
    revpar: 'RevPAR', trevpar: 'TRevPAR', ocupacao: 'Ocupação',
    receita_mensal: 'Receita Mensal', giro: 'Giro', ticket: 'Ticket Médio',
  }

  // ── Seção 1: gap mês atual ────────────────────────────────────────────────
  let currentMonthSection = ''
  if (goals) {
    const entries = Object.entries(goals).filter(([, v]) => v != null && v > 0) as [string, number][]
    if (entries.length) {
      const company = kpiPeriods[0]?.company

      function getCurrent(key: string): number | null {
        if (!company) return null
        const t = company.TotalResult
        const bn = company.BigNumbers?.[0]
        if (key === 'revpar')         return t?.totalRevpar ?? null
        if (key === 'trevpar')        return t?.totalTrevpar ?? null
        if (key === 'ocupacao')       return t?.totalOccupancyRate ?? null
        if (key === 'receita_mensal') return bn?.monthlyForecast?.totalAllValueForecast ?? null
        if (key === 'giro')           return t?.totalGiro ?? null
        if (key === 'ticket')         return t?.totalAllTicketAverage ?? null
        return null
      }

      function formatValue(key: string, value: number): string {
        if (key === 'ocupacao') return `${fmtNum(value, 1)}%`
        if (key === 'giro')     return fmtNum(value, 2)
        return fmtBRL(value)
      }

      function gapLabel(key: string, meta: number, atual: number): string {
        if (key === 'ocupacao') {
          const diff = atual - meta
          return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} p.p.`
        }
        const pct = ((atual - meta) / meta) * 100
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
      }

      const rows: string[] = []
      for (const [key, meta] of entries) {
        const atual = getCurrent(key)
        const metaFmt = formatValue(key, meta)
        if (atual == null) {
          rows.push(`| ${LABELS[key] ?? key} | ${metaFmt} | — | — | ⬜ Sem dados |`)
        } else {
          const gap = gapLabel(key, meta, atual)
          const ok = atual >= meta
          const status = ok ? '✅ Atingida' : '⚠️ Abaixo'
          rows.push(`| ${LABELS[key] ?? key} | ${metaFmt} | ${formatValue(key, atual)} | ${gap} | ${status} |`)
        }
      }

      currentMonthSection = `\n\n## Metas da Unidade — Mês atual
| KPI | Meta | Atual (período) | Gap | Status |
|-----|------|----------------|-----|--------|
${rows.join('\n')}

Ao diagnosticar e propor ajustes, **referencie explicitamente as metas acima**:
- Calcule o impacto estimado de cada proposta nos KPIs abaixo da meta.
- Identifique qual alavanca (preço, desconto, período) tem maior potencial de fechar o gap.
- Se um KPI já atingiu a meta, mantenha conservadorismo para não sacrificar o que já funciona.`
    }
  }

  // ── Seção 2: próximos meses do orçamento anual ────────────────────────────
  let upcomingSection = ''
  if (budgetYearly) {
    const now = new Date()
    const curMonth = now.getMonth() + 1
    const curYear  = now.getFullYear()
    const yearData = budgetYearly[String(curYear)]
    if (yearData) {
      const upcomingRows: string[] = []
      for (let offset = 1; offset <= 3; offset++) {
        const m = curMonth + offset
        if (m > 12) break
        const d = yearData[String(m)]
        if (!d || d.receita == null) continue
        const label = `${MONTHS_PT_SHORT[m - 1]}/${String(curYear).slice(2)}`
        const ticket = d.ticket != null ? fmtBRL(d.ticket) : '—'
        const giro   = d.giro   != null ? fmtNum(d.giro, 2) : '—'
        const revpar = d.revpar != null ? fmtBRL(d.revpar)  : '—'
        upcomingRows.push(`| ${label} | ${fmtBRL(d.receita)} | ${ticket} | ${giro} | ${revpar} |`)
      }
      if (upcomingRows.length) {
        upcomingSection = `\n\n## Orçamento — Próximos meses (referência de planejamento)
| Mês | Receita Meta | Ticket Meta | Giro Meta | RevPAR Meta |
|-----|-------------|-------------|-----------|-------------|
${upcomingRows.join('\n')}

Use esses valores para calibrar propostas com sazonalidade futura em mente.`
      }
    }
  }

  if (!currentMonthSection && !upcomingSection) return ''
  return currentMonthSection + upcomingSection
}

function buildPricingThresholdsBlock(t: PricingThresholds | null): string {
  if (!t) return ''
  const pct = t.adjustment_pct ?? 10
  const lines: string[] = []
  if (t.giro_high != null) lines.push(`- Giro > ${t.giro_high} em qualquer categoria/período → demanda aquecida, priorize aumento de ~${pct}%`)
  if (t.giro_low  != null) lines.push(`- Giro < ${t.giro_low} em qualquer categoria/período → demanda fraca, avalie redução de ~${pct}% para estimular volume`)
  if (t.ocupacao_high != null) lines.push(`- Taxa de ocupação > ${t.ocupacao_high}% → demanda inelástica, aumente preço em ~${pct}%`)
  if (t.ocupacao_low  != null) lines.push(`- Taxa de ocupação < ${t.ocupacao_low}% → demanda elástica, avalie redução de ~${pct}% ou pacote promocional`)
  if (!lines.length) return ''
  return `\n\n## Regras de ajuste dinâmico configuradas pelo gestor\nAplique estas regras ao diagnosticar e ao propor preços:\n${lines.join('\n')}`
}

// YYYY-MM-DD → DD/MM/YYYY (formato esperado pelo fetchCompanyKPIsFromAutomo)
function isoToApi(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

// Diferença em dias entre dois YYYY-MM-DD
function daysBetween(a: string, b: string): number {
  const da = new Date(a)
  const db = new Date(b)
  return Math.max(0, Math.round(Math.abs(db.getTime() - da.getTime()) / 86400000))
}

// min/max entre dois YYYY-MM-DD strings
function minDate(a: string, b: string) { return a < b ? a : b }
function maxDate(a: string, b: string) { return a > b ? a : b }

export async function POST(req: NextRequest) {
  // 1. Autenticação
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Não autorizado', { status: 401 })
  }

  // 2. Perfil e permissões
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return new Response('Perfil não encontrado', { status: 403 })
  }

  // 3. Payload
  const body = await req.json() as {
    messages: unknown[]
    unitSlug?: string
    /** ID da conversa em rm_conversations — usado pelo onFinish para salvar
     *  resultado e notificar quando o cliente desconecta antes do término */
    convId?: string
    // Legado: DD/MM/YYYY (cron/revisoes e outras rotas)
    startDate?: string
    endDate?: string
    /** Período selecionado pelo usuário no dashboard — YYYY-MM-DD + label legível */
    dashboardPeriod?: { dateFrom: string; dateTo: string; label: string }
    /** Modo de contexto: 'org' inclui contexto compartilhado, eventos e regras da unidade;
     *  'personal' usa apenas KPIs e tabela de preços — sem memória coletiva */
    contextMode?: 'org' | 'personal'
    /** ID do modelo selecionado pelo usuário no seletor do chat */
    modelId?: string
  }
  const { messages, unitSlug, convId, startDate, endDate, dashboardPeriod, contextMode = 'org', modelId } = body

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response('messages inválido', { status: 400 })
  }

  // 4. Resolver unidade
  const admin = getAdminClient()
  let unit: { id: string; name: string; slug: string } | null = null

  if (unitSlug) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('slug', unitSlug)
      .eq('is_active', true)
      .single()
    unit = data

    // Verificar se o usuário tem acesso a essa unidade
    // Admin/super_admin com unit_id=null têm acesso global
    const hasGlobalAccess = ['super_admin', 'admin'].includes(profile.role ?? '') && !profile.unit_id
    if (unit && !hasGlobalAccess && profile.unit_id !== unit.id) {
      return new Response('Sem acesso a essa unidade', { status: 403 })
    }
  }

  if (!unit && profile.unit_id) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('id', profile.unit_id)
      .single()
    unit = data
  }

  if (!unit && ['super_admin', 'admin'].includes(profile.role ?? '') && !profile.unit_id) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('name')
      .limit(1)
      .single()
    unit = data
  }

  if (!unit) {
    return new Response('Nenhuma unidade disponível', { status: 400 })
  }

  const { formatMoney: fmtMoney, symbol: currencySymbol } = makeCurrencyFormatter(unit.slug)

  // 5. Resolver imports e KPIs
  type RawImport = { id: string; parsed_data: unknown; discount_data: unknown; valid_from: string; valid_until: string | null }

  let kpiPeriods: KPIPeriod[]
  let rawImports: RawImport[] = []
  let vigenciaInfo: Parameters<typeof buildSystemPrompt>[3] = undefined

  // Hoje em YYYY-MM-DD (corte operacional 06:00 — usa data de ontem se < 06h)
  const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000) // UTC-3
  const todayIso = nowBRT.toISOString().slice(0, 10)

  // Label de sincronização com o dashboard (usado no buildSystemPrompt)
  let dashboardSyncLabel: string | null = null

  // Período mínimo para usar dashboardPeriod — se < 7 dias (ex: dia 1 do mês com "Este mês"),
  // ignora e cai no auto-detect que tem o fallback para o mês anterior completo
  const MIN_DAYS_FOR_MTD = 7
  const dashDays = (dashboardPeriod?.dateFrom && dashboardPeriod?.dateTo)
    ? daysBetween(dashboardPeriod.dateFrom, dashboardPeriod.dateTo)
    : 0

  if (dashboardPeriod?.dateFrom && dashboardPeriod?.dateTo && !startDate && !endDate && dashDays >= MIN_DAYS_FOR_MTD) {
    // ── Modo sincronizado com dashboard: período selecionado pelo usuário ──────
    const [priceImpsResult, discountImpResult] = await Promise.allSettled([
      admin
        .from('price_imports')
        .select('id, parsed_data, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'prices')
        .order('valid_from', { ascending: false })
        .limit(2),
      admin
        .from('price_imports')
        .select('id, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'discounts')
        .lte('valid_from', todayIso)
        .or(`valid_until.is.null,valid_until.gte.${todayIso}`)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const priceImps = priceImpsResult.status === 'fulfilled' ? (priceImpsResult.value.data ?? []) : []
    const discountImp = discountImpResult.status === 'fulfilled' ? discountImpResult.value.data : null
    rawImports = priceImps

    const apiFrom = isoToApi(dashboardPeriod.dateFrom)
    const apiTo   = isoToApi(dashboardPeriod.dateTo)
    const [companyResult, channelResult] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unit.slug, apiFrom, apiTo),
      queryChannelKPIs(unit.slug, apiFrom, apiTo),
    ])
    const company = companyResult.status === 'fulfilled' ? companyResult.value : null
    kpiPeriods = [{
      period: { startDate: apiFrom, endDate: apiTo },
      company,
      bookings: null,
      channelKPIs: channelResult.status === 'fulfilled' ? channelResult.value : undefined,
      periodMix: company?.BillingRentalType,
    }]

    if (discountImp?.discount_data && rawImports.length > 0) {
      const mainImport = rawImports[rawImports.length - 1]
      if (!mainImport.discount_data) {
        mainImport.discount_data = discountImp.discount_data
      }
    }

    dashboardSyncLabel = dashboardPeriod.label
  } else if (startDate && endDate) {
    // ── Modo legado: DD/MM/YYYY (cron/revisoes) ────────────────────────────────
    const [companyResult, importsResult, channelResult] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unit.slug, startDate, endDate),
      admin
        .from('price_imports')
        .select('id, parsed_data, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'prices')
        .order('valid_from', { ascending: false }),
      queryChannelKPIs(unit.slug, startDate, endDate),
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    const legacyCompany = companyResult.status === 'fulfilled' ? companyResult.value : null
    kpiPeriods = [{
      period: { startDate, endDate },
      company: legacyCompany,
      bookings: null,
      channelKPIs: channelResult.status === 'fulfilled' ? channelResult.value : undefined,
      periodMix: legacyCompany?.BillingRentalType,
    }]
  } else {
    // ── Modo automático: backend detecta tabelas e monta contexto ─────────────
    // Busca até 20 tabelas de preços recentes + tabela de descontos ativa
    const [priceImpsResult, discountImpResult] = await Promise.allSettled([
      admin
        .from('price_imports')
        .select('id, parsed_data, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'prices')
        .order('valid_from', { ascending: false })
        .limit(20),
      admin
        .from('price_imports')
        .select('id, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'discounts')
        .lte('valid_from', todayIso)
        .or(`valid_until.is.null,valid_until.gte.${todayIso}`)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const priceImps = priceImpsResult.status === 'fulfilled' ? (priceImpsResult.value.data ?? []) : []
    const discountImp = discountImpResult.status === 'fulfilled' ? discountImpResult.value.data : null

    if (priceImps.length === 0) {
      // Sem tabela importada — usa trailing year (fallback)
      const kpiParams = trailingYear()
      const [companyResult, channelResult] = await Promise.allSettled([
        fetchCompanyKPIsFromAutomo(unit.slug, kpiParams.startDate, kpiParams.endDate),
        queryChannelKPIs(unit.slug, kpiParams.startDate, kpiParams.endDate),
      ])
      const tyCompany = companyResult.status === 'fulfilled' ? companyResult.value : null
      kpiPeriods = [{
        period: kpiParams,
        company: tyCompany,
        bookings: null,
        channelKPIs: channelResult.status === 'fulfilled' ? channelResult.value : undefined,
        periodMix: tyCompany?.BillingRentalType,
      }]
    } else {
      // Modo padrão: MTD atual vs mesmo MTD do ano anterior (YoY real)
      // Período atual = max(valid_from da tabela ativa, 1º do mês) → hoje
      const activeTable = priceImps[0]
      const monthStart = todayIso.slice(0, 7) + '-01'
      const effectiveFrom = maxDate(activeTable.valid_from, monthStart)

      // Guard: mês corrente com < 7 dias → recua para mês anterior fechado
      // (ex: dia 01/06 → analisa maio completo em vez de 1 dia de junho)
      const daysMTD = daysBetween(effectiveFrom, todayIso)

      let analysisFrom: string
      let analysisTo: string
      let fallbackLabel: string | null = null

      if (daysMTD < MIN_DAYS_FOR_MTD) {
        // Último dia do mês anterior via new Date(year, month, 0)
        const prevLastDay = new Date(nowBRT.getFullYear(), nowBRT.getMonth(), 0)
        const pmYear = prevLastDay.getFullYear()
        const pmMM   = String(prevLastDay.getMonth() + 1).padStart(2, '0')
        const pmDD   = String(prevLastDay.getDate()).padStart(2, '0')
        analysisFrom = `${pmYear}-${pmMM}-01`
        analysisTo   = `${pmYear}-${pmMM}-${pmDD}`
        fallbackLabel = `Mês anterior fechado — ${isoToApi(analysisFrom)} a ${isoToApi(analysisTo)} (mês corrente com apenas ${daysMTD} ${daysMTD === 1 ? 'dia' : 'dias'} de dados — análise sobre mês anterior)`
      } else {
        analysisFrom = effectiveFrom
        analysisTo   = todayIso
      }

      // Mesmo período no ano anterior
      const yearN  = parseInt(analysisTo.slice(0, 4), 10)
      const lyFrom = `${yearN - 1}${analysisFrom.slice(4)}`
      const lyTo   = `${yearN - 1}${analysisTo.slice(4)}`

      // Busca tabela ativa no mesmo período do ano passado — em paralelo com KPIs
      const [lyTableResult, cCurrent, cLY, channelCurrent, channelLY] = await Promise.allSettled([
        admin
          .from('price_imports')
          .select('id, parsed_data, discount_data, valid_from, valid_until')
          .eq('unit_id', unit.id)
          .eq('import_type', 'prices')
          .lte('valid_from', lyTo)
          .or(`valid_until.is.null,valid_until.gte.${lyFrom}`)
          .order('valid_from', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchCompanyKPIsFromAutomo(unit.slug, isoToApi(analysisFrom), isoToApi(analysisTo)),
        fetchCompanyKPIsFromAutomo(unit.slug, isoToApi(lyFrom), isoToApi(lyTo)),
        queryChannelKPIs(unit.slug, isoToApi(analysisFrom), isoToApi(analysisTo)),
        queryChannelKPIs(unit.slug, isoToApi(lyFrom), isoToApi(lyTo)),
      ])

      const lyTable        = lyTableResult.status === 'fulfilled' ? lyTableResult.value.data : null
      const currentCompany = cCurrent.status === 'fulfilled' ? cCurrent.value : null
      const lyCompany      = cLY.status === 'fulfilled' ? cLY.value : null

      // Mescla TODOS os imports ativos hoje em activeTable.parsed_data
      // (suporte a imports separados por canal — ex: balcao_site e site_programada em arquivos distintos)
      const otherActives = priceImps.filter(
        (i) => i.id !== activeTable.id
          && i.valid_from <= todayIso
          && (i.valid_until === null || i.valid_until >= todayIso)
      )
      if (otherActives.length > 0) {
        const mergedMap = new Map<string, ParsedPriceRow>()
        for (const imp of [...otherActives, activeTable]) {
          for (const r of (imp.parsed_data as unknown as ParsedPriceRow[]) ?? []) {
            mergedMap.set(`${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`, r)
          }
        }
        ;(activeTable as RawImport).parsed_data = [...mergedMap.values()]
      }

      // rawImports: [tabela LY (se existir e diferente), tabela atual]
      rawImports = lyTable && lyTable.id !== activeTable.id
        ? [lyTable, activeTable]
        : [activeTable]

      const daysAnalysis = daysBetween(analysisFrom, analysisTo)
      const daysLY       = daysBetween(lyFrom, lyTo)

      kpiPeriods = [
        {
          label: `Ano anterior — ${isoToApi(lyFrom)} a ${isoToApi(lyTo)} (${daysLY} dias)`,
          period: { startDate: isoToApi(lyFrom), endDate: isoToApi(lyTo) },
          company: lyCompany,
          bookings: null,
          channelKPIs: channelLY.status === 'fulfilled' ? channelLY.value : undefined,
          periodMix: lyCompany?.BillingRentalType,
        },
        {
          label: fallbackLabel ?? `Período atual — ${isoToApi(analysisFrom)} a ${isoToApi(analysisTo)} (${daysAnalysis} dias)`,
          period: { startDate: isoToApi(analysisFrom), endDate: isoToApi(analysisTo) },
          company: currentCompany,
          bookings: null,
          channelKPIs: channelCurrent.status === 'fulfilled' ? channelCurrent.value : undefined,
          periodMix: currentCompany?.BillingRentalType,
        },
      ]
      // vigenciaInfo = undefined — comparação YoY não precisa de prompt "como comparar"
    }

    // Injeta descontos no import mais recente se disponível
    if (discountImp?.discount_data && rawImports.length > 0) {
      const mainImport = rawImports[rawImports.length - 1]
      if (!mainImport.discount_data) {
        mainImport.discount_data = discountImp.discount_data
      }
    }
  }

  // Montar PriceImportForPrompt
  const priceImports: PriceImportForPrompt[] = rawImports.map((imp) => ({
    rows: imp.parsed_data ? (imp.parsed_data as unknown as ParsedPriceRow[]) : [],
    discount_data: imp.discount_data ? (imp.discount_data as unknown as ParsedDiscountRow[]) : null,
    valid_from: imp.valid_from,
    valid_until: imp.valid_until,
  }))

  // Linhas da tabela ATIVA — esqueleto para cobertura total ao salvar proposta no chat
  const activePriceRows: ParsedPriceRow[] =
    (priceImports.find((i) => i.valid_until === null) ?? priceImports[0])?.rows ?? []

  // 6. Buscar config + capacity + guardrails em paralelo (contexto essencial estático)
  // Concorrentes, histórico, sazonalidade e eventos são carregados via ferramentas lazy.
  const snapshotCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [
    agentConfigResult,
    capacityResult,
    guardrailsResult,
    channelCostsResult,
  ] = await Promise.allSettled([
    admin
      .from('rm_agent_config')
      .select('city, timezone, suite_amenities, focus_metric, pricing_strategy, max_variation_pct, shared_context, pricing_thresholds, unit_goals, budget_yearly, pricing_method, giro_uplift_cap, never_reduce, peak_premium, peak_start, peak_end')
      .eq('unit_id', unit.id)
      .maybeSingle(),
    admin
      .from('unit_capacity')
      .select('categoria, custo_variavel_locacao, notes')
      .eq('unit_id', unit.id)
      .order('categoria'),
    admin
      .from('agent_price_guardrails')
      .select('categoria, periodo, dia_semana, hora_inicio, hora_fim, preco_minimo, preco_maximo')
      .eq('unit_id', unit.id),
    admin
      .from('unit_channel_costs')
      .select('canal, comissao_pct, taxa_fixa')
      .eq('unit_id', unit.id)
      .order('canal'),
  ])

  const agentConfigData = agentConfigResult.status === 'fulfilled' ? agentConfigResult.value.data : null
  const city = agentConfigData?.city ?? 'Campinas,BR'
  const unitTimezone = agentConfigData?.timezone ?? 'America/Sao_Paulo'
  const suiteAmenities = (agentConfigData?.suite_amenities ?? {}) as Record<string, string[]>
  const focusMetric = agentConfigData?.focus_metric ?? 'balanceado'
  const pricingStrategy = agentConfigData?.pricing_strategy ?? 'moderado'
  const maxVariationPct = agentConfigData?.max_variation_pct ?? 20
  const sharedContext = (agentConfigData as { shared_context?: string | null } | null)?.shared_context ?? null
  const pricingThresholds = (agentConfigData as { pricing_thresholds?: PricingThresholds | null } | null)?.pricing_thresholds ?? null
  const unitGoals      = (agentConfigData as { unit_goals?: Record<string, number | null> | null } | null)?.unit_goals ?? null
  const budgetYearly   = (agentConfigData as { budget_yearly?: BudgetYearly | null } | null)?.budget_yearly ?? null
  const neverReduce    = (agentConfigData as { never_reduce?: boolean } | null)?.never_reduce ?? false
  const giroUpliftCap  = Number((agentConfigData as { giro_uplift_cap?: number } | null)?.giro_uplift_cap ?? 0.05)
  const pricingMethod  = (agentConfigData as { pricing_method?: string } | null)?.pricing_method ?? 'agent_judgment'
  const peakPremium    = Number((agentConfigData as { peak_premium?: number } | null)?.peak_premium ?? 0)
  const peakStart      = Number((agentConfigData as { peak_start?: number } | null)?.peak_start ?? 15)
  const peakEnd        = Number((agentConfigData as { peak_end?: number } | null)?.peak_end ?? 21)
  // Modo do gestor (giro_uplift): grade usa faixa de PICO (peakStart–peakEnd) em vez de diurno/noturno.
  const primeTime      = pricingMethod === 'giro_uplift' && peakPremium > 0

  const FOCUS_LABELS: Record<string, string> = {
    revpar: 'RevPAR', ocupacao: 'Taxa de Ocupação', ticket: 'Ticket Médio',
    trevpar: 'TRevPAR', giro: 'Giro', tmo: 'TMO',
    balanceado: 'Balanceado (sem foco definido)',
    agressivo: 'Maximizar RevPAR + TRevPAR',
  }
  const STRATEGY_GUIDANCE: Record<string, string> = {
    conservador: `Variações típicas recomendadas: ±3–8%. Use o teto máximo (±${maxVariationPct}%) somente em situações extremas com evidência muito sólida (ex: concorrente 40%+ abaixo/acima e KPI crítico). Prefira ajustes graduais e incrementais.`,
    moderado:    `Variações típicas recomendadas: ±5–12%. Reserve o teto máximo (±${maxVariationPct}%) apenas para itens com desvio significativo e justificativa robusta (ex: overprice >25% vs concorrente confirmado OU KPI extremo). Evite usar o teto como padrão — a maioria das linhas deve ficar entre ±5–12%.`,
    agressivo:   `Pode usar todo o limite máximo (±${maxVariationPct}%) quando os dados justificarem claramente. Priorize maximização de RevPAR e TRevPAR.`,
  }
  const strategyGuidance = STRATEGY_GUIDANCE[pricingStrategy] ?? STRATEGY_GUIDANCE['moderado']
  const agentConfigBlock = `## Configuração do agente RM (${unit.name})
- **Estratégia de precificação:** ${pricingStrategy} — ${strategyGuidance}
- **Variação máxima permitida (teto absoluto):** ±${maxVariationPct}%
- **Foco principal:** ${FOCUS_LABELS[focusMetric] ?? focusMetric}
- **Moeda:** Use sempre **${currencySymbol}** para todos os valores monetários no texto e nas tabelas — nunca use outro símbolo de moeda
- **Giro como sinal de aumento:** dê peso a dias que giram acima da média da PRÓPRIA categoria (candidatos a aumento, até a variação máxima) — cruze com concorrência/eventos antes de decidir.${neverReduce ? `
- **NUNCA REDUZIR (regra do gestor):** nenhum preço proposto pode ser menor que o preço atual. Dias/categorias fracos = manter o preço (0%), nunca reduzir.` : `
- **REDUÇÃO PERMITIDA em dias fracos:** a regra "nunca reduzir" está DESMARCADA nesta unidade. Dias de **giro fraco** da categoria PODEM ter o preço **reduzido** (até a variação máxima) para estimular demanda; o **pico sobe**, o dia médio fica ≈ neutro. O reajuste sempre acompanha o giro do dia — **nunca reduza um dia de giro alto**. O servidor já aplica esse gradiente simétrico (vale reduz, pico sobe) na grade.`}${primeTime ? `
- **FAIXA DE PICO (método do gestor):** para os produtos de check-in imediato (balcão/site: 3h/6h/12h), a proposta tem DUAS faixas por dia — **Padrão (fora de pico)** e **Pico das ${peakStart}h às ${peakEnd}h**, este com prêmio de +${(peakPremium * 100).toFixed(0)}% sobre o padrão. O sistema gera essas duas faixas automaticamente; ao descrever a proposta, fale em "padrão" e "pico ${peakStart}h–${peakEnd}h" (NÃO em diurno/noturno).` : ''}`

  // Bloco de regras de ajuste dinâmico por giro/ocupação
  const pricingRulesBlock = buildPricingThresholdsBlock(pricingThresholds)

  // Bloco de contexto estratégico compartilhado da unidade
  const sharedContextBlock = sharedContext
    ? `\n\n## Contexto estratégico da unidade (compartilhado)\n${sharedContext}`
    : ''

  // Tipos auxiliares para o bloco de concorrentes (usado na ferramenta lazy buscar_analise_concorrentes)
  interface CMappedPrice {
    categoria_concorrente: string
    periodo: string
    preco: number
    dia_tipo?: string
    dias?: string[]         // dias individuais selecionados no modo manual
    hora_inicio?: string    // faixa intraday, ex: '06:00'
    hora_fim?: string       // faixa intraday, ex: '12:00'
  }
  interface CGuiaMeta { mode: 'guia'; amenitiesBySuite?: Record<string, string[]>; amenities?: string[] }

  // Bloco de comodidades das nossas suítes
  const ownAmenitiesBlock = Object.keys(suiteAmenities).length
    ? `## Comodidades das nossas suítes (${unit.name})\n` +
      Object.entries(suiteAmenities)
        .map(([cat, list]) => `- **${cat}**: ${list.join(', ')}`)
        .join('\n')
    : ''

  // 7. Montar system prompt completo
  // contextMode='personal' omite contexto coletivo da org (shared_context, eventos, regras de threshold)
  const goalsBlock = buildGoalsBlock(unitGoals, kpiPeriods, budgetYearly, fmtMoney)

  // Bloco de estrutura da unidade — disponibilidade vem do Automo (descontando bloqueios)
  const capacityRows = capacityResult.status === 'fulfilled' ? (capacityResult.value.data ?? []) : []
  const channelCostRows = channelCostsResult.status === 'fulfilled' ? (channelCostsResult.value.data ?? []) : []
  const [availabilityRows, realtimeOccupancy, reservationPace, weatherContext, categoryPeriodKPIs, cancellationRates, demandPattern, weeklyPickup, dayTimeDemand, elasticityRowsStatic, recentGaps, approvedHistoryStatic] = await Promise.all([
    getSuiteAvailabilityByCategory(unit.slug).catch(() => []),
    getRealtimeOccupancyByCategory(unit.slug).catch(() => []),
    getReservationPace(unit.slug, unitTimezone).catch(() => null),
    fetchWeatherContext(city).catch(() => null),
    kpiPeriods[0]?.period
      ? queryCategoryPeriodKPIs(unit.slug, kpiPeriods[0].period.startDate, kpiPeriods[0].period.endDate).catch(() => [])
      : Promise.resolve([]),
    kpiPeriods[0]?.period
      ? queryCancellationByChannel(unit.slug, kpiPeriods[0].period.startDate, kpiPeriods[0].period.endDate).catch(() => [])
      : Promise.resolve([]),
    queryDemandPattern(unit.slug, 90).catch(() => null),
    getWeeklyPickup(unit.slug).catch(() => null),
    getDayTimeDemand(unit.slug, 8).catch(() => []),
    // Paridade com geração de propostas (LHG: chat não pode ser cego a estes sinais):
    getElasticityForUnit(unit.id).catch(() => []),                       // elasticidade-preço observada
    getRecentGaps(unit.id).catch(() => []),                              // gap de posicionamento vs concorrentes
    admin                                                                // memória estratégica (propostas aprovadas)
      .from('price_proposals')
      .select('id, rows, context, reviewed_at, kpi_baseline')
      .eq('unit_id', unit.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(3)
      .then((r) => r.data ?? [], () => []),
  ])

  // Volume por categoria×período → demanda própria dos programados (Day Use/Pernoite/Diária).
  // Usado pelo gerador da grade para precificar programados sem herdar o giro do balcão.
  const schedVol = new Map<string, number>()
  for (const r of categoryPeriodKPIs ?? []) {
    schedVol.set(`${(r.categoria ?? '').trim().toUpperCase()}|${(r.periodo ?? '').trim().toLowerCase()}`, r.locacoes ?? 0)
  }

  // Guardrails sempre no prompt estático — safety-critical para o agente
  const guardrailRowsForBlock = guardrailsResult.status === 'fulfilled'
    ? (guardrailsResult.value.data ?? [])
    : []
  const guardrailsTextBlock = buildGuardrailsBlock(guardrailRowsForBlock)
  const unitStructureBlock = buildUnitStructureBlock(
    availabilityRows,
    capacityRows.map((r) => ({
      categoria: r.categoria,
      custo_variavel_locacao: Number(r.custo_variavel_locacao),
      notes: r.notes,
    })),
    channelCostRows.map((r) => ({
      canal: r.canal,
      comissao_pct: Number(r.comissao_pct),
      taxa_fixa: Number(r.taxa_fixa),
    })),
    realtimeOccupancy.length ? realtimeOccupancy : undefined,
  )

  const forecastBlock = buildForecastBlock(
    computeRevenueForecast(kpiPeriods[0]?.company ?? null, budgetYearly)
  )

  const paceBlock = buildPaceBlock(reservationPace)

  // Paridade de inteligência com a geração de propostas — o chat não pode raciocinar
  // cego a estes sinais. Elasticidade e gap de concorrentes são objetivos (sempre).
  // Memória estratégica é decisão coletiva da org → omitida em contextMode 'personal'.
  const elasticityBlock     = buildElasticityBlock(elasticityRowsStatic)
  const competitorGapBlock  = buildCompetitorGapBlock(recentGaps)
  const strategicMemoryBlock = contextMode === 'org'
    ? buildStrategicMemoryBlock(approvedHistoryStatic, kpiPeriods[0]?.company ?? null, kpiPeriods[1]?.company ?? null, fmtMoney)
    : ''

  // Contexto estático: KPIs, estrutura, config, metas, clima — dados operacionais essenciais.
  // Histórico, concorrentes, sazonalidade e eventos são carregados via ferramentas lazy.
  // Trava anti-alucinação do Guia de Motéis: se a unidade não opera esse canal
  // nem tem desconto cadastrado, o agente é PROIBIDO de mencionar Guia/descontos.
  const hasGuiaChannel  = activePriceRows.some((r) => r.canal === 'guia_moteis')
  const hasDiscountData = priceImports.some((i) => (i.discount_data?.length ?? 0) > 0)
  const noGuiaGuard = (!hasGuiaChannel && !hasDiscountData)
    ? `\n\n## ⚠️ Esta unidade NÃO opera com o canal Guia de Motéis
Não há canal \`guia_moteis\` na tabela de preços vigente nem política de descontos cadastrada para esta unidade.
**NUNCA** mencione "Guia de Motéis", descontos do Guia, share do Guia ou ajustes de desconto — nada disso existe aqui.
Ignore qualquer regra geral sobre descontos do Guia: ela NÃO se aplica a esta unidade. Analise somente os canais presentes na tabela vigente (${[...new Set(activePriceRows.map((r) => r.canal))].join(', ') || 'nenhum'}).`
    : ''

  // Trava de mercado: sem snapshot de concorrentes, os aumentos não foram validados.
  const noMarketGuard = (!recentGaps || recentGaps.length === 0)
    ? `\n\n## ⚠️ Sem dados de concorrentes nesta unidade
Não há análise de concorrentes/gap de mercado no contexto. Qualquer aumento proposto é baseado SÓ no giro interno — **não validado contra o mercado**. Declare isso explicitamente e seja conservador: não justifique aumentos por "vs mercado" e não vá ao teto de variação sem evidência de demanda inelástica clara.`
    : ''

  const systemPrompt =
    buildSystemPrompt(
      unit.name, kpiPeriods, priceImports, vigenciaInfo, weatherContext,
      null,
      unitStructureBlock || null,
      dashboardSyncLabel,
      fmtMoney,
    ) +
    noGuiaGuard +
    noMarketGuard +
    `\n\n${agentConfigBlock}` +
    (contextMode === 'org' ? pricingRulesBlock : '') +
    (contextMode === 'org' ? sharedContextBlock : '') +
    goalsBlock +
    (forecastBlock ? `\n\n${forecastBlock}` : '') +
    (paceBlock ? `\n\n${paceBlock}` : '') +
    (categoryPeriodKPIs?.length ? `\n\n${buildCategoryPeriodBlock(categoryPeriodKPIs, fmtMoney ?? undefined)}` : '') +
    (cancellationRates?.length ? `\n\n${buildCancellationBlock(cancellationRates)}` : '') +
    (demandPattern ? `\n\n${buildDemandPatternBlock(demandPattern, unit.name, 90)}` : '') +
    (weeklyPickup ? `\n\n${buildPickupBlock(weeklyPickup)}` : '') +
    (dayTimeDemand?.length ? `\n\n${buildDayTimeDemandBlock(dayTimeDemand)}` : '') +
    (ownAmenitiesBlock ? `\n\n${ownAmenitiesBlock}` : '') +
    (guardrailsTextBlock ? `\n\n${guardrailsTextBlock}` : '') +
    (elasticityBlock ? `\n\n${elasticityBlock}` : '') +
    (competitorGapBlock ? `\n\n${competitorGapBlock}` : '') +
    (strategicMemoryBlock ? `\n\n${strategicMemoryBlock}` : '')

  const agentTools = {
    buscar_kpis_periodo: tool({
      description:
        'Busca KPIs operacionais completos (giro, RevPAR, ticket médio, ocupação, tabelas semanais) ' +
        'para qualquer período específico via ERP Automo. ' +
        'Use sempre que o usuário mencionar datas específicas, pedir monitoramento de uma semana, ' +
        'ou quando os dados do contexto não cobrirem o período solicitado. ' +
        'Nunca diga que não tem acesso — use este tool.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato DD/MM/YYYY, ex: "01/04/2026"'),
        endDate:   z.string().describe('Data final no formato DD/MM/YYYY, ex: "07/04/2026"'),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const company = await fetchCompanyKPIsFromAutomo(unit.slug, startDate, endDate)
          return buildKPIContext(unit.name, { startDate, endDate }, company, null)
        } catch {
          return `Falha ao buscar KPIs no Automo para ${startDate} a ${endDate}. Verifique o período e se a conexão ERP está configurada.`
        }
      },
    }),

    gerar_heatmap: tool({
      description:
        'Gera um mapa de calor de ocupação ou giro por hora × dia da semana diretamente no chat. ' +
        'Use quando o usuário pedir "mapa de calor", "heatmap", "calor de giro", ' +
        '"como está a ocupação por hora" ou variações. ' +
        'Retorna os parâmetros para renderização visual — NÃO tente descrever os dados em texto.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato YYYY-MM-DD, ex: "2026-03-23"'),
        endDate:   z.string().describe('Data final no formato YYYY-MM-DD, ex: "2026-03-29"'),
        metric: z.enum(['giro', 'ocupacao', 'revpar', 'trevpar']).optional().describe('Métrica: "giro" (padrão), "ocupacao", "revpar" ou "trevpar"'),
        label: z.string().optional().describe('Rótulo descritivo do período, ex: "últimos 7 dias"'),
      }),
      execute: async ({ startDate, endDate, metric = 'giro', label }) => {
        const pool = await getAutomPool(unit.slug)
        if (!pool) return { error: `Conexão Automo não configurada para ${unit.slug}.` }
        const rangeLabel = label ?? `${startDate} a ${endDate}`
        return { startDate, endDate, metric, rangeLabel, unitSlug: unit.slug }
      },
    }),

    salvar_proposta: tool({
      description:
        'Salva a proposta de ajuste de preços no sistema para registro e revisão pelo gerente. ' +
        'CHAME SOMENTE se o último pedido do usuário contiver explicitamente: "proposta", "proponha", ' +
        '"gerar proposta", "crie uma proposta", "faça uma proposta", "nova tabela de preços" ou equivalente direto. ' +
        'Palavras como "oportunidades", "melhorias", "analisar", "investigar", "revisar", "sugestões" ' +
        'NÃO autorizam chamar esta tool — nesses casos, use sugerir_respostas com "Gerar proposta de preços" como opção. ' +
        'A aprovação final acontece na aba Propostas, nunca no chat. ' +
        'FLUXO ANTES DE MONTAR A TABELA DE PROPOSTA: chame buscar_padrao_horario para entender o padrão ' +
        'de demanda por dia × faixa horária — use para calibrar o premium FDS/semana, identificar se algum ' +
        'dia específico (ex: quinta-sexta com share alto) justifica um terceiro tier de preço, e verificar ' +
        'se o split semana/FDS atual é suficiente ou precisa ser refinado. ' +
        'FLUXO OBRIGATÓRIO APÓS SALVAR: (1) avalie imediatamente o desconto do Guia de Motéis — se houver ' +
        'oportunidade de ajuste (share fora de 5–20% ou ajuste possível por dia/faixa horária), ' +
        'chame salvar_proposta_desconto ANTES de qualquer outra coisa; ' +
        '(2) depois chame sugerir_respostas. ZERO texto entre as tool calls. ' +
        'NUNCA inclua "Gerar proposta de descontos" no sugerir_respostas — já foi avaliado proativamente.',
      inputSchema: z.object({
        context: z.string().describe(
          'Resumo da lógica geral da proposta. OBRIGATÓRIO incluir: ' +
          '(1) "X alterações de Y combinações analisadas"; ' +
          '(2) critério de seleção por canal: quais canais foram alterados e por quê os demais foram mantidos; ' +
          '(3) critério por categoria: quais categorias foram priorizadas (ex: "Lounge e Lounge-Hidro: FDS com giro > 2.5 — ajuste"; ' +
          '"Hidro Promo: semana com giro baixo — redução para estimular volume"; "demais categorias semana: RevPAR e giro dentro do esperado, mantido"); ' +
          '(4) critério por período: se apenas alguns períodos (3h, 6h, 12h) foram alterados, explique o critério (ex: "12h mantido em todas as categorias pois ocupação já é alta"). ' +
          'Não liste cada linha — descreva os CRITÉRIOS que determinaram o que foi alterado e o que foi mantido.'
        ),
        rows: z.array(z.object({
          canal:          z.enum(['balcao_site', 'site_programada', 'guia_moteis']),
          categoria:      z.string(),
          periodo:        z.string(),
          dias:           z.array(z.string()).describe(
            'UM ÚNICO dia da semana por linha. Nomes exatos: segunda, terca, quarta, quinta, sexta, sabado, domingo. ' +
            'NUNCA agrupe dias — sempre exatamente um item no array (ex: ["segunda"], ["sabado"]). ' +
            'Cada dia deve ter sua própria linha, com preço flutuando conforme o giro daquele dia.'
          ),
          hora_inicio:    z.enum(['06:00', '18:00']).describe("'06:00' = faixa diurna (06:00–17:59); '18:00' = faixa noturna (18:00–05:59)"),
          hora_fim:       z.enum(['17:59', '05:59']).describe("'17:59' para faixa diurna; '05:59' para faixa noturna"),
          preco_atual:    z.number(),
          preco_proposto: z.number(),
          variacao_pct:   z.number(),
          justificativa:  z.string(),
        })).describe(
          'Linhas de proposta de preços por dia × faixa horária. ' +
          'Inclua TODOS os canais ativos, TODAS as categorias, TODOS os períodos × TODOS os dias × AMBAS as faixas. ' +
          'UMA LINHA POR DIA — nunca agrupe dias num mesmo item, mesmo que o preço coincida (ex: gere linhas separadas para segunda e terça). ' +
          'Items mantidos (preco_proposto = preco_atual) DEVEM ser incluídos com justificativa "Mantido — [motivo]".'
        ),
      }),
      execute: async ({ context, rows }) => {
        let clampedRows
        if (isLegacyTable(activePriceRows)) {
          // Tabela vigente é legada (semana/fds, sem faixa) → a proposta NÃO deve espelhá-la.
          // Gera GRADE COMPLETA dia × faixa que flutua por giro/dia e demanda/faixa (baseline
          // determinístico), com as alterações do agente sobrepostas. Cobertura total, sem buracos.
          const period = kpiPeriods[0]?.period
          const bandDemand = period
            ? await queryBandDemandByCategory(unit.slug, period.startDate, period.endDate).catch(() => new Map())
            : new Map()
          clampedRows = generateDayBandGrid(
            activePriceRows,
            kpiPeriods[0]?.company ?? null,
            bandDemand,
            { dayCap: giroUpliftCap, bandCap: giroUpliftCap, maxVar: maxVariationPct, neverReduce, decimals: 0, primeTime, peakPremium, peakStart, peakEnd, schedVol },
            rows,  // overlay: ajustes propostos pelo agente sobrescrevem as células correspondentes
          )
        } else {
          // Tabela já em formato dia × faixa: usa as linhas do agente com clamp + never_reduce.
          // Explode dias agrupados (ex: ["seg","ter"]) em uma linha por dia — nunca agregamos.
          // Reescala o aumento para seguir o giro do dia (vale mantém, pico recebe) — mesma
          // coerência da grade legada; evita inflar dia de baixa demanda só por gap de mercado.
          const shaped = shapeIncreaseByGiro(explodeRowsToPerDay(rows), kpiPeriods[0]?.company ?? null, giroUpliftCap)
          clampedRows = shaped.map((row) => {
            const lowerBound = neverReduce ? 0 : -maxVariationPct
            const clamped = Math.max(lowerBound, Math.min(maxVariationPct, row.variacao_pct))
            const base = { ...row, dia_tipo: '', variacao_pct: clamped }
            if (Math.abs(clamped - row.variacao_pct) > 0.05) {
              return { ...base, preco_proposto: +(row.preco_atual * (1 + clamped / 100)).toFixed(2) }
            }
            return base
          })
        }
        // Resumo FIEL calculado da grade salva (não do LLM) — evita o texto contradizer a tabela.
        const factual = summarizeProposalRows(clampedRows)
        const savedContext = `${factual}\n\n— Racional do agente: ${context}`
        const { data, error } = await supabase
          .from('price_proposals')
          .insert({
            unit_id:    unit.id,
            created_by: user.id,
            context:    savedContext,
            rows: clampedRows as unknown as Database['public']['Tables']['price_proposals']['Insert']['rows'],
            status:     'pending',
          })
          .select('id')
          .single()
        if (error) return { success: false, error: error.message }
        // Retorna o resumo fiel para o agente ECOAR no chat (não inventar o que mudou)
        return { success: true, proposalId: data.id, resumo_fiel: factual }
      },
    }),

    salvar_proposta_desconto: tool({
      description:
        'Salva uma proposta de ajuste de desconto do Guia de Motéis. ' +
        'Use PROATIVAMENTE após salvar qualquer proposta de preços — não espere o usuário pedir. ' +
        'Fluxo obrigatório: (1) chame buscar_padrao_horario para ver demanda por dia × faixa horária; ' +
        '(2) compute margem real = preco_base × (1 - desconto/100) × (1 - comissao_guia/100) ' +
        '   usando a comissão em "Comissões por canal" da estrutura da unidade; ' +
        '(3) compare share do Guia — saudável = 5–20%; < 5% = invisível; > 20% = dependência excessiva; ' +
        '(4) salve proposta se share fora de 5–20% OU ajuste possível em faixa de baixa/alta demanda; ' +
        '(5) se nenhum ajuste, escreva "O desconto atual do Guia está adequado (share X%, margem Y%)". ' +
        'O preço efetivo NUNCA pode ficar abaixo do guardrail mínimo. ' +
        'Após salvar: ZERO texto — chame sugerir_respostas diretamente.',
      inputSchema: z.object({
        context: z.string().describe('Resumo em 2–3 frases da lógica da proposta de desconto'),
        rows: z.array(z.object({
          canal:                  z.literal('guia_moteis'),
          categoria:              z.string(),
          periodo:                z.string(),
          dia_tipo:               z.enum(['semana', 'fds_feriado', 'todos']),
          faixa_horaria:          z.string().optional(),
          desconto_atual_pct:     z.number(),
          desconto_proposto_pct:  z.number(),
          variacao_pts:           z.number(),
          preco_base:             z.number(),
          preco_efetivo_atual:    z.number(),
          preco_efetivo_proposto: z.number(),
          justificativa:          z.string(),
        })),
      }),
      execute: async ({ context, rows }) => {
        const { data, error } = await supabase
          .from('discount_proposals')
          .insert({
            unit_id: unit.id,
            context,
            rows: rows as unknown as Database['public']['Tables']['discount_proposals']['Insert']['rows'],
            status: 'pending',
          })
          .select('id')
          .single()
        if (error) return { success: false, error: error.message }
        return { success: true, proposalId: data.id }
      },
    }),

    sugerir_respostas: tool({
      description:
        'Exibe botões de resposta rápida clicáveis para o usuário no chat. ' +
        'Use SEMPRE após: (1) apresentar uma proposta de preços — inclua opções de análise, "Ajustar item", "Ir à aba Propostas" (texto vazio); ' +
        '(2) fazer uma pergunta de sim/não ou múltipla escolha; (3) oferecer próximos passos. ' +
        'Sempre inclua uma opção com texto vazio (label "Outra resposta") para o usuário digitar livremente. ' +
        'IMPORTANTE: label é o RÓTULO CURTO visível no botão (máx 30 chars, ex: "Janela igual (5 dias)"). ' +
        'texto é a mensagem COMPLETA enviada ao clicar (pode ser longa). NUNCA coloque frases longas no label.',
      inputSchema: z.object({
        opcoes: z.array(z.object({
          label: z.string().max(40).describe('Rótulo curto visível no card — máx 30 chars'),
          descricao: z.string().max(60).optional().describe('Frase de apoio exibida abaixo do label no card (máx 50 chars). Use para dar contexto em perguntas de objetivo/estratégia. Omita em opções simples como "Outra resposta".'),
          texto: z.string().describe('Mensagem completa enviada ao clicar. String vazia = usuário digita livremente.'),
        })).min(2).max(6),
      }),
      execute: async ({ opcoes }) => ({ opcoes }),
    }),

    buscar_dados_automo: tool({
      description:
        'Consulta diretamente o ERP Automo para obter giro, total de locações e número de suítes por categoria ' +
        'em qualquer período. Use quando precisar de dados granulares por categoria ou para cruzar com os KPIs agregados.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato YYYY-MM-DD, ex: "2026-04-01"'),
        endDate:   z.string().describe('Data final no formato YYYY-MM-DD, ex: "2026-04-07"'),
      }),
      execute: async ({ startDate, endDate }) => {
        const pool = await getAutomPool(unit.slug)
        if (!pool) return `Conexão Automo não configurada para ${unit.slug}.`

        const categoryIds = await getUnitCategoryIds(unit.slug)
        if (!categoryIds.length) return 'IDs de categoria não configurados para esta unidade.'

        const idList = categoryIds.join(',')
        const sql = `
          WITH category_suites AS (
            SELECT ca.id, ca.descricao AS nome, COUNT(a.id) AS suites
            FROM apartamento a
            INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
            WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
            GROUP BY ca.id, ca.descricao
          ),
          period_info AS (
            SELECT ('${endDate}'::date - '${startDate}'::date + 1) AS n_days
          ),
          locacoes AS (
            SELECT ca.id, COUNT(*) AS total_locacoes
            FROM locacaoapartamento la
            INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
            INNER JOIN apartamento a ON aps.id_apartamento = a.id
            INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
            WHERE la.datainicialdaocupacao >= '${startDate}'::date
              AND la.datainicialdaocupacao < ('${endDate}'::date + INTERVAL '1 day')
              AND la.fimocupacaotipo = 'FINALIZADA'
              AND ca.id IN (${idList})
            GROUP BY ca.id
          )
          SELECT
            cs.nome AS categoria,
            COALESCE(l.total_locacoes, 0) AS total_locacoes,
            cs.suites::int AS suites,
            pi.n_days::int AS dias_periodo,
            ROUND(COALESCE(l.total_locacoes, 0)::numeric / cs.suites / pi.n_days, 3) AS giro_diario
          FROM category_suites cs
          LEFT JOIN locacoes l ON l.id = cs.id
          CROSS JOIN period_info pi
          ORDER BY cs.nome
        `

        try {
          const result = await pool.query<{
            categoria: string; total_locacoes: number; suites: number
            dias_periodo: number; giro_diario: number
          }>(sql)

          if (!result.rows.length) return 'Nenhuma locação encontrada no período informado.'

          const header = `Dados Automo — ${unit.name} | ${startDate} a ${endDate}\n\n`
          const table = [
            '| Categoria | Locações | Suítes | Giro diário |',
            '|-----------|----------|--------|-------------|',
            ...result.rows.map((r) =>
              `| ${r.categoria} | ${r.total_locacoes} | ${r.suites} | ${r.giro_diario.toFixed(3)} |`
            ),
          ].join('\n')

          const total = result.rows.reduce((acc, r) => acc + r.total_locacoes, 0)
          const totalSuites = result.rows.reduce((acc, r) => acc + r.suites, 0)
          const days = result.rows[0]?.dias_periodo ?? 1
          const giroGeral = (total / totalSuites / days).toFixed(3)
          const summary = `\n\n**Total**: ${total} locações | ${totalSuites} suítes | Giro geral: ${giroGeral}`

          return header + table + summary
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[agente/automo] Erro query (${unit.slug}):`, msg)
          return `Erro ao consultar Automo: ${msg}`
        }
      },
    }),

    buscar_historico_propostas: tool({
      description:
        'Busca o histórico de propostas de preço aprovadas e lições extraídas de rejeições. ' +
        'Use antes de gerar uma nova proposta (para não repetir padrões rejeitados), ' +
        'quando o usuário perguntar sobre decisões passadas, ou para avaliar se a estratégia está evoluindo. ' +
        'Inclui: últimas 3 propostas aprovadas com impacto nos KPIs e últimas rejeições com motivo estruturado.',
      inputSchema: z.object({}),
      execute: async () => {
        const [historyResult, rejBlock] = await Promise.allSettled([
          admin
            .from('price_proposals')
            .select('id, rows, context, reviewed_at, kpi_baseline')
            .eq('unit_id', unit.id)
            .eq('status', 'approved')
            .order('reviewed_at', { ascending: false })
            .limit(3),
          buildRejectionLessonsBlock(unit.id).catch(() => ''),
        ])
        const approvedRows = historyResult.status === 'fulfilled' ? (historyResult.value.data ?? []) : []
        const rejLessons   = rejBlock.status === 'fulfilled' ? rejBlock.value : ''
        const kpiAfter  = kpiPeriods[0]?.company ?? null
        const kpiBefore = kpiPeriods[1]?.company ?? null
        const memory = buildStrategicMemoryBlock(approvedRows, kpiAfter, kpiBefore, fmtMoney)
        const parts = [memory, rejLessons].filter(Boolean)
        return parts.length ? parts.join('\n\n') : 'Nenhum histórico de propostas aprovadas encontrado para esta unidade.'
      },
    }),

    buscar_analise_concorrentes: tool({
      description:
        'Busca preços de concorrentes (últimos 7 dias) e o gap de posicionamento atual por categoria/período. ' +
        'Use quando o usuário pedir comparação com concorrentes, quiser saber o posicionamento de mercado, ' +
        'ou antes de propor mudanças de preço baseadas em mercado.',
      inputSchema: z.object({}),
      execute: async () => {
        const [snapsResult, gaps] = await Promise.all([
          admin
            .from('competitor_snapshots')
            .select('competitor_name, mapped_prices, scraped_at, raw_text')
            .eq('unit_id', unit.id)
            .eq('status', 'done')
            .gte('scraped_at', snapshotCutoff)
            .order('scraped_at', { ascending: false }),
          getRecentGaps(unit.id).catch(() => []),
        ])
        const snaps = snapsResult.data ?? []
        const cBlock = snaps.length
          ? `## Preços de concorrentes (última análise — referência de mercado)\n\n` +
            snaps.map((snap) => {
              const prices = (snap.mapped_prices as unknown as CMappedPrice[]) ?? []
              if (!prices.length) return `**${snap.competitor_name}**: sem preços extraídos`
              const date = new Date(snap.scraped_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
              let amenBlock = ''
              try {
                const meta = JSON.parse((snap as { raw_text?: string }).raw_text ?? '') as CGuiaMeta
                if ((meta.mode === 'guia' || meta.mode === 'manual') && meta.amenitiesBySuite && Object.keys(meta.amenitiesBySuite).length) {
                  const lines = Object.entries(meta.amenitiesBySuite)
                    .map(([s, ams]) => `  - **${s}**: ${ams.join(', ')}`).join('\n')
                  amenBlock = `\n  Comodidades:\n${lines}`
                }
              } catch { /* não é JSON */ }
              const hasIntraday = prices.some((p) => p.hora_inicio || p.hora_fim)
              const lines = prices.map((p) => {
                const horario = p.hora_inicio || p.hora_fim
                  ? `${p.hora_inicio ?? '?'}–${p.hora_fim ?? '?'}`
                  : '—'
                const diasLabel = p.dias?.length ? p.dias.join(',') : (p.dia_tipo ?? 'todos')
                return hasIntraday
                  ? `  | ${p.categoria_concorrente} | ${p.periodo} | ${diasLabel} | ${horario} | R$ ${p.preco.toFixed(2)} |`
                  : `  | ${p.categoria_concorrente} | ${p.periodo} | ${diasLabel} | R$ ${p.preco.toFixed(2)} |`
              }).join('\n')
              const header = hasIntraday
                ? `  | Suíte | Período | Dia | Horário | Preço |\n  |-------|---------|-----|---------|-------|`
                : `  | Suíte | Período | Dia | Preço |\n  |-------|---------|-----|-------|`
              return `**${snap.competitor_name}** (${date})${amenBlock}\n${header}\n${lines}`
            }).join('\n\n') +
            '\n\n> Compare comodidades equivalentes ao sugerir posicionamento de preço.'
          : 'Nenhum snapshot de concorrentes disponível nos últimos 7 dias.'
        const gapBlock = buildCompetitorGapBlock(gaps)
        const parts = [cBlock, gapBlock].filter(Boolean)
        return parts.join('\n\n') || 'Sem dados de concorrentes disponíveis.'
      },
    }),

    buscar_padrao_horario: tool({
      description:
        'Retorna o volume de locações por dia da semana × faixa horária (padrão: últimos 60 dias). ' +
        'É a ferramenta fundamental de Revenue Management — use ANTES de qualquer proposta de preço ou desconto. ' +
        'Responde as perguntas mais críticas: (a) qual o padrão de demanda de CADA dia (cada dia tem sua própria linha de preço — nunca agrupe dias)? ' +
        '(b) qual o ratio real de demanda FDS÷semana para calibrar o quanto o preço de cada dia flutua? ' +
        '(c) quais faixas horárias têm demanda estruturalmente baixa (preço estimulante) vs alta (preço agressivo)? ' +
        '(d) quais dias × faixas do Guia têm desconto desalinhado com a demanda real? ' +
        'O resultado já sinaliza 🔵 baixa demanda e 🟢 alta demanda por slot.',
      inputSchema: z.object({
        days: z.number().optional().describe('Dias retroativos para análise (padrão: 60)'),
      }),
      execute: async ({ days = 60 }) => {
        if (!await getAutomPool(unit.slug)) return `Conexão Automo não configurada para ${unit.slug}.`
        if (!(await getUnitCategoryIds(unit.slug)).length) return 'IDs de categoria não configurados para esta unidade.'
        try {
          const pattern = await queryDemandPattern(unit.slug, days)
          if (!pattern) return 'Sem dados de locações para o período informado.'

          const header = `Padrão de demanda — ${unit.name} | últimos ${days} dias | ${pattern.totalLocacoes} locações\n\n`
          const table = [
            '| Dia da Semana | Faixa Horária | Locações | Share % |',
            '|---------------|---------------|----------|---------|',
            ...pattern.rows.map(r =>
              `| ${r.dia_semana} | ${r.faixa_horaria} | ${r.locacoes} | ${r.share_pct}% |`
            ),
          ].join('\n')

          const lines: string[] = [header + table]
          if (pattern.fdsSemanaRatio !== null) {
            lines.push(`\nRatio FDS÷Semana: ${pattern.fdsSemanaRatio.toFixed(2)}x`)
          }
          if (pattern.highDemandDays.length > 0) {
            lines.push(`Dias com demanda acima da média: ${pattern.highDemandDays.join(', ')} — candidatos a tier próprio`)
          }
          if (pattern.lowDemandSlots.length > 0) {
            lines.push(`\n🔵 Baixa demanda (estímulo): ${pattern.lowDemandSlots.join(', ')}`)
          }
          if (pattern.highDemandSlots.length > 0) {
            lines.push(`🟢 Alta demanda (preço agressivo): ${pattern.highDemandSlots.join(', ')}`)
          }
          return lines.join('\n')
        } catch (err) {
          return `Erro ao consultar padrão horário: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    buscar_sazonalidade_e_eventos: tool({
      description:
        'Busca fatores de sazonalidade dos próximos 30 dias, lições de pricing de experimentos passados, ' +
        'elasticidade-preço calculada por categoria/período, correlação histórica clima×demanda, ' +
        'e o calendário de eventualidades da unidade (feriados, eventos, obras). ' +
        'Use antes de gerar propostas para datas futuras, quando o usuário perguntar sobre feriados, sazonalidade, ' +
        'impacto do clima na demanda, ou ao planejar precificação de fim de semana/feriado específico.',
      inputSchema: z.object({}),
      execute: async () => {
        const scenario = priceImports[0]?.rows?.length
          ? {
              categorias: [...new Set(priceImports[0].rows.map((r) => r.categoria))],
              periodos:   [...new Set(priceImports[0].rows.map((r) => r.periodo))],
              dias_tipo:  [...new Set(priceImports[0].rows.map((r) => r.dia_tipo))],
            }
          : {}
        const [seasonFactors, lessonsBlock, eventsResult, elasticityRows, weatherCorrelation] = await Promise.all([
          getUpcomingSeasonalFactors(unit.id, 30).catch(() => []),
          buildLessonsBlockForUnit(unit.id, scenario).catch(() => ''),
          admin
            .from('unit_events')
            .select('title, event_date, event_end_date, event_type, impact_description')
            .eq('unit_id', unit.id)
            .order('event_date', { ascending: false })
            .limit(30),
          getElasticityForUnit(unit.id).catch(() => []),
          buildWeatherCorrelationBlock(unit.id).catch(() => ''),
        ])
        const seasonBlock = buildSeasonalityBlock(seasonFactors)
        const elasticityBlock = buildElasticityBlock(elasticityRows)
        const evRows = eventsResult.data ?? []
        const evBlock = evRows.length
          ? `## Calendário de Eventualidades — ${unit.name}\n` +
            'Eventos registrados que podem ter afetado ou que afetarão o desempenho.\n' +
            'Ao analisar um período que coincide com um desses eventos, mencione o contexto.\n\n' +
            evRows.map((e) => {
              const icons: Record<string, string> = { positivo: '🟢', negativo: '🔴', neutro: '⚪' }
              const icon = icons[e.event_type as string] ?? '⚪'
              const dateStr = e.event_end_date && e.event_end_date !== e.event_date
                ? `${e.event_date} → ${e.event_end_date}`
                : String(e.event_date)
              return `${icon} **${e.title}** (${dateStr})${e.impact_description ? `: ${e.impact_description}` : ''}`
            }).join('\n')
          : ''
        const parts = [seasonBlock, elasticityBlock, weatherCorrelation, lessonsBlock, evBlock].filter(Boolean)
        return parts.length ? parts.join('\n\n') : 'Sem dados de sazonalidade e eventos para esta unidade.'
      },
    }),
  }

  // 8. Stream via AI Gateway com tools
  const result = streamText({
    model: createChatModel(modelId ?? DEFAULT_CHAT_MODEL_ID),
    system: systemPrompt,
    messages: await convertToModelMessages(messages as Parameters<typeof convertToModelMessages>[0]),
    tools: agentTools,
    stopWhen: stepCountIs(STRATEGY_MAX_STEPS),
    maxOutputTokens: STRATEGY_MAX_OUTPUT_TOKENS,
    temperature: 0.3,
    providerOptions: gatewayOptions,

    // onFinish é chamado quando o modelo termina a geração — MESMO se o cliente
    // desconectou (SSE fechado). No Vercel, a função continua executando até
    // concluir ou atingir o timeout. Quando convId está presente e o cliente
    // desconectou, salvamos as mensagens e criamos notificação in-app.
    onFinish: async ({ steps }) => {
      // ── Fallback de proposta ──────────────────────────────────────────────
      // O streamText encerra o loop quando um step termina só com texto (sem tool
      // call). Às vezes o modelo escreve a análise + um "resumo da proposta" e PARA,
      // sem nunca chamar salvar_proposta — então nenhuma proposta é registrada.
      // Se o usuário pediu proposta explicitamente e a tool não foi chamada, geramos
      // a grade determinística (giro/pico) server-side e salvamos. Roda SEMPRE (mesmo
      // com cliente conectado) — a aba Propostas tem Realtime e exibe na hora.
      try {
        const calledSalvar = (steps ?? []).some((s) =>
          ((s as { toolCalls?: Array<{ toolName?: string }> }).toolCalls ?? [])
            .some((tc) => tc.toolName === 'salvar_proposta')
        )
        const lastUser = [...(messages as Array<{ role: string; parts?: Array<{ type?: string; text?: string }> }>)]
          .reverse().find((m) => m.role === 'user')
        const lastUserText = (lastUser?.parts ?? [])
          .filter((p) => p.type === 'text').map((p) => p.text ?? '').join(' ')
        const proposalRequested = /proposta|proponha|gere|crie|fa[çc]a uma proposta|ajust\w* os pre[çc]os|nova tabela de pre[çc]os/i.test(lastUserText)

        // Só conseguimos reconstruir a grade sem o overlay do modelo quando a tabela
        // ativa é legada (semana/fds) — para tabelas já em dia×faixa, pulamos.
        if (proposalRequested && !calledSalvar && activePriceRows.length > 0 && isLegacyTable(activePriceRows)) {
          const period = kpiPeriods[0]?.period
          const bandDemand = period
            ? await queryBandDemandByCategory(unit.slug, period.startDate, period.endDate).catch(() => new Map())
            : new Map()
          const clampedRows = generateDayBandGrid(
            activePriceRows,
            kpiPeriods[0]?.company ?? null,
            bandDemand,
            { dayCap: giroUpliftCap, bandCap: giroUpliftCap, maxVar: maxVariationPct, neverReduce, decimals: 0, primeTime, peakPremium, peakStart, peakEnd, schedVol },
            [],
          )
          if (clampedRows.length) {
            const factual = summarizeProposalRows(clampedRows)
            await admin.from('price_proposals').insert({
              unit_id:    unit.id,
              created_by: user.id,
              context:    `${factual}\n\n— Proposta gerada automaticamente pelo sistema (grade determinística por giro/faixa de pico). O modelo concluiu a análise sem registrar a proposta via tool.`,
              rows:       clampedRows as unknown as Database['public']['Tables']['price_proposals']['Insert']['rows'],
              status:     'pending',
            })
            await admin.from('notifications').insert({
              user_id: user.id,
              type:    'info',
              title:   'Proposta de preços gerada',
              body:    'A proposta foi gerada e está na aba Propostas para revisão.',
              link:    `/dashboard/agente?unit=${unit.slug}`,
            })
          }
        }
      } catch (err) {
        console.error('[chat/onFinish] Erro no fallback de proposta:', err)
      }

      // Só age (salvar mensagem em background) se o cliente desconectou E há conversa
      if (!req.signal.aborted) return
      if (!convId || typeof convId !== 'string') return

      // Reconstrói o texto completo da análise usando TODOS os steps.
      // Em modo multi-step (análise → tool call → confirmação), `text` (último step)
      // perde a análise do step 1. `steps` contém texto e tool calls de cada etapa.
      const fullText = (steps ?? [])
        .map(s => s.text ?? '')
        .filter(Boolean)
        .join('\n\n')
        .trim()

      if (!fullText) return

      try {
        // Busca mensagens existentes (inclui a mensagem do usuário salva no submit)
        const { data: conv } = await admin
          .from('rm_conversations')
          .select('messages')
          .eq('id', convId)
          .single()

        const existing = (conv?.messages ?? []) as Array<{ role: string; parts: unknown[] }>
        // Não duplica: só insere se o último message ainda é do usuário (ainda aguardando)
        const lastRole = existing[existing.length - 1]?.role
        if (lastRole === 'assistant') return

        const assistantMsg = {
          id: Math.random().toString(36).slice(2, 12),
          role: 'assistant',
          parts: [{ type: 'text', text: fullText }],
        }

        await admin
          .from('rm_conversations')
          .update({ messages: JSON.parse(JSON.stringify([...existing, assistantMsg])) })
          .eq('id', convId)

        // Notificação in-app com link direto para a conversa
        await admin
          .from('notifications')
          .insert({
            user_id: user.id,
            type: 'info',
            title: 'Agente RM respondeu',
            body: 'Sua consulta foi processada. Clique para ver a resposta.',
            link: `/dashboard/agente?conv=${convId}`,
          })
      } catch (err) {
        console.error('[chat/onFinish] Erro ao salvar resposta em background:', err)
      }
    },
  })

  return result.toUIMessageStreamResponse()
}
