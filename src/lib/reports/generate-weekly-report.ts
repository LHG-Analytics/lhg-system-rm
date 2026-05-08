import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import type { Database, Json } from '@/types/database.types'
import type { WeeklyReportData, KPISnapshot } from './types'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs, queryPeriodMix } from '@/lib/automo/channel-kpis'
import { getSuiteAvailabilityByCategory } from '@/lib/automo/suite-availability'
import { getUpcomingSeasonalFactors } from '@/lib/seasonality/compute'
import { getElasticityForUnit } from '@/lib/pricing/elasticity'
import { computeRevenueForecast } from '@/lib/forecast/revenue-forecast'
import { ANALYSIS_MODEL } from '@/lib/agente/model'
import type { BudgetYearly } from '@/lib/budget/google-sheets'
import type { CompanyKPIResponse } from '@/lib/kpis/types'

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
    ocupacao: t.totalOccupancyRate,
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

  // Previous week
  const prevEnd = new Date(periodStart + 'T12:00:00Z')
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevEnd.getUTCDate() - 6)
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
      periodMixResult,
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
    ] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unitSlug, startDDMM, endDDMM),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(prevStartStr), isoToDDMMYYYY(prevEndStr)),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(lyStart.toISOString().slice(0, 10)), isoToDDMMYYYY(lyEnd.toISOString().slice(0, 10))),
      queryChannelKPIs(unitSlug, startDDMM, endDDMM),
      queryPeriodMix(unitSlug, startDDMM, endDDMM),
      admin.from('price_imports')
        .select('id, valid_from, parsed_data')
        .eq('unit_id', unit.id)
        .eq('import_type', 'prices')
        .lte('valid_from', periodEnd)
        .or(`valid_until.is.null,valid_until.gte.${periodStart}`)
        .order('valid_from', { ascending: false })
        .limit(1),
      admin.from('price_proposals')
        .select('id, approved_at, rows')
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
        .select('categoria_nossa, periodo, dia_tipo, preco_nosso, preco_concorrente_mediana, gap_pct, position')
        .eq('unit_id', unit.id)
        .order('gap_pct', { ascending: false })
        .limit(15),
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
        .select('pricing_strategy, focus_metric, max_variation_pct, shared_context, unit_goals, budget_yearly')
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
    const periodMix = periodMixResult.status === 'fulfilled' ? periodMixResult.value : []
    const activePriceData = activePriceResult.status === 'fulfilled' ? activePriceResult.value.data : null
    const approvedProposals = proposalsResult.status === 'fulfilled' ? proposalsResult.value.data ?? [] : []
    const lessons = lessonsResult.status === 'fulfilled' ? lessonsResult.value.data ?? [] : []
    const elasticity = elasticityResult.status === 'fulfilled' ? elasticityResult.value : []
    const activeDiscountData = activeDiscountsResult.status === 'fulfilled' ? activeDiscountsResult.value.data : null
    const discountProposals = discountProposalsResult.status === 'fulfilled' ? discountProposalsResult.value.data ?? [] : []
    const competitorGaps = competitorGapsResult.status === 'fulfilled' ? competitorGapsResult.value.data ?? [] : []
    const seasonalFactors = seasonalResult.status === 'fulfilled' ? seasonalResult.value : []
    const upcomingEvents = eventsResult.status === 'fulfilled' ? eventsResult.value.data ?? [] : []
    const anomalies = anomaliesResult.status === 'fulfilled' ? anomaliesResult.value.data ?? [] : []
    const agentConfig = agentConfigResult.status === 'fulfilled' ? agentConfigResult.value.data : null
    const suiteAvail = suiteAvailResult.status === 'fulfilled' ? suiteAvailResult.value : []
    const prevReport = prevReportResult.status === 'fulfilled' ? prevReportResult.value.data?.[0] : null
    const guardrailsCount = guardrailsResult.count ?? 0

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

    const guiaShare = channelKPIs.find(c => c.canal === 'GUIA_GO' || c.canal === 'GUIA_SCHEDULED')
    const guiaSharePct = guiaShare ? guiaShare.representatividade : 0
    const prevGuiaShare = prevReportData?.discounts?.guiaSharePct ?? 0

    const evolution: WeeklyReportData['evolution'] = {
      hasPreviousReport: !!prevReport,
      previousPeriodStart: prevReport?.period_start ?? null,
      kpiDeltas: prevCurrentSnapshot ? {
        revpar: deltaPct(currentSnapshot.revpar, prevCurrentSnapshot.revpar),
        giro: deltaPct(currentSnapshot.giro, prevCurrentSnapshot.giro),
        ocupacao: deltaPct(currentSnapshot.ocupacao, prevCurrentSnapshot.ocupacao),
        ticket: deltaPct(currentSnapshot.ticket, prevCurrentSnapshot.ticket),
        receita: deltaPct(currentSnapshot.receita, prevCurrentSnapshot.receita),
        tmo: deltaPct(currentSnapshot.tmo, prevCurrentSnapshot.tmo),
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
      peakDow: 'sexta-feira',
      peakHourRange: '20h–22h',
      valleyDow: 'quarta-feira',
    }

    // competitors — fixed: use categoria_nossa / preco_concorrente_mediana
    const dominantCount = { underprice: 0, aligned: 0, overprice: 0 }
    for (const g of competitorGaps) {
      const pos = g.position as keyof typeof dominantCount
      if (pos in dominantCount) dominantCount[pos]++
    }
    const dominant = Object.entries(dominantCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'aligned'

    const competitors: WeeklyReportData['competitors'] = {
      gaps: competitorGaps.map(g => ({
        categoria: g.categoria_nossa ?? '',
        periodo: g.periodo ?? '',
        diaTipo: g.dia_tipo ?? '',
        precoNosso: g.preco_nosso ?? 0,
        medianaConc: g.preco_concorrente_mediana ?? 0,
        gapPct: g.gap_pct ?? 0,
        position: (g.position ?? 'aligned') as 'underprice' | 'aligned' | 'overprice',
      })),
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

    const weekHighlightParts: string[] = []
    if (lessonsSuccess > 0) weekHighlightParts.push(`${lessonsSuccess} lição(ões) com acerto`)
    if (lessonsFailure > 0) weekHighlightParts.push(`${lessonsFailure} falha(s) identificada(s)`)
    const highConfEl = elasticity.filter(e => e.confidence === 'high').length
    if (highConfEl > 0) weekHighlightParts.push(`${highConfEl} elasticidade(s) com alta confiança`)

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
      weekHighlight: weekHighlightParts.join('; ') || 'Sem destaques significativos esta semana',
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

    // AI: executive summary + budget leverage comment
    const promptContext = `
Você é um Revenue Manager sênior. Analise a semana operacional de ${unit.name} (${periodStart} a ${periodEnd}).

DADOS DA SEMANA:
- RevPAR: R$ ${currentSnapshot.revpar.toFixed(2)} ${prevCurrentSnapshot ? `(${deltaPct(currentSnapshot.revpar, prevCurrentSnapshot.revpar) >= 0 ? '+' : ''}${deltaPct(currentSnapshot.revpar, prevCurrentSnapshot.revpar).toFixed(1)}% vs sem. ant.)` : ''}
- Giro: ${currentSnapshot.giro.toFixed(2)} ${prevCurrentSnapshot ? `(${deltaPct(currentSnapshot.giro, prevCurrentSnapshot.giro) >= 0 ? '+' : ''}${deltaPct(currentSnapshot.giro, prevCurrentSnapshot.giro).toFixed(1)}%)` : ''}
- Ocupação: ${(currentSnapshot.ocupacao * 100).toFixed(1)}%
- Receita: R$ ${currentSnapshot.receita.toFixed(2)}
- Ticket Médio: R$ ${currentSnapshot.ticket.toFixed(2)}
- Locações: ${currentSnapshot.locacoes}
- Lições: ${lessonsSuccess} acertos, ${lessonsFailure} falhas
- Anomalias novas: ${newAnomalies}
- Posição competitiva dominante: ${competitors.dominantPosition}
- Meta mensal: R$ ${meta.toFixed(2)} | Projeção: R$ ${projecao.toFixed(2)} | Gap: ${meta > 0 ? ((projecao - meta) / meta * 100).toFixed(1) : 0}%
- Pace diário necessário: R$ ${paceDiarioNecessario.toFixed(2)} | Pace atual: R$ ${paceDiarioAtual.toFixed(2)}

Retorne um JSON com exatamente essa estrutura:
{
  "headline": "Uma frase que captura o tom geral da semana",
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "mainWin": "Principal vitória ou destaque positivo",
  "mainConcern": "Principal preocupação ou ponto de atenção",
  "priorityAction": "Ação prioritária para a próxima semana",
  "tone": "positive",
  "aiLeverageComment": "Para atingir a meta mensal de R$ X, as principais alavancas são: análise concreta de 2-3 linhas"
}

Responda APENAS o JSON, sem markdown.
`.trim()

    let executiveSummary: WeeklyReportData['executiveSummary'] = {
      headline: `Semana de ${periodStart} a ${periodEnd}`,
      keyPoints: ['Dados coletados com sucesso'],
      mainWin: '',
      mainConcern: '',
      priorityAction: '',
      tone: 'neutral',
    }
    let aiLeverageComment = ''

    try {
      const { text } = await generateText({
        model: ANALYSIS_MODEL,
        prompt: promptContext,
        maxOutputTokens: 600,
      })
      const cleaned = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)
      executiveSummary = {
        headline: parsed.headline ?? executiveSummary.headline,
        keyPoints: parsed.keyPoints ?? executiveSummary.keyPoints,
        mainWin: parsed.mainWin ?? '',
        mainConcern: parsed.mainConcern ?? '',
        priorityAction: parsed.priorityAction ?? '',
        tone: parsed.tone ?? 'neutral',
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
