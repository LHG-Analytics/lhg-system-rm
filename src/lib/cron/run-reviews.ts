import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { refreshEventsForUnit } from '@/lib/agente/events'
import { recordWeatherObservation } from '@/lib/agente/weather-insight'
import { trailingYear } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildSystemPrompt } from '@/lib/agente/system-prompt'
import {
  decomposeLift,
  judgeVerdict,
  buildLiftDecompositionBlock,
  type LiftDecomposition,
} from '@/lib/agente/lift-decomposition'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import type { KPIPeriod } from '@/lib/agente/system-prompt'
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

export async function runPendingReviews(): Promise<RunReviewsResult> {
  const admin = getAdminClient()

  const endOfToday = new Date()
  endOfToday.setUTCHours(23, 59, 59, 999)

  const { data: reviews, error: fetchError } = await admin
    .from('scheduled_reviews')
    .select('id, unit_id, created_by, note, scheduled_at, proposal_id, checkpoint_days')
    .lte('scheduled_at', endOfToday.toISOString())
    .eq('status', 'pending')

  if (fetchError) throw new Error(`Erro ao buscar revisões: ${fetchError.message}`)
  if (!reviews || reviews.length === 0) {
    return { executed: 0, done: 0, failed: 0, results: [], eventsRefreshed: [] }
  }

  const results: ReviewRunResult[] = []

  for (const review of reviews) {
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

      // ─── KPIs para o prompt da revisão ───────────────────────────────
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start7d = new Date(end)
      start7d.setDate(start7d.getDate() - 6)

      const fmt = (d: Date) => d.toLocaleDateString('pt-BR')
      const kpiPeriod7d       = { startDate: fmt(start7d), endDate: fmt(end) }
      const kpiPeriodTrailing = trailingYear()

      const [c7d, cTrail] = await Promise.allSettled([
        postKpis ? Promise.resolve(postKpis) : fetchCompanyKPIsFromAutomo(unit.slug, kpiPeriod7d.startDate, kpiPeriod7d.endDate),
        fetchCompanyKPIsFromAutomo(unit.slug, kpiPeriodTrailing.startDate, kpiPeriodTrailing.endDate),
      ])

      const kpiPeriods: KPIPeriod[] = [
        {
          label: `Janela pós-aprovação (${checkpointDays}d) — ${kpiPeriod7d.startDate} a ${kpiPeriod7d.endDate}`,
          period: kpiPeriod7d,
          company: c7d.status === 'fulfilled' ? c7d.value : null,
          bookings: null,
        },
        {
          label: `Trailing 12 meses — contexto histórico (${kpiPeriodTrailing.startDate} a ${kpiPeriodTrailing.endDate})`,
          period: kpiPeriodTrailing,
          company: cTrail.status === 'fulfilled' ? cTrail.value : null,
          bookings: null,
        },
      ]

      const decompositionBlock = decomposition
        ? buildLiftDecompositionBlock(decomposition, checkpointDays)
        : ''

      const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports) +
        (decompositionBlock ? `\n\n${decompositionBlock}` : '')

      const scheduledLabel = new Date(review.scheduled_at).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })

      const noteContext = review.note ? `\n\nFoco desta revisão: ${review.note}` : ''
      const decompositionPreamble = decomposition
        ? `\n\nA decomposição de lift acima já está pronta no contexto — referencie os números da atribuição (Pricing, Eventos, Clima, Sazonalidade) na sua análise. NÃO recalcule deltas.`
        : ''

      const userMessage = `Revisão automática de Revenue Management agendada para ${scheduledLabel} (checkpoint +${checkpointDays}d).${proposalContext}${noteContext}${decompositionPreamble}

Por favor, realize uma análise completa de acompanhamento:
1. ${decomposition ? 'Comente a decomposição de lift: o RevPAR mudou X%, atribuído majoritariamente a Y. O pricing contribuiu Z%' : 'Diagnóstico dos últimos 7 dias vs histórico de 12 meses'}
2. Identifique tendências e anomalias desde a aprovação da proposta
3. Avalie se os preços atuais continuam calibrados para a demanda observada
4. Se necessário, sugira ajustes em prosa (não use tabela markdown — sugestões, não proposta)
5. Indique próximos passos e métricas a monitorar até o próximo checkpoint

IMPORTANTE: esta é uma revisão automática — apresente apenas a análise em texto corrido. Não chame nenhuma ferramenta.`

      const agentResult = await generateText({
        model: PRIMARY_MODEL,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: {
          placeholder: tool({
            description: 'Placeholder — não usar nesta revisão automática.',
            inputSchema: z.object({ _: z.string().optional() }),
            execute: async () => ({ ok: true }),
          }),
        },
        maxOutputTokens: 2500,
        temperature: 0.3,
        providerOptions: gatewayOptions,
      })

      const analysisText = agentResult.text ?? '(análise sem conteúdo)'
      const convTitle = `📅 Revisão +${checkpointDays}d — ${scheduledLabel} · ${unit.name}`

      const messages = [
        { id: `cron-user-${review.id}`,      role: 'user',      content: userMessage,  parts: [{ type: 'text', text: userMessage  }] },
        { id: `cron-assistant-${review.id}`, role: 'assistant', content: analysisText, parts: [{ type: 'text', text: analysisText }] },
      ]

      const { data: conv, error: convError } = await admin
        .from('rm_conversations')
        .insert({
          unit_id:  unit.id,
          user_id:  review.created_by,
          title:    convTitle,
          messages: JSON.parse(JSON.stringify(messages)),
        })
        .select('id')
        .single()

      if (convError) throw new Error(`Erro ao salvar conversa: ${convError.message}`)

      const liftSummary = decomposition
        ? ` · pricing ${decomposition.attributed.pricing >= 0 ? '+' : ''}${decomposition.attributed.pricing.toFixed(1)}%`
        : ''

      await admin.from('notifications').insert({
        user_id: review.created_by,
        type:    'revisao_concluida',
        title:   `📅 Revisão +${checkpointDays}d concluída — ${unit.name}${liftSummary}`,
        body:    `${lessonsInserted > 0 ? `${lessonsInserted} lições aprendidas registradas. ` : ''}Confira a análise no histórico do Agente RM.`,
        link:    `/dashboard/agente?unit=${unit.slug}&conv=${conv.id}`,
      })

      await admin
        .from('scheduled_reviews')
        .update({ status: 'done', conv_id: conv.id, executed_at: new Date().toISOString() })
        .eq('id', review.id)

      results.push({
        reviewId: review.id,
        status: 'done',
        convId: conv.id,
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
    .select('unit_id, city, units(slug)')
    .not('city', 'is', null)

  const eventsRefreshed: string[] = []
  for (const cfg of allConfigs ?? []) {
    const city     = (cfg.city as string).split(',')[0].trim()
    const unitSlug = (cfg.units as { slug: string } | null)?.slug ?? ''

    try {
      await refreshEventsForUnit(cfg.unit_id, city)
      eventsRefreshed.push(cfg.unit_id)
    } catch {
      // Não bloqueia o cron
    }

    if (unitSlug) {
      try {
        await recordWeatherObservation({
          unitId:   cfg.unit_id,
          unitSlug,
          city,
          fetchKPIs: async (slug, date) => {
            const { fetchCompanyKPIsFromAutomo } = await import('@/lib/automo/company-kpis')
            return fetchCompanyKPIsFromAutomo(slug, date, date).catch(() => null)
          },
        })
      } catch {
        // Não bloqueia o cron
      }
    }
  }

  return {
    executed: results.length,
    done:     results.filter((r) => r.status === 'done').length,
    failed:   results.filter((r) => r.status === 'failed').length,
    results,
    eventsRefreshed,
  }
}
