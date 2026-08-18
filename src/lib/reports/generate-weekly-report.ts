import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import type { Database, Json } from '@/types/database.types'
import type { WeeklyReportData, KPISnapshot } from './types'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs } from '@/lib/automo/channel-kpis'
import { getSuiteAvailabilityByCategory } from '@/lib/automo/suite-availability'
import { getUpcomingSeasonalFactors, buildSeasonalityBlock, getSeasonalFactorsForPeriod, buildPastSeasonalityBlock } from '@/lib/seasonality/compute'
import { getElasticityForUnit, buildElasticityBlock } from '@/lib/pricing/elasticity'
import { computeRevenueForecast, buildForecastBlock } from '@/lib/forecast/revenue-forecast'
import { ANALYSIS_MODEL } from '@/lib/agente/model'
// ANALYSIS_MODEL continua sendo usado para fallback — buildSystemPrompt usa a identidade do agente,
// mas o modelo de geração (custo/latência) continua sendo o ANALYSIS_MODEL (gpt-4.1-mini BYOK)
import type { BudgetYearly } from '@/lib/budget/google-sheets'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import { computeAndPersistGaps, parseAmenitiesBySuite, buildCompetitorGapBlock } from '@/lib/competitors/detect-changes'
import type { CompetitorGap } from '@/lib/competitors/detect-changes'
import { buildStrategicMemoryBlock } from '@/lib/agente/context-blocks'
import { makeCurrencyFormatter } from '@/lib/utils/currency'
import { buildLessonsBlockForUnit } from '@/lib/agente/pricing-lessons'
import { buildRejectionLessonsBlock } from '@/lib/agente/rejection-lessons'
import { buildUnitStructureBlock } from '@/lib/agente/unit-structure'
import { queryDemandPattern, buildDemandPatternBlock } from '@/lib/automo/demand-pattern'
import { queryCategoryTurnoKPIs } from '@/lib/automo/category-turno-kpis'
import { queryCategoryPeriodKPIs } from '@/lib/automo/category-period-kpis'
import { queryCategoryDiaSemanaKPIs } from '@/lib/automo/category-diasemana-kpis'
import { detectOpportunities } from '@/lib/reports/opportunities'

const MONTH_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function isoToDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function kpiSnapshotFromResponse(r: CompanyKPIResponse): KPISnapshot {
  const t = r.TotalResult
  const parts = (t.totalAverageOccupationTime ?? '0:00:00').split(':')
  const tmo = parseFloat(parts[0]) + parseFloat(parts[1] ?? '0') / 60
  return {
    revpar: t.totalRevpar,
    trevpar: t.totalTrevpar,
    giro: t.totalGiro,
    ocupacao: t.totalOccupancyRate / 100,
    ticket: t.totalAllTicketAverage,
    receita: t.totalAllValue,
    locacoes: t.totalAllRentalsApartments,
    tmo,
  }
}

function deltaPct(current: number, previous: number): number {
  if (!previous) return 0
  return ((current - previous) / previous) * 100
}

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export async function generateWeeklyReport(
  unitSlug: string,
  periodStart: string, // YYYY-MM-DD
  periodEnd: string,   // YYYY-MM-DD
): Promise<string | null> {
  const admin = getAdminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .single()

  if (!unit) {
    console.error('[generateWeeklyReport] Unit not found:', unitSlug)
    return null
  }

  const { data: reportRow, error: upsertErr } = await admin
    .from('rm_weekly_reports')
    .upsert({
      unit_id: unit.id,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'generating',
    }, { onConflict: 'unit_id,period_start' })
    .select('id')
    .single()

  if (upsertErr || !reportRow) {
    console.error('[generateWeeklyReport] Upsert failed:', upsertErr)
    return null
  }

  const reportId = reportRow.id
  const startDDMM = isoToDDMMYYYY(periodStart)
  const endDDMM = isoToDDMMYYYY(periodEnd)

  // Duration of selected period — previous period uses same duration
  const periodStartMs = new Date(periodStart + 'T12:00:00Z').getTime()
  const periodEndMs = new Date(periodEnd + 'T12:00:00Z').getTime()
  const durationDays = Math.round((periodEndMs - periodStartMs) / 86400000) + 1

  // Previous period of same duration
  const prevEnd = new Date(periodStart + 'T12:00:00Z')
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevEnd.getUTCDate() - (durationDays - 1))
  const prevStartStr = prevStart.toISOString().slice(0, 10)
  const prevEndStr = prevEnd.toISOString().slice(0, 10)

  // Same week last year
  const lyStart = new Date(periodStart + 'T12:00:00Z')
  lyStart.setUTCFullYear(lyStart.getUTCFullYear() - 1)
  const lyEnd = new Date(periodEnd + 'T12:00:00Z')
  lyEnd.setUTCFullYear(lyEnd.getUTCFullYear() - 1)

  // Mesmo período, um mês atrás (mesma duração)
  const moStart = new Date(periodStart + 'T12:00:00Z')
  moStart.setUTCMonth(moStart.getUTCMonth() - 1)
  const moEnd = new Date(periodEnd + 'T12:00:00Z')
  moEnd.setUTCMonth(moEnd.getUTCMonth() - 1)

  // Upcoming events cutoff
  const eventsEnd = new Date(periodEnd + 'T12:00:00Z')
  eventsEnd.setUTCDate(eventsEnd.getUTCDate() + 14)
  const eventsEndStr = eventsEnd.toISOString().slice(0, 10)

  // Budget tracking reference dates — MTD ends today if same month, else at period end
  const nowUtc = new Date()
  const periodEndForBudget = new Date(periodEnd + 'T12:00:00Z')
  const budgetMonthYear = periodEndForBudget.getUTCFullYear()
  const budgetMonthNum = periodEndForBudget.getUTCMonth() + 1
  const firstOfBudgetMonthDDMM = `01/${String(budgetMonthNum).padStart(2, '0')}/${budgetMonthYear}`
  const todayIsSameMonth = nowUtc.getUTCFullYear() === budgetMonthYear && (nowUtc.getUTCMonth() + 1) === budgetMonthNum
  const mtdEndDate = todayIsSameMonth ? nowUtc : periodEndForBudget
  const mtdEndDDMM = isoToDDMMYYYY(mtdEndDate.toISOString().slice(0, 10))

  try {
    const [
      kpisResult,
      prevKpisResult,
      lyKpisResult,
      channelResult,
      activePriceResult,
      proposalsResult,
      lessonsResult,
      elasticityResult,
      activeDiscountsResult,
      discountProposalsResult,
      competitorGapsResult,
      seasonalResult,
      eventsResult,
      anomaliesResult,
      agentConfigResult,
      suiteAvailResult,
      prevReportResult,
      demandPatternResult,
      mtdKpisResult,
      turnoCategoryResult,
      monthAgoKpisResult,
      categoryPeriodResult,
      pastSeasonalResult,
      diaSemanaResult,
    ] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unitSlug, startDDMM, endDDMM),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(prevStartStr), isoToDDMMYYYY(prevEndStr)),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(lyStart.toISOString().slice(0, 10)), isoToDDMMYYYY(lyEnd.toISOString().slice(0, 10))),
      queryChannelKPIs(unitSlug, startDDMM, endDDMM),
      admin.from('price_imports')
        .select('id, valid_from, parsed_data')
        .eq('unit_id', unit.id)
        .eq('import_type', 'prices')
        .lte('valid_from', periodEnd)
        .or(`valid_until.is.null,valid_until.gte.${periodStart}`)
        .order('valid_from', { ascending: false })
        .limit(1),
      admin.from('price_proposals')
        .select('id, approved_at, rows, context, reviewed_at, kpi_baseline')
        .eq('unit_id', unit.id)
        .eq('status', 'approved')
        .gte('approved_at', periodStart)
        .lte('approved_at', periodEnd + 'T23:59:59Z'),
      // rm_pricing_lessons: colunas corretas do banco
      admin.from('rm_pricing_lessons')
        .select('categoria, periodo, dia_tipo, preco_anterior, preco_novo, variacao_pct, delta_revpar_pct, delta_giro_pct, verdict, checkpoint_days')
        .eq('unit_id', unit.id)
        .gte('observed_at', prevStartStr)
        .lte('observed_at', periodEnd),
      getElasticityForUnit(unit.id),
      admin.from('price_imports')
        .select('parsed_data, discount_data')
        .eq('unit_id', unit.id)
        .eq('import_type', 'discounts')
        .lte('valid_from', periodEnd)
        .or(`valid_until.is.null,valid_until.gte.${periodStart}`)
        .order('valid_from', { ascending: false })
        .limit(1),
      admin.from('discount_proposals')
        .select('id')
        .eq('unit_id', unit.id)
        .eq('status', 'approved')
        .gte('approved_at', periodStart)
        .lte('approved_at', periodEnd + 'T23:59:59Z'),
      // rm_competitor_price_gaps: colunas corretas do banco
      admin.from('rm_competitor_price_gaps')
        .select('categoria_nossa, periodo, dia_tipo, preco_nosso, preco_concorrente_mediana, gap_pct, position, categoria_competitor, competitor_name, competitor_periodo, is_approximated')
        .eq('unit_id', unit.id)
        .order('gap_pct', { ascending: false })
        .limit(200),
      getUpcomingSeasonalFactors(unit.id, 14),
      admin.from('unit_events')
        .select('title, event_date, event_type, impact_description')
        .eq('unit_id', unit.id)
        .gte('event_date', periodEnd)
        .lte('event_date', eventsEndStr)
        .order('event_date'),
      // rm_anomalies: coluna correta é detected_at
      admin.from('rm_anomalies')
        .select('metric, direction, z_score, scope, status, detected_at')
        .eq('unit_id', unit.id)
        .gte('detected_at', periodStart)
        .order('detected_at', { ascending: false }),
      admin.from('rm_agent_config')
        .select('pricing_strategy, focus_metric, max_variation_pct, shared_context, unit_goals, budget_yearly, competitor_urls, suite_amenities')
        .eq('unit_id', unit.id)
        .single(),
      getSuiteAvailabilityByCategory(unitSlug),
      admin.from('rm_weekly_reports')
        .select('id, period_start, report_data')
        .eq('unit_id', unit.id)
        .eq('status', 'done')
        .lt('period_start', periodStart)
        .order('period_start', { ascending: false })
        .limit(1),
      queryDemandPattern(unitSlug, 60),
      fetchCompanyKPIsFromAutomo(unitSlug, firstOfBudgetMonthDDMM, mtdEndDDMM),
      queryCategoryTurnoKPIs(unitSlug, startDDMM, endDDMM),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(moStart.toISOString().slice(0, 10)), isoToDDMMYYYY(moEnd.toISOString().slice(0, 10))),
      queryCategoryPeriodKPIs(unitSlug, startDDMM, endDDMM),
      getSeasonalFactorsForPeriod(unit.id, periodStart, new Date(new Date(periodEnd + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)),
      queryCategoryDiaSemanaKPIs(unitSlug, startDDMM, endDDMM),
    ])

    const guardrailsResult = await admin
      .from('agent_price_guardrails')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unit.id)

    // Extract results with fallbacks
    const kpis = kpisResult.status === 'fulfilled' ? kpisResult.value : null
    const prevKpis = prevKpisResult.status === 'fulfilled' ? prevKpisResult.value : null
    const lyKpis = lyKpisResult.status === 'fulfilled' ? lyKpisResult.value : null
    const channelKPIs = channelResult.status === 'fulfilled' ? channelResult.value : []
    const periodMix = kpisResult.status === 'fulfilled' ? (kpisResult.value?.BillingRentalType ?? []) : []
    const activePriceData = activePriceResult.status === 'fulfilled' ? activePriceResult.value.data : null
    const approvedProposals = proposalsResult.status === 'fulfilled' ? proposalsResult.value.data ?? [] : []
    const lessons = lessonsResult.status === 'fulfilled' ? lessonsResult.value.data ?? [] : []
    const elasticity = elasticityResult.status === 'fulfilled' ? elasticityResult.value : []
    const activeDiscountData = activeDiscountsResult.status === 'fulfilled' ? activeDiscountsResult.value.data : null
    const discountProposals = discountProposalsResult.status === 'fulfilled' ? discountProposalsResult.value.data ?? [] : []
    let competitorGaps = competitorGapsResult.status === 'fulfilled' ? competitorGapsResult.value.data ?? [] : []
    const seasonalFactors = seasonalResult.status === 'fulfilled' ? seasonalResult.value : []
    const upcomingEvents = eventsResult.status === 'fulfilled' ? eventsResult.value.data ?? [] : []
    const anomalies = anomaliesResult.status === 'fulfilled' ? anomaliesResult.value.data ?? [] : []
    const agentConfig = agentConfigResult.status === 'fulfilled' ? agentConfigResult.value.data : null
    const suiteAvail = suiteAvailResult.status === 'fulfilled' ? suiteAvailResult.value : []
    const prevReport = prevReportResult.status === 'fulfilled' ? prevReportResult.value.data?.[0] : null
    const demandPattern = demandPatternResult.status === 'fulfilled' ? demandPatternResult.value : null
    const turnoCategoryRows = turnoCategoryResult.status === 'fulfilled' ? turnoCategoryResult.value : []
    const monthAgoKpis = monthAgoKpisResult.status === 'fulfilled' ? monthAgoKpisResult.value : null
    const categoryPeriodKPIs = categoryPeriodResult.status === 'fulfilled' ? categoryPeriodResult.value : []
    const pastSeasonalSummary = pastSeasonalResult.status === 'fulfilled' ? pastSeasonalResult.value : null
    const diaSemanaRows = diaSemanaResult.status === 'fulfilled' ? diaSemanaResult.value : []
    const guardrailsCount = guardrailsResult.count ?? 0

    // Recomputa gaps usando snapshots existentes (análise já feita na aba Concorrentes).
    // Não re-raspa — evita latência e respeita o fluxo onde o usuário controla quando analisar.
    // Inclui match por comodidades (se suite_amenities configurado) e por proximidade de preço.
    try {
      const snapshotCutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
      const { count: snapshotCount } = await admin
        .from('competitor_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('unit_id', unit.id)
        .eq('status', 'done')
        .gte('scraped_at', snapshotCutoff)

      if ((snapshotCount ?? 0) > 0) {
        await computeAndPersistGaps(unit.id, 14)
        const freshGaps = await admin.from('rm_competitor_price_gaps')
          .select('categoria_nossa, periodo, dia_tipo, preco_nosso, preco_concorrente_mediana, gap_pct, position, categoria_competitor, competitor_name, competitor_periodo, is_approximated')
          .eq('unit_id', unit.id)
          .order('gap_pct', { ascending: false })
          .limit(200)
        if (!freshGaps.error) competitorGaps = freshGaps.data ?? []
      }
    } catch { /* silencioso — não bloqueia o relatório */ }

    const currentSnapshot: KPISnapshot = kpis ? kpiSnapshotFromResponse(kpis) : {
      revpar: 0, trevpar: 0, giro: 0, ocupacao: 0, ticket: 0, receita: 0, locacoes: 0, tmo: 0
    }
    const prevSnapshot = prevKpis ? kpiSnapshotFromResponse(prevKpis) : null
    const lySnapshot = lyKpis ? kpiSnapshotFromResponse(lyKpis) : null
    const monthAgoSnapshot = monthAgoKpis ? kpiSnapshotFromResponse(monthAgoKpis) : null

    const prevReportData = prevReport?.report_data as WeeklyReportData | null
    const prevCurrentSnapshot = prevReportData?.kpis?.current ?? null
    const newAnomalies = anomalies.filter(a => a.status === 'open').length
    const resolvedAnomalies = anomalies.filter(a => a.status === 'resolved').length
    const lessonsSuccess = lessons.filter(l => l.verdict === 'success').length
    const lessonsNeutral = lessons.filter(l => l.verdict === 'neutral').length
    const lessonsFailure = lessons.filter(l => l.verdict === 'failure').length

    const guiaSharePct = channelKPIs
      .filter(c => c.canal === 'GUIA_GO' || c.canal === 'GUIA_SCHEDULED')
      .reduce((acc, c) => acc + c.representatividade, 0)
    const prevGuiaShare = prevReportData?.discounts?.guiaSharePct ?? 0

    const evolution: WeeklyReportData['evolution'] = {
      hasPreviousReport: !!prevReport,
      previousPeriodStart: prevReport?.period_start ?? null,
      kpiDeltas: prevSnapshot ? {
        revpar: deltaPct(currentSnapshot.revpar, prevSnapshot.revpar),
        giro: deltaPct(currentSnapshot.giro, prevSnapshot.giro),
        ocupacao: deltaPct(currentSnapshot.ocupacao, prevSnapshot.ocupacao),
        ticket: deltaPct(currentSnapshot.ticket, prevSnapshot.ticket),
        receita: deltaPct(currentSnapshot.receita, prevSnapshot.receita),
        tmo: deltaPct(currentSnapshot.tmo, prevSnapshot.tmo),
      } : { revpar: 0, giro: 0, ocupacao: 0, ticket: 0, receita: 0, tmo: 0 },
      guiaShareDelta: guiaSharePct - prevGuiaShare,
      metaGapDelta: 0,
      lessonsVerdict: { acertos: lessonsSuccess, neutros: lessonsNeutral, falhas: lessonsFailure },
      anomaliesNewCount: newAnomalies,
      anomaliesResolvedCount: resolvedAnomalies,
    }

    // budgetTracking — usa MTD (do dia 1 até hoje ou até periodEnd se mês diferente)
    const mtdKpis = mtdKpisResult.status === 'fulfilled' ? mtdKpisResult.value : null
    const mtdSnapshot = mtdKpis ? kpiSnapshotFromResponse(mtdKpis) : currentSnapshot
    const monthYear = budgetMonthYear
    const monthNum = budgetMonthNum
    const monthDaysTotal = getDaysInMonth(monthYear, monthNum)
    const firstOfMonth = new Date(Date.UTC(monthYear, monthNum - 1, 1))
    const daysDiff = Math.floor((mtdEndDate.getTime() - firstOfMonth.getTime()) / 86400000) + 1
    const monthDaysElapsed = Math.min(Math.max(daysDiff, 1), monthDaysTotal)
    const realizado = mtdSnapshot.receita
    const paceDiarioAtual = monthDaysElapsed > 0 ? realizado / monthDaysElapsed : 0
    const budgetYearly = (agentConfig?.budget_yearly ?? {}) as unknown as BudgetYearly
    const monthBudget = budgetYearly?.[String(monthYear)]?.[String(monthNum)]
    const meta = monthBudget?.receita ?? 0
    const daysRemaining = monthDaysTotal - monthDaysElapsed
    const paceDiarioNecessario = meta > 0 && daysRemaining > 0 ? (meta - realizado) / daysRemaining : 0
    const forecast = computeRevenueForecast(kpis, budgetYearly)
    // Usa a projeção do ERP (mais precisa — conta reservas confirmadas).
    // Fallback para ritmo linear caso a projeção do ERP não esteja disponível.
    const projecao = forecast.months[0]?.projected ?? (realizado + paceDiarioAtual * daysRemaining)

    const budgetTracking: WeeklyReportData['budgetTracking'] = {
      monthName: MONTH_PT[monthNum - 1],
      monthDaysTotal,
      monthDaysElapsed,
      realizado,
      projecao,
      meta,
      paceDiarioNecessario,
      paceDiarioAtual,
      aiLeverageComment: '',
    }

    // Tabela de preços ativa — usada apenas como contexto do prompt de IA (priceTableBlock
    // abaixo); a seção que renderizava essa tabela no relatório foi removida.
    const activePriceImport = activePriceData?.[0] ?? null
    type ParsedPriceRow = { categoria: string; periodo: string; dia_tipo: string; canal: string; preco: number }
    const activePriceRows = (activePriceImport?.parsed_data ?? []) as ParsedPriceRow[]

    const discountRows = ((activeDiscountData?.[0]?.parsed_data ?? activeDiscountData?.[0]?.discount_data ?? []) as {
      categoria: string; periodo: string; dia_semana: string; faixa_horaria: string; tipo_desconto: string; valor: number
    }[])

    const discounts: WeeklyReportData['discounts'] = {
      activeDiscounts: discountRows.slice(0, 20).map(d => ({
        categoria: d.categoria,
        periodo: d.periodo,
        diaSemana: d.dia_semana,
        faixaHoraria: d.faixa_horaria,
        tipoDesconto: d.tipo_desconto,
        valor: d.valor,
      })),
      guiaSharePct,
      guiaSharePrevWeek: prevGuiaShare,
      discountProposalsApprovedThisWeek: discountProposals.length,
      topDiscountImpact: discountRows.length > 0
        ? `${discountRows[0].valor}% em ${discountRows[0].categoria} ${discountRows[0].periodo}`
        : '',
    }

    const demand: WeeklyReportData['demand'] = {
      channelMix: channelKPIs.map(c => ({
        canal: c.canal,
        label: c.label,
        reservas: c.reservas,
        receita: c.receita,
        representatividade: c.representatividade,
      })),
      periodMix: periodMix.map(p => ({
        periodo: p.rentalType,
        locacoes: p.locacoes,
        receita: p.value,
        ticket: p.ticket,
        pct: p.percent,
      })),
      peakDow: demandPattern?.highDemandDays[0] ?? 'sexta-feira',
      peakHourRange: demandPattern?.highDemandSlots[0]?.match(/\d{2}:\d{2}-\d{2}:\d{2}/)?.[0] ?? '18:00-23:59',
      valleyDow: demandPattern?.lowDemandSlots[0]?.split(' ')[0] ?? 'quarta-feira',
      turnoCategoryTable: turnoCategoryRows.map(r => ({
        categoria: r.categoria,
        turno: r.turno,
        locacoes: r.locacoes,
        giro: r.giro,
        receita: r.receita,
        capacidade: r.capacidade,
      })),
    }

    // Carrega amenidades dos concorrentes para calcular vantagem qualitativa
    const ourSuiteAmenities = (agentConfig?.suite_amenities as Record<string, string[]> | null) ?? {}
    const compAmenitiesByName: Record<string, Record<string, string[]>> = {}
    if (Object.keys(ourSuiteAmenities).length > 0 && competitorGaps.length > 0) {
      const compNames = [...new Set(
        competitorGaps.map(g => (g as { competitor_name?: string }).competitor_name ?? '').filter(Boolean)
      )]
      const snapResults = await Promise.allSettled(
        compNames.map(name =>
          admin.from('competitor_snapshots')
            .select('competitor_name, raw_text')
            .eq('unit_id', unit.id)
            .eq('competitor_name', name)
            .eq('status', 'done')
            .order('scraped_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      )
      for (const result of snapResults) {
        if (result.status === 'fulfilled' && result.value.data) {
          const snap = result.value.data
          compAmenitiesByName[snap.competitor_name] = parseAmenitiesBySuite(snap.raw_text)
        }
      }
    }

    // competitors — fixed: use categoria_nossa / preco_concorrente_mediana
    const dominantCount = { underprice: 0, aligned: 0, overprice: 0 }
    for (const g of competitorGaps) {
      const pos = g.position as keyof typeof dominantCount
      if (pos in dominantCount) dominantCount[pos]++
    }
    const dominant = Object.entries(dominantCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'aligned'

    const competitors: WeeklyReportData['competitors'] = {
      gaps: competitorGaps.map(g => {
        const catNossa = g.categoria_nossa ?? ''
        const catConc  = (g as { categoria_competitor?: string }).categoria_competitor ?? ''
        const compName = (g as { competitor_name?: string }).competitor_name ?? ''

        // Comodidades que TEMOS e o concorrente NÃO tem
        let amenityAdvantage: string[] | undefined
        const ourAmens  = ourSuiteAmenities[catNossa] ?? []
        const compAmens = compAmenitiesByName[compName]?.[catConc] ?? []
        if (ourAmens.length > 0 && compAmens.length > 0) {
          const compSet = new Set(compAmens.map((a: string) => a.toLowerCase()))
          const advantage = ourAmens.filter(a => !compSet.has(a.toLowerCase()))
          if (advantage.length > 0) amenityAdvantage = advantage
        }

        return {
          categoria: catNossa,
          periodo: g.periodo ?? '',
          diaTipo: g.dia_tipo ?? '',
          precoNosso: g.preco_nosso ?? 0,
          medianaConc: g.preco_concorrente_mediana ?? 0,
          gapPct: g.gap_pct ?? 0,
          position: (g.position ?? 'aligned') as 'underprice' | 'aligned' | 'overprice',
          categoriaConc: catConc || undefined,
          competitorName: compName || undefined,
          amenityAdvantage,
          competitorPeriodo: g.competitor_periodo ?? undefined,
          periodoAproximado: g.is_approximated ?? false,
        }
      }),
      changesDetectedCount: 0,
      changesDirection: 'none',
      dominantPosition: dominant as 'underprice' | 'aligned' | 'overprice',
    }

    const outlook: WeeklyReportData['outlook'] = {
      seasonalFactors: seasonalFactors.map(f => ({
        date: f.date,
        dowLabel: f.day_of_week,
        factorRevpar: f.revpar_factor,
        factorGiro: f.giro_factor,
        level: f.is_hot ? 'hot' : f.is_cold ? 'cold' : 'normal',
      })),
      upcomingEvents: upcomingEvents.map(e => ({
        title: e.title,
        eventDate: e.event_date,
        eventType: e.event_type ?? '',
        impactDescription: e.impact_description ?? '',
      })),
      revenueForecast: (forecast.months ?? []).map(m => ({
        month: m.label,
        projected: m.projected ?? 0,
        budgeted: m.budget ?? 0,
        gapPct: m.gap_pct ?? 0,
      })),
    }

    // Historical price table analysis — learn from imported tables, not just proposals/checkpoints
    type HistoricalInsight = NonNullable<WeeklyReportData['intelligence']['historicalInsights']>[0]
    const historicalInsights: HistoricalInsight[] = []

    try {
      const allImportsResult = await admin
        .from('price_imports')
        .select('id, valid_from, valid_until, parsed_data')
        .eq('unit_id', unit.id)
        .eq('import_type', 'prices')
        .not('parsed_data', 'is', null)
        .order('valid_from', { ascending: false })
        .limit(5)

      const allImports = (allImportsResult.data ?? []).reverse() // oldest first

      if (allImports.length >= 2) {
        const todayStr = new Date().toISOString().slice(0, 10)
        const capDate = (start: string, end: string | null): string => {
          const maxEnd = new Date(new Date(start + 'T12:00:00Z').getTime() + 30 * 86400000).toISOString().slice(0, 10)
          const e = end ?? todayStr
          return e < maxEnd ? e : maxEnd
        }

        // Up to 3 most recent consecutive pairs
        const startIdx = Math.max(0, allImports.length - 4)
        const pairs: [typeof allImports[0], typeof allImports[0]][] = []
        for (let i = startIdx; i < allImports.length - 1; i++) {
          pairs.push([allImports[i], allImports[i + 1]])
        }

        // Parallel KPI fetches for all pairs
        const kpiResults = await Promise.allSettled(
          pairs.flatMap(([a, b]) => [
            fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(a.valid_from), isoToDDMMYYYY(capDate(a.valid_from, a.valid_until))),
            fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(b.valid_from), isoToDDMMYYYY(capDate(b.valid_from, b.valid_until))),
          ])
        )

        for (let pi = 0; pi < pairs.length; pi++) {
          const [tblA, tblB] = pairs[pi]
          const kpiAResult = kpiResults[pi * 2]
          const kpiBResult = kpiResults[pi * 2 + 1]

          const rowsA = (tblA.parsed_data ?? []) as ParsedPriceRow[]
          const rowsB = (tblB.parsed_data ?? []) as ParsedPriceRow[]

          // Compara preços médios por categoria+período+canal — funciona tanto para o
          // formato legado (dia_tipo: 'semana'/'fds_feriado') quanto para o novo
          // formato dia-a-dia (dias: ['domingo',...] + hora_inicio/hora_fim) onde dia_tipo=''.
          const buildAvgMap = (rows: ParsedPriceRow[]): Record<string, number> => {
            const acc: Record<string, { sum: number; count: number }> = {}
            for (const r of rows) {
              const k = `${r.categoria}|${r.periodo}|${r.canal}`
              if (!acc[k]) acc[k] = { sum: 0, count: 0 }
              acc[k].sum += r.preco
              acc[k].count++
            }
            return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.sum / v.count]))
          }
          const mapA = buildAvgMap(rowsA)
          const mapB = buildAvgMap(rowsB)

          const rawChanges: HistoricalInsight['topChanges'] = []
          for (const [key, newAvg] of Object.entries(mapB)) {
            const prev = mapA[key]
            if (prev != null && Math.abs((newAvg - prev) / prev) >= 0.01) {
              const [categoria, periodo, canal] = key.split('|')
              rawChanges.push({
                categoria,
                periodo,
                diaTipo: canal,
                canal,
                precoAnterior: prev,
                precoNovo: newAvg,
                variacaoPct: ((newAvg - prev) / prev) * 100,
              })
            }
          }

          if (rawChanges.length === 0) continue

          const changes = rawChanges

          const snapA = kpiAResult.status === 'fulfilled' ? kpiSnapshotFromResponse(kpiAResult.value) : null
          const snapB = kpiBResult.status === 'fulfilled' ? kpiSnapshotFromResponse(kpiBResult.value) : null

          const drRevpar = snapA && snapB ? deltaPct(snapB.revpar, snapA.revpar) : null
          const drGiro = snapA && snapB ? deltaPct(snapB.giro, snapA.giro) : null
          const avgChangePct = changes.reduce((s, c) => s + c.variacaoPct, 0) / changes.length

          let verdict: HistoricalInsight['verdict'] = 'unknown'
          if (drRevpar !== null && drGiro !== null) {
            if (avgChangePct > 0) {
              // Aumentou preços: sucesso = RevPAR subiu significativamente
              verdict = drRevpar > 3 ? 'success' : (drRevpar < -3 || drGiro < -10) ? 'failure' : 'neutral'
            } else {
              // Reduziu preços: sucesso só se RevPAR ficou estável E giro cresceu muito
              // Queda de RevPAR com redução de preços = neutro (volume não compensou)
              verdict = (drGiro > 10 && drRevpar > -1) ? 'success' : drRevpar < -5 ? 'failure' : 'neutral'
            }
          }

          historicalInsights.push({
            fromDate: tblA.valid_from,
            toDate: tblB.valid_from,
            changesCount: changes.length,
            avgChangePct,
            kpiBefore: snapA ? { revpar: snapA.revpar, giro: snapA.giro } : null,
            kpiAfter: snapB ? { revpar: snapB.revpar, giro: snapB.giro } : null,
            deltaRevpar: drRevpar,
            deltaGiro: drGiro,
            verdict,
            topChanges: changes
              .sort((a, b) => Math.abs(b.variacaoPct) - Math.abs(a.variacaoPct))
              .slice(0, 6),
          })
        }
      }
    } catch (e) {
      console.warn('[generateWeeklyReport] Historical insights failed:', e)
    }

    const weekHighlightParts: string[] = []
    if (lessonsSuccess > 0) weekHighlightParts.push(`${lessonsSuccess} lição(ões) com acerto`)
    if (lessonsFailure > 0) weekHighlightParts.push(`${lessonsFailure} falha(s) identificada(s)`)
    const highConfEl = elasticity.filter(e => e.confidence === 'high').length
    if (highConfEl > 0) weekHighlightParts.push(`${highConfEl} elasticidade(s) com alta confiança`)

    let weekHighlight = weekHighlightParts.join('; ')
    if (!weekHighlight && historicalInsights.length > 0) {
      const latest = historicalInsights[historicalInsights.length - 1]
      const revStr = latest.deltaRevpar !== null
        ? `RevPAR ${latest.deltaRevpar >= 0 ? '+' : ''}${latest.deltaRevpar.toFixed(1)}%`
        : null
      const giroStr = latest.deltaGiro !== null
        ? `Giro ${latest.deltaGiro >= 0 ? '+' : ''}${latest.deltaGiro.toFixed(1)}%`
        : null
      weekHighlight = `Última transição de tabela (${latest.fromDate} → ${latest.toDate}): ${latest.changesCount} preços alterados — ${[revStr, giroStr].filter(Boolean).join(', ')} — resultado ${latest.verdict === 'success' ? 'positivo' : latest.verdict === 'failure' ? 'negativo' : latest.verdict === 'neutral' ? 'neutro' : 'sem dados suficientes'}`
    }
    if (!weekHighlight) weekHighlight = 'Sem lições de pricing ou anomalias registradas neste período'

    const intelligence: WeeklyReportData['intelligence'] = {
      // fixed: use detected_at instead of created_at; status field is present
      anomaliesDetected: anomalies.filter(a => a.status === 'open').map(a => ({
        metric: a.metric,
        direction: a.direction ?? '',
        zScore: a.z_score ?? 0,
        scope: JSON.stringify(a.scope ?? {}),
      })),
      anomaliesResolved: anomalies.filter(a => a.status === 'resolved').map(a => ({
        metric: a.metric,
        resolvedAt: a.detected_at ?? '',
      })),
      newLessonsCount: lessons.length,
      elasticityUpdatedCount: elasticity.filter(e => e.n_observations >= 3).length,
      seasonalityRecomputed: false,
      weekHighlight,
      historicalInsights,
    }

    const agentConfigSection: WeeklyReportData['agentConfig'] = {
      pricingStrategy: agentConfig?.pricing_strategy ?? 'moderado',
      focusMetric: agentConfig?.focus_metric ?? 'revpar',
      maxVariationPct: agentConfig?.max_variation_pct ?? 15,
      guardrailsCount,
      sharedContext: agentConfig?.shared_context ?? null,
      suiteCapacity: suiteAvail.map(s => ({
        categoria: s.categoria,
        total: s.total,
        bloqueadas: s.bloqueadas,
        disponiveis: s.disponiveis,
        motivosBloqueio: s.motivos_bloqueio ?? [],
      })),
    }

    // AI: executive summary — prompt focado em JSON puro.
    // NÃO usa buildSystemPrompt (chat agent): as instruções de tools/proposals do agente
    // conflitam com o pedido de JSON estrito e fazem o modelo retornar resposta errada.
    const maxVar = agentConfig?.max_variation_pct ?? 15
    const pricingStrategy = agentConfig?.pricing_strategy ?? 'moderado'
    const focusMetric = agentConfig?.focus_metric ?? 'revpar'
    const FOCUS_LABELS: Record<string, string> = {
      revpar: 'RevPAR', ocupacao: 'Ocupação', ticket: 'Ticket Médio',
      trevpar: 'TRevPAR', giro: 'Giro', balanceado: 'Balanceado',
    }

    const { formatMoney: fmtMoney } = makeCurrencyFormatter(unitSlug)
    const unitStructureBlock = buildUnitStructureBlock(suiteAvail, [], [])

    // Oportunidades por categoria × período/turno/dia da semana, com link direto pro
    // Agente RM em cada item. dia_semana usa contagem real de locações (diaSemanaRows) —
    // sem isso, um único aluguel num dia fraco podia disparar um "desvio" de puro ruído.
    const opportunities: WeeklyReportData['opportunities'] = detectOpportunities(
      categoryPeriodKPIs,
      turnoCategoryRows,
      diaSemanaRows,
      fmtMoney,
    ).map(o => ({
      dimension: o.dimension,
      categoria: o.categoria,
      label: o.label,
      metric: o.metric,
      value: o.value,
      benchmarkValue: o.benchmarkValue,
      gapPct: o.gapPct,
      direction: o.direction,
      suggestion: o.suggestion,
      agentPromptLink: `/dashboard/agente?unit=${unitSlug}&q=${encodeURIComponent(`[Relatório ${startDDMM}–${endDDMM}] ${o.agentPrompt}`)}`,
    }))
    const opportunitiesBlock = opportunities.length > 0
      ? `## Oportunidades detectadas (top ${opportunities.length})\n` + opportunities.map(o => `- ${o.categoria} — ${o.suggestion}`).join('\n')
      : null

    // Contexto analítico
    const competitorGapsTyped: CompetitorGap[] = competitorGaps.map(g => ({
      categoria_nossa: g.categoria_nossa ?? '',
      categoria_competitor: (g as { categoria_competitor?: string }).categoria_competitor ?? '',
      periodo: g.periodo ?? '',
      dia_tipo: g.dia_tipo ?? '',
      preco_nosso: g.preco_nosso ?? 0,
      preco_concorrente_mediana: g.preco_concorrente_mediana ?? 0,
      preco_concorrente_min: 0,
      preco_concorrente_max: 0,
      gap_pct: g.gap_pct ?? 0,
      position: (g.position ?? 'aligned') as 'underprice' | 'aligned' | 'overprice',
      competitor_name: (g as { competitor_name?: string }).competitor_name ?? '',
      competitor_periodo: g.competitor_periodo ?? undefined,
      is_approximated: g.is_approximated ?? false,
    }))
    const competitorBlock = buildCompetitorGapBlock(competitorGapsTyped)
    const seasonalityBlock = buildSeasonalityBlock(seasonalFactors)
    const elasticityBlock = buildElasticityBlock(elasticity)
    const forecastBlock = buildForecastBlock(
      computeRevenueForecast(kpis, (agentConfig?.budget_yearly as BudgetYearly | null) ?? null)
    )
    const strategicMemoryBlock = buildStrategicMemoryBlock(
      approvedProposals as Parameters<typeof buildStrategicMemoryBlock>[0],
      kpis,
      prevKpis,
      fmtMoney,
    )
    const [lessonsBlock, rejectionBlock] = await Promise.all([
      buildLessonsBlockForUnit(unit.id, {}).catch(() => ''),
      buildRejectionLessonsBlock(unit.id).catch(() => ''),
    ])
    const demandPatternCtx = demandPattern
      ? buildDemandPatternBlock(demandPattern, unit.name, 60)
      : ''
    const historicalCtx = historicalInsights.length > 0 ? `## Histórico de mudanças de tabela (aprendizado)
${historicalInsights.map(h => `- ${h.fromDate}→${h.toDate}: ${h.changesCount} preços (${h.avgChangePct > 0 ? '+' : ''}${h.avgChangePct.toFixed(1)}%) → Δ RevPAR ${h.deltaRevpar !== null ? `${h.deltaRevpar > 0 ? '+' : ''}${h.deltaRevpar.toFixed(1)}%` : '?'}, Δ Giro ${h.deltaGiro !== null ? `${h.deltaGiro > 0 ? '+' : ''}${h.deltaGiro.toFixed(1)}%` : '?'} (${h.verdict})`).join('\n')}` : ''

    // Períodos de referência — necessários tanto para o contexto quanto para a mensagem
    const lyStartStr = lyStart.toISOString().slice(0, 10)
    const lyEndStr   = lyEnd.toISOString().slice(0, 10)
    const fmtPeriodStart  = isoToDDMMYYYY(periodStart)
    const fmtPeriodEnd    = isoToDDMMYYYY(periodEnd)
    const fmtPrevStart    = isoToDDMMYYYY(prevStartStr)
    const fmtPrevEnd      = isoToDDMMYYYY(prevEndStr)
    const fmtLyStart      = isoToDDMMYYYY(lyStartStr)
    const fmtLyEnd        = isoToDDMMYYYY(lyEndStr)

    // KPIs resumidos — injetados diretamente na mensagem do usuário
    const kpiLine = (s: KPISnapshot, label: string) =>
      `## ${label}\n- RevPAR: ${fmtMoney(s.revpar)} | TRevPAR: ${fmtMoney(s.trevpar)} | Giro: ${s.giro.toFixed(2)} | Ocupação: ${(s.ocupacao * 100).toFixed(1)}%\n- Ticket: ${fmtMoney(s.ticket)} | Receita: ${fmtMoney(s.receita)} | Locações: ${s.locacoes} | TMO: ${s.tmo.toFixed(1)}h`

    // Tabela de preços ativa — compacta por categoria
    const priceTableBlock = activePriceRows.length > 0
      ? `## Tabela de preços ativa (vigência: ${activePriceImport?.valid_from ?? ''})\n` +
        [...new Set(activePriceRows.map(r => r.categoria))].map(cat => {
          const rows = activePriceRows.filter(r => r.categoria === cat)
          return `### ${cat}\n` + rows.map(r => `- ${r.periodo} | ${r.dia_tipo} | ${r.canal}: ${fmtMoney(r.preco)}`).join('\n')
        }).join('\n')
      : null

    // KPIs por categoria — essencial para recomendações específicas por tipo de suíte
    const catData = kpis?.DataTableSuiteCategory ?? []
    const catBlock = catData.length > 0
      ? `## KPIs por categoria (${fmtPeriodStart}–${fmtPeriodEnd})\n` + catData.map(entry => {
          const [cat, d] = Object.entries(entry)[0] as [string, import('@/lib/kpis/types').SuiteCategoryKPI]
          return `- ${cat}: RevPAR ${fmtMoney(d.revpar)} | Giro ${d.giro.toFixed(2)} | Ocupação ${d.occupancyRate.toFixed(1)}% | Ticket ${fmtMoney(d.totalTicketAverage)} | Locações ${d.totalRentalsApartments}`
        }).join('\n')
      : null

    // Mix por canal
    const chanBlock = channelKPIs.length > 0
      ? `## Mix por canal\n` + channelKPIs.map(c => `- ${c.label}: ${c.reservas} res | ${fmtMoney(c.receita)} | ${c.representatividade.toFixed(1)}% da receita`).join('\n')
      : null

    // Mix por período (3h/6h/12h/etc.)
    const perBlock = periodMix.length > 0
      ? `## Mix por período\n` + periodMix.map(p => `- ${p.rentalType}: ${p.locacoes} loc | ${fmtMoney(p.value)} | ${p.percent.toFixed(1)}%`).join('\n')
      : null

    // Contexto compacto para a IA: apenas o essencial para o resumo executivo.
    // Blocos longos (tabela de preços, lessons detalhadas, memória estratégica) ficam nas
    // seções do relatório mas NÃO são enviados ao modelo — reduz latência e evita falhas.
    const summaryContextBlocks = [
      kpiLine(currentSnapshot, `KPIs ${fmtPeriodStart}–${fmtPeriodEnd}`),
      prevSnapshot ? kpiLine(prevSnapshot, `Semana anterior ${fmtPrevStart}–${fmtPrevEnd}`) : null,
      lySnapshot ? kpiLine(lySnapshot, `Mesmo período do ano anterior ${fmtLyStart}–${fmtLyEnd}`) : null,
      catBlock,
      chanBlock,
      perBlock,
      competitorBlock || null,
      seasonalityBlock || null,
      buildPastSeasonalityBlock(pastSeasonalSummary) || null,
      forecastBlock || null,
      historicalCtx || null,
      opportunitiesBlock,
    ].filter(Boolean).join('\n\n')

    // Trava anti-Guia: se a unidade não opera o canal Guia de Motéis, não sugerir descontos do Guia.
    const hasGuia = channelKPIs.some(c => /guia/i.test(c.canal ?? '') || /guia/i.test(c.label ?? ''))
    const noGuiaNote = hasGuia
      ? ''
      : '\nEsta unidade NÃO opera o canal Guia de Motéis: NUNCA mencione Guia, descontos do Guia ou share do Guia, e NUNCA use actionType "discount_proposal".'

    // System prompt minimalista: identidade de analista RM + config da unidade.
    // NÃO inclui tools/proposals do chat agent — esses conflitam com JSON-only output.
    // Todo o contexto analítico vai em reportContextBlocks (injetado na mensagem do usuário).
    const reportSystemPrompt = `Você é o analista de Revenue Management de ${unit.name}.\nEstratégia: ${pricingStrategy} | Foco: ${FOCUS_LABELS[focusMetric] ?? focusMetric} | Variação máx: ±${maxVar}%${noGuiaNote}\nRESPONDA APENAS COM JSON VÁLIDO — sem texto extra, sem markdown fence.`

    // Mensagem do usuário: pede o JSON do relatório semanal com contexto de períodos
    const weeklyReportUserMsg = `Elabore o resumo executivo do relatório semanal de ${unit.name} para o período ${fmtPeriodStart} a ${fmtPeriodEnd}.

PERÍODOS DE REFERÊNCIA (cite SEMPRE ao mencionar variações — use APENAS o formato DD/MM/AAAA, NUNCA ISO):
- Período atual: ${fmtPeriodStart} a ${fmtPeriodEnd} (${durationDays} dias)
- Semana anterior (mesma duração): ${fmtPrevStart} a ${fmtPrevEnd}
- Mesmo período do ano anterior: ${fmtLyStart} a ${fmtLyEnd}

Você é um especialista de Revenue Management experiente explicando o período para o DONO do negócio — alguém sem tempo de juntar dados na mão. Ele não quer uma lista de números soltos, quer entender o que aconteceu, por que aconteceu, e o que fazer. Interprete, não apenas relate.

Todos os números que você recebe abaixo (KPIs, sazonalidade, elasticidade, previsão, oportunidades) vêm de queries diretas no banco do ERP — são reais e atualizados, não estimativas. Escreva com confiança sobre eles; não invente números novos, mas também não hedge sobre os que já são dados.

REGRAS INVIOLÁVEIS para o JSON:
1. "headline": inclua o período atual em DD/MM e um dado numérico chave.
2. "diagnosis": 3 a 5 frases interpretando o período como um especialista. SEMPRE inclua as DUAS comparações, nunca só uma: (a) vs semana anterior (${fmtPrevStart}–${fmtPrevEnd}) — mostra o momentum recente; (b) vs mesmo período do ano anterior (${fmtLyStart}–${fmtLyEnd}) — controla sazonalidade (feriados, época do ano, clima), é o sinal de se a unidade está genuinamente melhor ou só repetindo o padrão esperado pra essa época. Se as duas comparações contarem histórias diferentes (ex: subiu vs semana passada mas ainda abaixo do ano passado), diga isso explicitamente — é a informação mais importante do diagnóstico. Se houver o bloco "Sazonalidade esperada para este período" no contexto, USE-O SEMPRE: diga se o resultado bate com o que já era esperado pra essa época do ano (não é motivo de destaque nem alarme) ou se é um desvio real que merece atenção — essa distinção é o que separa uma leitura de especialista de uma leitura ingênua dos números. NUNCA use siglas como "LY" ou "yoy" — escreva "vs ano anterior (${fmtLyStart}–${fmtLyEnd})". Se houver "Oportunidades detectadas" no contexto, cite a mais relevante pelo nome (categoria + recorte específico) e explique a causa provável do desvio.
3. "keyPoints": 2 bullets curtos e factuais (evidência numérica de apoio ao diagnosis) — não repita o que já está no diagnosis, complemente.
4. "priorityAction": use dados REAIS. NUNCA sugira variação > ${maxVar}% — se o mercado exigir mais, diga "ajustar em ${maxVar}% agora e reavaliar". Pode propor novo tier de dia se o padrão horário justificar. Se houver "Oportunidades detectadas" no contexto, baseie a priorityAction na de maior impacto — não invente uma oportunidade diferente das listadas. NUNCA proponha um valor percentual específico de reajuste (ex: "reduza 8%") — isso é calculado depois no Agente RM respeitando guardrails; fale em direção e recorte (categoria, dia, período), não em número.
5. "watchNextWeek": 1-2 frases sobre o que merece atenção na próxima semana (evento futuro, tendência a confirmar, risco a monitorar). Se não houver nada específico, diga o que acompanhar da própria oportunidade prioritária.
6. "agentPrompt": instrução cirúrgica (máx 280 chars) que NÃO mencione percentual fixo — cite categorias específicas, padrão de dia (semana vs FDS) e objetivo de KPI. Exemplos: "Analise RevPAR por categoria e reduza seletivamente semana para categorias com giro <2 e eleve FDS premium 3-5%." NÃO escreva "ajuste de até X%" — isso faz o agente aplicar o mesmo % em tudo. SEMPRE preencha este campo — nunca deixe null.
7. "actionType": "price_proposal" | "discount_proposal" | "agent_config" | "none". Use "none" SOMENTE se os KPIs estão dentro da meta E sem variação relevante — na prática quase sempre há uma ação útil.

Retorne APENAS o JSON (sem markdown fence, sem texto extra):
{
  "headline": "string",
  "diagnosis": "string — 3 a 5 frases, leitura de especialista",
  "keyPoints": ["string", "string"],
  "priorityAction": "string dentro de ${maxVar}%, sem número exato de reajuste",
  "watchNextWeek": "string — 1 a 2 frases",
  "tone": "positive|neutral|warning",
  "actionType": "price_proposal|discount_proposal|agent_config|none",
  "agentPrompt": "string máx 280 chars",
  "agentConfigSuggestion": null,
  "aiLeverageComment": "2-3 alavancas concretas com números para atingir a meta"
}`

    // Fallback data-driven: usa KPIs reais quando a IA falha — nunca "Dados coletados com sucesso"
    const fallbackRevparDelta = prevSnapshot ? deltaPct(currentSnapshot.revpar, prevSnapshot.revpar) : null
    const fallbackKeyPoints = [
      currentSnapshot.giro > 0
        ? `Giro ${currentSnapshot.giro.toFixed(2)} loc/suíte${prevSnapshot ? ` vs ${prevSnapshot.giro.toFixed(2)} na semana anterior` : ''}`
        : null,
      currentSnapshot.receita > 0
        ? `Receita ${fmtMoney(currentSnapshot.receita)}, ${currentSnapshot.locacoes} locações`
        : null,
    ].filter(Boolean) as string[]
    // Não repete o texto de opportunities[0] aqui — ele já aparece como priorityAction
    // abaixo. O diagnosis do fallback só aponta ONDE está o maior desvio (categoria +
    // recorte), o texto completo da sugestão fica só na ação prioritária.
    const dimensionLabelPt: Record<string, string> = { periodo: 'período', turno: 'turno', dia_semana: 'dia' }
    const fallbackDiagnosis = currentSnapshot.revpar > 0
      ? `RevPAR de ${fmtMoney(currentSnapshot.revpar)} no período${fallbackRevparDelta !== null ? ` — ${fallbackRevparDelta >= 0 ? 'alta' : 'queda'} de ${Math.abs(fallbackRevparDelta).toFixed(1)}% vs semana anterior (${fmtPrevStart}–${fmtPrevEnd})` : ''}.${opportunities.length > 0 ? ` Maior desvio do período: ${opportunities[0].categoria}, ${dimensionLabelPt[opportunities[0].dimension] ?? opportunities[0].dimension} "${opportunities[0].label}" — detalhes na ação prioritária abaixo.` : ' Não foi possível gerar a leitura interpretativa completa — os dados numéricos abaixo estão corretos, mas a IA não respondeu a tempo.'}`
      : 'Sem dados suficientes para o período.'

    // Link genérico sempre presente — garante que todo relatório tem caminho para o agente
    const genericAgentLink = `/dashboard/agente?unit=${unitSlug}&q=${encodeURIComponent(`[Relatório ${fmtPeriodStart}–${fmtPeriodEnd}] Analise os KPIs desta semana, compare com a semana anterior e sugira a ação de maior impacto para o próximo período.`)}`

    let executiveSummary: WeeklyReportData['executiveSummary'] = {
      headline: `${fmtPeriodStart}–${fmtPeriodEnd}: RevPAR ${fmtMoney(currentSnapshot.revpar)}`,
      diagnosis: fallbackDiagnosis,
      keyPoints: fallbackKeyPoints.length > 0 ? fallbackKeyPoints : ['Dados do período coletados'],
      priorityAction: opportunities[0] ? `${opportunities[0].categoria} — ${opportunities[0].suggestion}` : '',
      watchNextWeek: '',
      tone: fallbackRevparDelta !== null && fallbackRevparDelta > 2 ? 'positive' : fallbackRevparDelta !== null && fallbackRevparDelta < -3 ? 'warning' : 'neutral',
      actionType: opportunities.length > 0 ? 'price_proposal' : 'none',
      agentPromptLink: opportunities[0]?.agentPromptLink ?? genericAgentLink,
    }
    let aiLeverageComment = ''

    // 2 tentativas — a IA escreve o diagnóstico interpretativo (não é texto estático);
    // uma falha transitória de API não deve degradar pro fallback sem pelo menos 1 retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text } = await generateText({
          model: ANALYSIS_MODEL,
          system: reportSystemPrompt,
          messages: [{ role: 'user', content: summaryContextBlocks ? `${summaryContextBlocks}\n\n---\n\n${weeklyReportUserMsg}` : weeklyReportUserMsg }],
          maxOutputTokens: 1800,
        })
        const stripped = text
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/```json|```/g, '')
          .trim()
        const jsonMatch = stripped.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error(`No JSON found. Raw: ${text.slice(0, 200)}`)
        const parsed = JSON.parse(jsonMatch[0])
        const agentPromptRaw: string | null = parsed.agentPrompt ?? null
        const specificLink = agentPromptRaw
          ? `/dashboard/agente?unit=${unitSlug}&q=${encodeURIComponent(`[Relatório semanal ${fmtPeriodStart}–${fmtPeriodEnd}] ${agentPromptRaw}`)}`
          : null
        executiveSummary = {
          headline: parsed.headline ?? executiveSummary.headline,
          diagnosis: parsed.diagnosis ?? executiveSummary.diagnosis,
          keyPoints: parsed.keyPoints ?? executiveSummary.keyPoints,
          priorityAction: parsed.priorityAction ?? '',
          watchNextWeek: parsed.watchNextWeek ?? '',
          tone: parsed.tone ?? 'neutral',
          actionType: parsed.actionType ?? 'none',
          // Específico quando a IA gerou agentPrompt; genérico como garantia mínima
          agentPromptLink: specificLink ?? genericAgentLink,
          agentConfigSuggestion: parsed.agentConfigSuggestion ?? undefined,
        }
        aiLeverageComment = parsed.aiLeverageComment ?? ''
        break
      } catch (e) {
        console.error(`[generateWeeklyReport] AI summary failed (fallback ativo): ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    budgetTracking.aiLeverageComment = aiLeverageComment

    const reportData: WeeklyReportData = {
      period: {
        start: periodStart,
        end: periodEnd,
        unit: unit.name,
        unitSlug,
        generatedAt: new Date().toISOString(),
      },
      executiveSummary,
      evolution,
      budgetTracking,
      kpis: {
        current: currentSnapshot,
        previousWeek: prevSnapshot,
        previousMonth: monthAgoSnapshot,
        sameWeekLastYear: lySnapshot,
      },
      opportunities,
      discounts,
      demand,
      competitors,
      outlook,
      intelligence,
      agentConfig: agentConfigSection,
    }

    await admin
      .from('rm_weekly_reports')
      .update({
        status: 'done',
        generated_at: new Date().toISOString(),
        report_data: reportData as unknown as Json,
        ai_summary: executiveSummary.headline,
      })
      .eq('id', reportId)

  } catch (err) {
    console.error('[generateWeeklyReport] Fatal error:', err)
    await admin
      .from('rm_weekly_reports')
      .update({
        status: 'failed',
        error_msg: err instanceof Error ? err.message : String(err),
      })
      .eq('id', reportId)
  }

  return reportId
}
