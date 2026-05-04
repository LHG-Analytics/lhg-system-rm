import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { ProposalKpiBaseline } from '@/lib/agente/proposal-baseline'

/**
 * Decomposição de lift de RevPAR após aprovação de proposta.
 *
 * Modelo simples (sem ML, validado para volume baixo de dados):
 *   raw_delta = ((post − baseline) / baseline) * 100
 *   = pricing + weather + events + seasonality + unexplained
 *
 * Cada componente é estimado heuristicamente:
 *   - events: +X% por evento positivo novo no período pós, -X% por negativo
 *   - weather: contribuição derivada de rm_weather_demand_patterns (HV5 popula)
 *   - seasonality: fator histórico (HV5 popula); por enquanto 0
 *   - pricing: residual = raw - (events + weather + seasonality)
 *   - unexplained: 0 (modelo atual atribui o residual ao pricing)
 *
 * Conforme HV5 e os patterns acumulam dados, a decomposição fica mais
 * precisa. No início, "pricing" recebe o residual sem refinamento.
 */

export interface LiftDecomposition {
  raw_delta_revpar_pct: number
  raw_delta_giro_pct: number
  raw_delta_ocupacao_pp: number
  raw_delta_ticket_pct: number
  raw_delta_trevpar_pct: number

  attributed: {
    pricing:     number
    weather:     number
    events:      number
    seasonality: number
    unexplained: number
  }

  // Pacote completo de eventos novos detectados na janela pós (para o prompt)
  new_events: string[]
  removed_events: string[]
}

interface DecompositionInput {
  baseline: ProposalKpiBaseline
  post: CompanyKPIResponse
  /** Eventos ativos na janela pós-aprovação (titles) */
  postEvents: string[]
}

function pctDelta(current: number, before: number): number {
  if (!before) return 0
  return +(((current - before) / before) * 100).toFixed(2)
}

function ppDelta(current: number, before: number): number {
  return +(current - before).toFixed(2)
}

export function decomposeLift(input: DecompositionInput): LiftDecomposition {
  const baselineKpis = input.baseline.kpis.total
  const postTotal = input.post.TotalResult

  const raw_delta_revpar_pct  = pctDelta(postTotal.totalRevpar,           baselineKpis.revpar)
  const raw_delta_giro_pct    = pctDelta(postTotal.totalGiro,             baselineKpis.giro)
  const raw_delta_ocupacao_pp = ppDelta(postTotal.totalOccupancyRate,    baselineKpis.ocupacao)
  const raw_delta_ticket_pct  = pctDelta(postTotal.totalAllTicketAverage, baselineKpis.ticket)
  const raw_delta_trevpar_pct = pctDelta(postTotal.totalTrevpar,          baselineKpis.trevpar)

  // ─── Eventos: diff entre janela do baseline e janela pós ──────────────────
  const baselineEvents = new Set(input.baseline.context.events_active ?? [])
  const postEvents     = new Set(input.postEvents)
  const new_events     = [...postEvents].filter((e) => !baselineEvents.has(e))
  const removed_events = [...baselineEvents].filter((e) => !postEvents.has(e))

  // Heurística: cada evento novo positivo conhecido contribui +5%, negativo -5%.
  // Como ainda não classificamos os eventos por type aqui, usamos aproximação
  // neutra (3% por evento novo, sinal pelo número de novos vs removidos).
  // HV5 vai trazer rm_weather_demand_patterns + classificação de eventos para
  // refinar essa atribuição.
  const eventsContribution = (new_events.length - removed_events.length) * 3.0

  // ─── Weather: sem patterns populadas ainda, marcar 0 ──────────────────────
  const weatherContribution = 0

  // ─── Seasonality: HV5 vai popular; por enquanto 0 ─────────────────────────
  const seasonalityContribution = 0

  // ─── Pricing = residual ──────────────────────────────────────────────────
  const pricingContribution = +(
    raw_delta_revpar_pct - eventsContribution - weatherContribution - seasonalityContribution
  ).toFixed(2)

  return {
    raw_delta_revpar_pct,
    raw_delta_giro_pct,
    raw_delta_ocupacao_pp,
    raw_delta_ticket_pct,
    raw_delta_trevpar_pct,
    attributed: {
      pricing:     pricingContribution,
      weather:     weatherContribution,
      events:      +eventsContribution.toFixed(2),
      seasonality: seasonalityContribution,
      unexplained: 0,
    },
    new_events,
    removed_events,
  }
}

/**
 * Veredito agregado para o lift observado, considerando direção da
 * variação aplicada na proposta:
 *   - success: pricing > +2% E variação aplicada teve direção esperada
 *   - failure: pricing < -2% OU contrário à direção esperada
 *   - neutral: caso contrário
 */
export function judgeVerdict(
  liftPricingPct: number,
  appliedVariationPct: number,
): 'success' | 'neutral' | 'failure' {
  // Se proposta aumentou preços (positiva) e RevPAR atribuído ao pricing subiu → success
  if (Math.abs(appliedVariationPct) < 1) return 'neutral'

  if (appliedVariationPct > 0) {
    if (liftPricingPct > 2)  return 'success'
    if (liftPricingPct < -2) return 'failure'
    return 'neutral'
  }

  // Variação negativa (redução) — esperamos que giro suba o suficiente para compensar
  // Se RevPAR atribuído ao pricing positivo (giro subiu mais que preço caiu) → success
  if (liftPricingPct > 2)  return 'success'
  if (liftPricingPct < -2) return 'failure'
  return 'neutral'
}

/**
 * Bloco markdown de decomposição de lift para injetar no prompt da revisão.
 */
export function buildLiftDecompositionBlock(d: LiftDecomposition, checkpointDays: number): string {
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
  const fmtPP  = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} p.p.`

  const eventsLine = (d.new_events.length || d.removed_events.length)
    ? `Eventos: ${d.new_events.length ? `novos no período pós: ${d.new_events.join(', ')}` : 'nenhum novo'}` +
      `${d.removed_events.length ? `; ausentes vs baseline: ${d.removed_events.join(', ')}` : ''}`
    : 'Eventos: sem mudança vs baseline'

  return `## Decomposição de lift (${checkpointDays} dias após aprovação)

### Δ bruto observado
| KPI | Δ |
|-----|---|
| RevPAR | **${fmtPct(d.raw_delta_revpar_pct)}** |
| TRevPAR | ${fmtPct(d.raw_delta_trevpar_pct)} |
| Giro | ${fmtPct(d.raw_delta_giro_pct)} |
| Ocupação | ${fmtPP(d.raw_delta_ocupacao_pp)} |
| Ticket Médio | ${fmtPct(d.raw_delta_ticket_pct)} |

### Atribuição de RevPAR (${fmtPct(d.raw_delta_revpar_pct)} total)
| Fator | Contribuição estimada |
|-------|----------------------|
| 💰 Pricing (residual) | **${fmtPct(d.attributed.pricing)}** |
| 🌤️ Clima | ${fmtPct(d.attributed.weather)} |
| 📅 Eventos | ${fmtPct(d.attributed.events)} |
| 📈 Sazonalidade | ${fmtPct(d.attributed.seasonality)} |
| ❓ Não explicado | ${fmtPct(d.attributed.unexplained)} |

> ${eventsLine}
>
> **Modelo simples**: pricing = residual após subtrair efeitos conhecidos (eventos, clima, sazonalidade). Decomposição ficará mais precisa quando rm_weather_demand_patterns (HV5) acumular dados.`
}
