import { createClient as createAdminClient } from '@supabase/supabase-js'
import { refreshEventsForUnit } from '@/lib/agente/events'
import { recordWeatherObservation } from '@/lib/agente/weather-insight'
import { recomputeSeasonality } from '@/lib/seasonality/compute'
import { runAnomalyDetection } from '@/lib/anomaly/detector'
import { computeAndPersistElasticity } from '@/lib/pricing/elasticity'
import { syncBudgetForUnit } from '@/lib/budget/google-sheets'
import { generateWeeklyReport } from '@/lib/reports/generate-weekly-report'
import { updateGuiaCompetitorsForUnit } from '@/lib/competitors/cron-update'
import { bootstrapPricingLessons } from '@/lib/agente/bootstrap-learning'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import {
  decomposeLift,
  judgeVerdict,
  type LiftDecomposition,
} from '@/lib/agente/lift-decomposition'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import type { ProposalKpiBaseline } from '@/lib/agente/proposal-baseline'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { ProposedPriceRow } from '@/app/api/agente/proposals/route'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface ReviewRunResult {
  reviewId: string
  status: 'done' | 'failed'
  convId?: string
  error?: string
  liftPricingPct?: number
  lessonsInserted?: number
}

export interface RunReviewsResult {
  executed: number
  done: number
  failed: number
  results: ReviewRunResult[]
  eventsRefreshed: string[]
}

// ─── Helper: monta janela de KPIs equivalente ao baseline ───────────────────

function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface CheckpointWindow {
  startDateApi: string  // DD/MM/YYYY
  endDateApi:   string
}

/**
 * Para um checkpoint de N dias após approved_at, calcula a janela
 * pós-aprovação com a MESMA duração da janela do baseline (window_days).
 * Se window_days >= N (ex: baseline 28d, checkpoint 7d), usamos N
 * dias da janela disponível pós-aprovação (do contrário, falsificaríamos
 * dados que ainda não aconteceram).
 */
function buildCheckpointWindow(
  approvedAt: Date,
  baselineWindowDays: number,
  checkpointDays: number,
): CheckpointWindow {
  const endDate = new Date(approvedAt)
  endDate.setDate(endDate.getDate() + checkpointDays)
  // Não passa de hoje
  const today = new Date()
  if (endDate.getTime() > today.getTime()) endDate.setTime(today.getTime())
  endDate.setDate(endDate.getDate() - 1) // janela [start, ontem] inclusiva

  // Janela usa min(baselineWindowDays, checkpointDays) dias para comparação justa
  const windowSize = Math.min(baselineWindowDays, checkpointDays)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - (windowSize - 1))

  return {
    startDateApi: ddmmyyyy(startDate),
    endDateApi:   ddmmyyyy(endDate),
  }
}

/**
 * Insere 1 row em rm_pricing_lessons por linha que mudou na proposta,
 * propagando os deltas globais como aproximação (refinamento por
 * categoria/canal pode ser feito em futuro próximo se necessário).
 */
async function insertLessons(
  admin: ReturnType<typeof getAdminClient>,
  unitId: string,
  proposalId: string,
  proposalRows: ProposedPriceRow[],
  decomposition: LiftDecomposition,
  baseline: ProposalKpiBaseline,
  checkpointDays: number,
): Promise<number> {
  const changedRows = proposalRows.filter((r) => Math.abs(r.variacao_pct) >= 1)
  if (!changedRows.length) return 0

  const conditions = {
    weather_condition: baseline.context.weather_dominant_condition,
    weather_avg_temp:  baseline.context.weather_avg_temp,
    events:            baseline.context.events_active,
    new_events:        decomposition.new_events,
    removed_events:    decomposition.removed_events,
  }

  const inserts = changedRows.map((row) => {
    // Elasticidade implícita por linha: aproximação usando delta de giro global
    // (refinamento por categoria virá quando ST1 calcular elasticidades por scope)
    const impliedElasticity = Math.abs(row.variacao_pct) >= 1
      ? +(decomposition.raw_delta_giro_pct / row.variacao_pct).toFixed(3)
      : null

    return {
      unit_id:                unitId,
      proposal_id:            proposalId,
      checkpoint_days:        checkpointDays,
      categoria:              row.categoria,
      periodo:                row.periodo,
      dia_tipo:               row.dia_tipo,
      canal:                  row.canal ?? null,
      preco_anterior:         row.preco_atual,
      preco_novo:             row.preco_proposto,
      variacao_pct:           row.variacao_pct,
      delta_revpar_pct:       decomposition.raw_delta_revpar_pct,
      delta_giro_pct:         decomposition.raw_delta_giro_pct,
      delta_ocupacao_pp:      decomposition.raw_delta_ocupacao_pp,
      delta_ticket_pct:       decomposition.raw_delta_ticket_pct,
      attributed_pricing_pct: decomposition.attributed.pricing,
      implied_elasticity:     impliedElasticity,
      conditions,
      verdict:                judgeVerdict(decomposition.attributed.pricing, row.variacao_pct),
    }
  })

  const { error } = await admin.from('rm_pricing_lessons').insert(inserts)
  if (error) {
    console.error('[run-reviews] erro ao inserir lessons:', error.message)
    return 0
  }
  return inserts.length
}

// ─── Loop principal ─────────────────────────────────────────────────────────

// Limite de revisões processadas POR EXECUÇÃO do cron. O processamento é sequencial
// (relatório completo + IA por revisão) e o cron tem 300s (máximo do plano Hobby) —
// sem esse limite, um dia com muitos checkpoints vencidos numa mesma unidade estoura
// o tempo e mata o processo no meio de uma revisão, deixando-a travada em 'running'
// para sempre (a query abaixo só busca status='pending', então uma vez travada em
// 'running' ela nunca mais era retentada). O resto do backlog é pego no dia seguinte.
const MAX_REVIEWS_PER_RUN = 5

export async function runPendingReviews(): Promise<RunReviewsResult> {
  const admin = getAdminClient()

  // Recupera revisões travadas em 'running' — só ficam assim se a execução anterior
  // foi interrompida (timeout/crash) antes de marcar 'done'/'failed'. Uma nova chamada
  // desta função só começa depois que a anterior já terminou (com sucesso ou não), então
  // qualquer linha ainda em 'running' agora é órfã e precisa voltar para a fila.
  const { data: stuck } = await admin
    .from('scheduled_reviews')
    .update({ status: 'pending' })
    .eq('status', 'running')
    .select('id')
  if (stuck?.length) {
    console.warn(`[run-reviews] Recuperadas ${stuck.length} revisão(ões) travada(s) em 'running' (execução anterior não concluiu): ${stuck.map(s => s.id).join(', ')}`)
  }

  const endOfToday = new Date()
  endOfToday.setUTCHours(23, 59, 59, 999)

  const { data: reviews, error: fetchError } = await admin
    .from('scheduled_reviews')
    .select('id, unit_id, created_by, note, scheduled_at, proposal_id, checkpoint_days')
    .lte('scheduled_at', endOfToday.toISOString())
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(MAX_REVIEWS_PER_RUN)

  if (fetchError) throw new Error(`Erro ao buscar revisões: ${fetchError.message}`)

  // IDs de unidades que têm revisão agendada hoje — serão excluídas do relatório de segunda
  const reviewedUnitIds = new Set<string>((reviews ?? []).map((r) => r.unit_id))

  const results: ReviewRunResult[] = []

  for (const review of reviews ?? []) {
    try {
      await admin.from('scheduled_reviews').update({ status: 'running' }).eq('id', review.id)

      const { data: unit } = await admin
        .from('units').select('id, name, slug').eq('id', review.unit_id).single()
      if (!unit) throw new Error(`Unidade ${review.unit_id} não encontrada`)

      // ─── Carregar proposta e baseline (HV1) ──────────────────────────
      let baseline:    ProposalKpiBaseline | null = null
      let proposalRows: ProposedPriceRow[] = []
      let proposalContext = ''
      let approvedAtDate: Date | null = null
      const checkpointDays = (review.checkpoint_days as 7 | 14 | 28) ?? 7

      if (review.proposal_id) {
        const { data: proposal } = await admin
          .from('price_proposals')
          .select('context, created_at, approved_at, kpi_baseline, rows')
          .eq('id', review.proposal_id)
          .single()

        if (proposal) {
          baseline       = (proposal.kpi_baseline as unknown as ProposalKpiBaseline) ?? null
          proposalRows   = (proposal.rows as unknown as ProposedPriceRow[]) ?? []
          approvedAtDate = proposal.approved_at ? new Date(proposal.approved_at) : null
          if (proposal.context) {
            const approvedDate = new Date(proposal.created_at).toLocaleDateString('pt-BR')
            proposalContext = `\n\nContexto da proposta aprovada em ${approvedDate}: ${proposal.context}`
          }
        }
      }

      const { data: importsData } = await admin
        .from('price_imports')
        .select('id, parsed_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .order('valid_from', { ascending: false })
        .limit(2)

      const priceImports = (importsData ?? []).map((imp) => ({
        rows: (imp.parsed_data as unknown as ParsedPriceRow[]) ?? [],
        valid_from: imp.valid_from,
        valid_until: imp.valid_until,
      }))

      // ─── Decomposição de lift (apenas se tem baseline) ───────────────
      let decomposition: LiftDecomposition | null = null
      let postKpis: CompanyKPIResponse | null = null
      let lessonsInserted = 0

      if (baseline && approvedAtDate) {
        const window = buildCheckpointWindow(approvedAtDate, baseline.window_days ?? 28, checkpointDays)

        postKpis = await fetchCompanyKPIsFromAutomo(unit.slug, window.startDateApi, window.endDateApi).catch(() => null)

        if (postKpis) {
          // Eventos ativos no período pós (cruza unit_events)
          const { data: postEvts } = await admin
            .from('unit_events')
            .select('title')
            .eq('unit_id', unit.id)
            .lte('event_date', new Date().toISOString().slice(0, 10))
            .order('event_date', { ascending: false })
            .limit(20)

          const postEventsList = (postEvts ?? []).map((e) => e.title)

          decomposition = decomposeLift({ baseline, post: postKpis, postEvents: postEventsList })

          if (review.proposal_id) {
            lessonsInserted = await insertLessons(
              admin,
              unit.id,
              review.proposal_id,
              proposalRows,
              decomposition,
              baseline,
              checkpointDays,
            )
          }
        }
      }

      // ─── Gerar relatório completo com o período do checkpoint ────────
      // Converte DD/MM/YYYY → YYYY-MM-DD para o gerador de relatório.
      // Usa a mesma janela calculada pelo baseline; fallback para últimos 7d.
      const toISO = (ddmmyyyy: string) => ddmmyyyy.split('/').reverse().join('-')

      let checkpointStart: string
      let checkpointEnd: string
      if (baseline && approvedAtDate) {
        const cwWin = buildCheckpointWindow(approvedAtDate, baseline.window_days ?? 28, checkpointDays)
        checkpointStart = toISO(cwWin.startDateApi)
        checkpointEnd   = toISO(cwWin.endDateApi)
      } else {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
        checkpointEnd   = yesterday.toISOString().slice(0, 10)
        const s = new Date(yesterday); s.setDate(s.getDate() - 6)
        checkpointStart = s.toISOString().slice(0, 10)
      }

      const reportId = await generateWeeklyReport(unit.slug, checkpointStart, checkpointEnd)

      const scheduledLabel = new Date(review.scheduled_at).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })

      const liftSummary = decomposition
        ? ` · pricing ${decomposition.attributed.pricing >= 0 ? '+' : ''}${decomposition.attributed.pricing.toFixed(1)}%`
        : ''

      await admin.from('notifications').insert({
        user_id: review.created_by,
        type:    'revisao_concluida',
        title:   `📅 Revisão +${checkpointDays}d concluída — ${unit.name}${liftSummary}`,
        body:    `${lessonsInserted > 0 ? `${lessonsInserted} lições aprendidas registradas. ` : ''}Confira o relatório de acompanhamento.`,
        link:    `/dashboard/agente/relatorios?unit=${unit.slug}`,
      })

      await admin
        .from('scheduled_reviews')
        .update({ status: 'done', conv_id: reportId ?? null, executed_at: new Date().toISOString() })
        .eq('id', review.id)

      results.push({
        reviewId: review.id,
        status: 'done',
        convId: reportId ?? undefined,
        liftPricingPct: decomposition?.attributed.pricing,
        lessonsInserted,
      })

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[run-reviews] Erro na revisão ${review.id}:`, message)
      await admin
        .from('scheduled_reviews')
        .update({ status: 'failed', executed_at: new Date().toISOString() })
        .eq('id', review.id)
      results.push({ reviewId: review.id, status: 'failed', error: message })
    }
  }

  // Refreshar cache de eventos + registrar observação clima × demanda para todas as unidades
  const { data: allConfigs } = await admin
    .from('rm_agent_config')
    .select('unit_id, city, budget_sheet_url, units(slug)')
    .not('city', 'is', null)

  // Manutenção por unidade em paralelo — era sequencial e causava timeout
  // com 5+ unidades (5×10s = 50s) antes de chegar no bloco de segunda-feira
  const eventsRefreshed: string[] = []
  const now = new Date()
  const isSunday      = now.getUTCDay() === 0
  const isFirstOfMonth = now.getUTCDate() === 1

  // Geração de relatórios semanais — toda segunda-feira UTC.
  // Roda ANTES da manutenção diária: a manutenção é idempotente (recupera amanhã) e
  // pesada; se algo estourar o timeout de 60s do Hobby, a vítima deve ser a manutenção,
  // não o relatório semanal (que só tem 1 chance por semana).
  if (now.getUTCDay() === 1) {
    const lastSunday = new Date(now)
    lastSunday.setUTCDate(now.getUTCDate() - 1)
    const lastMonday = new Date(lastSunday)
    lastMonday.setUTCDate(lastSunday.getUTCDate() - 6)

    const periodStart = lastMonday.toISOString().slice(0, 10)
    const periodEnd   = lastSunday.toISOString().slice(0, 10)

    // Gera relatório apenas para unidades SEM revisão agendada hoje (revisão > relatório)
    const reportSlugs = (allConfigs ?? [])
      .filter(c => !reviewedUnitIds.has(c.unit_id))
      .map(c => (c.units as { slug: string } | null)?.slug)
      .filter(Boolean) as string[]

    console.log(`[run-reviews] Segunda-feira — gerando relatórios para: ${reportSlugs.join(', ')} (${periodStart} → ${periodEnd})`)

    const reportResults = await Promise.allSettled(
      reportSlugs.map(slug => generateWeeklyReport(slug, periodStart, periodEnd))
    )
    const reportDone   = reportResults.filter(r => r.status === 'fulfilled').length
    const reportFailed = reportResults.filter(r => r.status === 'rejected').length
    console.log(`[run-reviews] Relatórios: ${reportDone} gerados, ${reportFailed} falhou`)
  }

  await Promise.allSettled(
    (allConfigs ?? []).map(async (cfg) => {
      const city     = (cfg.city as string).split(',')[0].trim()
      const unitSlug = (cfg.units as { slug: string } | null)?.slug ?? ''

      try {
        await refreshEventsForUnit(cfg.unit_id, city)
        eventsRefreshed.push(cfg.unit_id)
      } catch { /* não bloqueia */ }

      if (!unitSlug) return

      await Promise.allSettled([
        // Observação clima × demanda (daily)
        recordWeatherObservation({
          unitId: cfg.unit_id, unitSlug, city,
          fetchKPIs: async (slug, date) =>
            fetchCompanyKPIsFromAutomo(slug, date, date).catch(() => null),
        }),

        // Budget sync (daily, quando configurado)
        cfg.budget_sheet_url ? syncBudgetForUnit(cfg.unit_id) : Promise.resolve(),

        // Concorrentes Guia GM (daily, gratuito)
        updateGuiaCompetitorsForUnit(cfg.unit_id),

        // Anomaly detection (daily)
        (async () => {
          const { data: notifyTarget } = await admin
            .from('profiles')
            .select('user_id')
            .or(`unit_id.eq.${cfg.unit_id},unit_id.is.null`)
            .in('role', ['super_admin', 'admin'])
            .limit(1)
            .maybeSingle()
          await runAnomalyDetection(cfg.unit_id, unitSlug, notifyTarget?.user_id ?? null)
        })(),

        // Bootstrap (daily, idempotente)
        bootstrapPricingLessons(cfg.unit_id, unitSlug),

        // Sazonalidade (semanal — domingo)
        isSunday ? recomputeSeasonality(cfg.unit_id, unitSlug) : Promise.resolve(),

        // Elasticidade (mensal — dia 1)
        isFirstOfMonth ? computeAndPersistElasticity(cfg.unit_id) : Promise.resolve(),
      ])
    })
  )

  return {
    executed: results.length,
    done:     results.filter((r) => r.status === 'done').length,
    failed:   results.filter((r) => r.status === 'failed').length,
    results,
    eventsRefreshed,
  }
}
