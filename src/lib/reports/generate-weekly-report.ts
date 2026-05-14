import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import type { Database, Json } from '@/types/database.types'
import type { WeeklyReportData, KPISnapshot } from './types'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs } from '@/lib/automo/channel-kpis'
import { getSuiteAvailabilityByCategory } from '@/lib/automo/suite-availability'
import { getUpcomingSeasonalFactors, buildSeasonalityBlock } from '@/lib/seasonality/compute'
import { getElasticityForUnit, buildElasticityBlock } from '@/lib/pricing/elasticity'
import { computeRevenueForecast, buildForecastBlock } from '@/lib/forecast/revenue-forecast'
import { ANALYSIS_MODEL } from '@/lib/agente/model'
// ANALYSIS_MODEL continua sendo usado para fallback — buildSystemPrompt usa a identidade do agente,
// mas o modelo de geração (custo/latência) continua sendo o ANALYSIS_MODEL (gpt-4.1-mini BYOK)
import type { BudgetYearly } from '@/lib/budget/google-sheets'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import { computeAndPersistGaps, parseAmenitiesBySuite, buildCompetitorGapBlock } from '@/lib/competitors/detect-changes'
import type { CompetitorGap } from '@/lib/competitors/detect-changes'
import { buildSystemPrompt } from '@/lib/agente/system-prompt'
import type { KPIPeriod, PriceImportForPrompt } from '@/lib/agente/system-prompt'
import { buildStrategicMemoryBlock } from '@/lib/agente/context-blocks'
import { buildLessonsBlockForUnit } from '@/lib/agente/pricing-lessons'
import { buildRejectionLessonsBlock } from '@/lib/agente/rejection-lessons'
import { buildUnitStructureBlock } from '@/lib/agente/unit-structure'
import { queryDemandPattern, buildDemandPatternBlock } from '@/lib/automo/demand-pattern'

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
): Promise<void> {
  const admin = getAdminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .single()

  if (!unit) {
    console.error('[generateWeeklyReport] Unit not found:', unitSlug)
    return
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
    return
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

  // Upcoming events cutoff
  const eventsEnd = new Date(periodEnd + 'T12:00:00Z')
  eventsEnd.setUTCDate(eventsEnd.getUTCDate() + 14)
  const eventsEndStr = eventsEnd.toISOString().slice(0, 10)

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

    // budgetTracking
    const periodEndDate = new Date(periodEnd + 'T12:00:00Z')
    const monthYear = periodEndDate.getUTCFullYear()
    const monthNum = periodEndDate.getUTCMonth() + 1
    const monthDaysTotal = getDaysInMonth(monthYear, monthNum)
    const firstOfMonth = new Date(Date.UTC(monthYear, monthNum - 1, 1))
    const daysDiff = Math.floor((periodEndDate.getTime() - firstOfMonth.getTime()) / 86400000) + 1
    const monthDaysElapsed = Math.min(daysDiff, monthDaysTotal)
    const realizado = currentSnapshot.receita
    const paceDiarioAtual = monthDaysElapsed > 0 ? realizado / monthDaysElapsed : 0
    const budgetYearly = (agentConfig?.budget_yearly ?? {}) as unknown as BudgetYearly
    const monthBudget = budgetYearly?.[String(monthYear)]?.[String(monthNum)]
    const meta = monthBudget?.receita ?? 0
    const daysRemaining = monthDaysTotal - monthDaysElapsed
    const projecao = realizado + paceDiarioAtual * daysRemaining
    const paceDiarioNecessario = meta > 0 && daysRemaining > 0 ? (meta - realizado) / daysRemaining : 0
    const forecast = computeRevenueForecast(kpis, budgetYearly)

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

    // pricing — fixed: use dia_tipo from DB and map to diaTipo for WeeklyReportData
    const activePriceImport = activePriceData?.[0] ?? null
    type ParsedPriceRow = { categoria: string; periodo: string; dia_tipo: string; canal: string; preco: number }
    const activePriceRows = (activePriceImport?.parsed_data ?? []) as ParsedPriceRow[]

    const pricing: WeeklyReportData['pricing'] = {
      activePriceTable: activePriceImport ? {
        id: activePriceImport.id,
        validFrom: activePriceImport.valid_from,
        rows: activePriceRows.map(r => ({
          categoria: r.categoria,
          periodo: r.periodo,
          diaTipo: r.dia_tipo,
          canal: r.canal,
          preco: r.preco,
        })),
      } : null,
      proposalsApprovedThisWeek: approvedProposals.map(p => {
        const rows = (p.rows as { variacao_pct?: number }[]) ?? []
        const avg = rows.length > 0
          ? rows.reduce((s, r) => s + (r.variacao_pct ?? 0), 0) / rows.length
          : 0
        return {
          id: p.id.slice(0, 8),
          approvedAt: p.approved_at ?? '',
          rowsCount: rows.length,
          avgVariacaoPct: avg,
        }
      }),
      // fixed: use delta_revpar_pct / delta_giro_pct (columns as in DB)
      lessonsCompleted: lessons.map(l => ({
        categoria: l.categoria ?? '',
        periodo: l.periodo ?? '',
        diaTipo: l.dia_tipo ?? '',
        precoAnterior: l.preco_anterior ?? 0,
        precoNovo: l.preco_novo ?? 0,
        variacaoPct: l.variacao_pct ?? 0,
        deltaRevpar: l.delta_revpar_pct ?? 0,
        deltaGiro: l.delta_giro_pct ?? 0,
        verdict: (l.verdict ?? 'neutral') as 'success' | 'neutral' | 'failure',
        checkpointDays: l.checkpoint_days ?? 7,
      })),
      elasticityHighlights: elasticity
        .filter(e => e.confidence === 'high' || e.confidence === 'medium')
        .slice(0, 6)
        .map(e => ({
          categoria: e.categoria,
          periodo: e.periodo,
          diaTipo: e.dia_tipo,
          elasticity: e.elasticity ?? 0,
          confidence: e.confidence as 'high' | 'medium' | 'low',
          interpretation: (e.elasticity ?? 0) < -1
            ? 'elástico: subida de preço reduz receita'
            : (e.elasticity ?? 0) < 0
            ? 'moderadamente elástico'
            : 'inelástico: preço pode subir sem perder giro',
        })),
    }

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

          const mapA: Record<string, number> = {}
          for (const r of rowsA) {
            mapA[`${r.categoria}|${r.periodo}|${r.dia_tipo}|${r.canal}`] = r.preco
          }

          const rawChanges: HistoricalInsight['topChanges'] = []
          for (const r of rowsB) {
            const key = `${r.categoria}|${r.periodo}|${r.dia_tipo}|${r.canal}`
            const prev = mapA[key]
            if (prev != null && Math.abs((r.preco - prev) / prev) >= 0.01) {
              rawChanges.push({
                categoria: r.categoria,
                periodo: r.periodo,
                diaTipo: r.dia_tipo,
                canal: r.canal,
                precoAnterior: prev,
                precoNovo: r.preco,
                variacaoPct: ((r.preco - prev) / prev) * 100,
              })
            }
          }

          if (rawChanges.length === 0) continue

          // Deduplica por categoria+periodo+diaTipo (múltiplos canais geram duplicatas visuais)
          // Mantém a linha com maior variação absoluta como representativa
          const dedupMap = new Map<string, typeof rawChanges[0]>()
          for (const c of rawChanges) {
            const k = `${c.categoria}|${c.periodo}|${c.diaTipo}`
            const ex = dedupMap.get(k)
            if (!ex || Math.abs(c.variacaoPct) > Math.abs(ex.variacaoPct)) dedupMap.set(k, c)
          }
          const changes = [...dedupMap.values()]

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

    // AI: executive summary — usa buildSystemPrompt() do Agente RM como system prompt
    // Assim o relatório herda TODAS as regras do agente: max_variation_pct, focus_metric,
    // guardrails, missão, regras inegociáveis — sem IA separada.

    // Monta KPIPeriod com period e company KPIs para buildSystemPrompt
    const kpiPeriodForPrompt: KPIPeriod = {
      period: { startDate: periodStart, endDate: periodEnd },
      company: kpis,
      bookings: null,
      channelKPIs: channelKPIs.length > 0 ? channelKPIs : undefined,
      periodMix: periodMix.length > 0 ? periodMix : undefined,
    }

    // Monta PriceImportForPrompt com a tabela ativa de preços e descontos.
    // Cast necessário: canal local é string genérica; sistema espera union restrita ("guia_moteis"|…)
    const priceImportsForPrompt: PriceImportForPrompt[] = activePriceImport ? [{
      rows: activePriceRows as unknown as PriceImportForPrompt['rows'],
      discount_data: (discountRows.length > 0 ? discountRows : null) as PriceImportForPrompt['discount_data'],
      valid_from: activePriceImport.valid_from,
      valid_until: null,
    }] : []

    // Capacidade e estrutura da unidade
    const unitStructureBlock = buildUnitStructureBlock(suiteAvail, [], [])

    // System prompt do Agente RM completo (identidade + regras + KPIs + preços + estrutura)
    let agentSystemPrompt = buildSystemPrompt(
      unit.name,
      kpiPeriodForPrompt,
      priceImportsForPrompt,
      undefined,
      null,
      null,
      unitStructureBlock,
    )

    // Configuração do agente (mesma construção do chat/route.ts)
    const maxVar = agentConfig?.max_variation_pct ?? 15
    const pricingStrategy = agentConfig?.pricing_strategy ?? 'moderado'
    const focusMetric = agentConfig?.focus_metric ?? 'revpar'
    const FOCUS_LABELS: Record<string, string> = {
      revpar: 'RevPAR', ocupacao: 'Ocupação', ticket: 'Ticket Médio',
      trevpar: 'TRevPAR', giro: 'Giro', balanceado: 'Balanceado',
    }
    agentSystemPrompt += `\n\n## Configuração do agente RM (${unit.name})
- **Estratégia de precificação:** ${pricingStrategy}
- **Variação máxima permitida:** ±${maxVar}%
- **Foco principal:** ${FOCUS_LABELS[focusMetric] ?? focusMetric}`

    // Contexto adicional que o chat também injeta: concorrentes, sazonalidade, padrão de demanda, etc.
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
    )
    const [lessonsBlock, rejectionBlock] = await Promise.all([
      buildLessonsBlockForUnit(unit.id, {}).catch(() => ''),
      buildRejectionLessonsBlock(unit.id).catch(() => ''),
    ])
    const demandPatternCtx = demandPattern
      ? '\n' + buildDemandPatternBlock(demandPattern, unit.name, 60)
      : ''
    const historicalCtx = historicalInsights.length > 0 ? `
## Histórico de mudanças de tabela (aprendizado)
${historicalInsights.map(h => `- ${h.fromDate}→${h.toDate}: ${h.changesCount} preços (${h.avgChangePct > 0 ? '+' : ''}${h.avgChangePct.toFixed(1)}%) → Δ RevPAR ${h.deltaRevpar !== null ? `${h.deltaRevpar > 0 ? '+' : ''}${h.deltaRevpar.toFixed(1)}%` : '?'}, Δ Giro ${h.deltaGiro !== null ? `${h.deltaGiro > 0 ? '+' : ''}${h.deltaGiro.toFixed(1)}%` : '?'} (${h.verdict})`).join('\n')}` : ''

    if (competitorBlock) agentSystemPrompt += `\n\n${competitorBlock}`
    if (seasonalityBlock) agentSystemPrompt += `\n\n${seasonalityBlock}`
    if (elasticityBlock) agentSystemPrompt += `\n\n${elasticityBlock}`
    if (forecastBlock) agentSystemPrompt += `\n\n${forecastBlock}`
    if (strategicMemoryBlock) agentSystemPrompt += `\n\n${strategicMemoryBlock}`
    if (lessonsBlock) agentSystemPrompt += `\n\n${lessonsBlock}`
    if (rejectionBlock) agentSystemPrompt += `\n\n${rejectionBlock}`
    if (demandPatternCtx) agentSystemPrompt += demandPatternCtx
    if (historicalCtx) agentSystemPrompt += historicalCtx

    // Períodos de referência para a mensagem do usuário — formato DD/MM/AAAA
    const lyStartStr = lyStart.toISOString().slice(0, 10)
    const lyEndStr   = lyEnd.toISOString().slice(0, 10)
    const fmtPeriodStart  = isoToDDMMYYYY(periodStart)
    const fmtPeriodEnd    = isoToDDMMYYYY(periodEnd)
    const fmtPrevStart    = isoToDDMMYYYY(prevStartStr)
    const fmtPrevEnd      = isoToDDMMYYYY(prevEndStr)
    const fmtLyStart      = isoToDDMMYYYY(lyStartStr)
    const fmtLyEnd        = isoToDDMMYYYY(lyEndStr)

    // Mensagem do usuário: pede o JSON do relatório semanal com contexto de períodos
    const weeklyReportUserMsg = `Elabore o resumo executivo do relatório semanal de ${unit.name} para o período ${fmtPeriodStart} a ${fmtPeriodEnd}.

PERÍODOS DE REFERÊNCIA (cite SEMPRE ao mencionar variações — use APENAS o formato DD/MM/AAAA, NUNCA ISO):
- Período atual: ${fmtPeriodStart} a ${fmtPeriodEnd} (${durationDays} dias)
- Semana anterior (mesma duração): ${fmtPrevStart} a ${fmtPrevEnd}
- Mesmo período do ano anterior: ${fmtLyStart} a ${fmtLyEnd}

REGRAS INVIOLÁVEIS para o JSON:
1. "headline": inclua o período atual em DD/MM e um dado numérico chave.
2. "keyPoints": termine cada bullet com o período de referência. Use "vs semana anterior (${fmtPrevStart}–${fmtPrevEnd})" ou "vs ano anterior (${fmtLyStart}–${fmtLyEnd})". NUNCA use siglas como "LY" ou "yoy".
3. "priorityAction": use dados REAIS. NUNCA sugira variação > ${maxVar}% — se o mercado exigir mais, diga "ajustar em ${maxVar}% agora e reavaliar". Pode propor novo tier de dia se o padrão horário justificar.
4. "agentPrompt": instrução compacta (máx 280 chars) respeitando variação máx ${maxVar}%.
5. "actionType": "price_proposal" | "discount_proposal" | "agent_config" | "none".

Retorne APENAS o JSON (sem markdown fence, sem texto extra):
{
  "headline": "string",
  "keyPoints": ["string", "string", "string"],
  "mainWin": "string com período de referência",
  "mainConcern": "string com período de referência",
  "priorityAction": "string dentro de ${maxVar}%",
  "tone": "positive|neutral|warning",
  "actionType": "price_proposal|discount_proposal|agent_config|none",
  "agentPrompt": "string máx 280 chars",
  "agentConfigSuggestion": null,
  "aiLeverageComment": "2-3 alavancas concretas com números para atingir a meta"
}`

    let executiveSummary: WeeklyReportData['executiveSummary'] = {
      headline: `Semana de ${periodStart} a ${periodEnd}`,
      keyPoints: ['Dados coletados com sucesso'],
      mainWin: '',
      mainConcern: '',
      priorityAction: '',
      tone: 'neutral',
      actionType: 'none',
    }
    let aiLeverageComment = ''

    try {
      const { text } = await generateText({
        model: ANALYSIS_MODEL,
        system: agentSystemPrompt,
        messages: [{ role: 'user', content: weeklyReportUserMsg }],
        maxOutputTokens: 900,
      })
      const cleaned = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)
      const agentPromptRaw: string | null = parsed.agentPrompt ?? null
      executiveSummary = {
        headline: parsed.headline ?? executiveSummary.headline,
        keyPoints: parsed.keyPoints ?? executiveSummary.keyPoints,
        mainWin: parsed.mainWin ?? '',
        mainConcern: parsed.mainConcern ?? '',
        priorityAction: parsed.priorityAction ?? '',
        tone: parsed.tone ?? 'neutral',
        actionType: parsed.actionType ?? 'none',
        agentPromptLink: agentPromptRaw
          ? `/dashboard/agente?unit=${unitSlug}&q=${encodeURIComponent(`[Relatório semanal ${fmtPeriodStart}–${fmtPeriodEnd}] ${agentPromptRaw}`)}`
          : undefined,
        agentConfigSuggestion: parsed.agentConfigSuggestion ?? undefined,
      }
      aiLeverageComment = parsed.aiLeverageComment ?? ''
    } catch (e) {
      console.error('[generateWeeklyReport] AI summary error:', e)
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
        sameWeekLastYear: lySnapshot,
      },
      pricing,
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
}
