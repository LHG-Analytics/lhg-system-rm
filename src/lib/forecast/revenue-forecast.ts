import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { BudgetMonthData } from '@/lib/budget/google-sheets'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ForecastMonth {
  month:             number        // 1-12
  year:              number
  label:             string        // "Mai/26"
  is_current:        boolean
  projected:         number | null  // null = sem dados Automo
  budget:            number | null
  gap_pct:           number | null  // (projected - budget) / budget × 100
  revpar_projected:  number | null  // só mês atual via Automo
}

export interface ForecastResult {
  months:          ForecastMonth[]  // sempre 3 (atual + próximos 2)
  total_projected: number | null
  total_budget:    number | null
  total_gap_pct:   number | null
  pace_ratio:      number | null    // projeção corrente / orçado corrente
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type BudgetYearly = Record<string, Record<string, BudgetMonthData>>

const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function getBudget(yearly: BudgetYearly | null, year: number, month: number): number | null {
  return yearly?.[String(year)]?.[String(month)]?.receita ?? null
}

// ─── Cálculo principal ────────────────────────────────────────────────────────

export function computeRevenueForecast(
  company:      CompanyKPIResponse | null,
  budgetYearly: BudgetYearly | null,
): ForecastResult {
  const now      = new Date()
  const curMonth = now.getMonth() + 1
  const curYear  = now.getFullYear()

  const forecast = company?.BigNumbers?.[0]?.monthlyForecast
  const projectedEOM  = forecast?.totalAllValueForecast  ?? null
  const revparEOM     = forecast?.totalAllRevparForecast ?? null

  const budgetCurrent = getBudget(budgetYearly, curYear, curMonth)

  // pace_ratio: 1.0 = exatamente no orçado, 1.1 = 10% acima
  const pace_ratio =
    projectedEOM != null && budgetCurrent != null && budgetCurrent > 0
      ? projectedEOM / budgetCurrent
      : null

  const months: ForecastMonth[] = []

  // Mês atual
  months.push({
    month:            curMonth,
    year:             curYear,
    label:            `${MONTHS_PT[curMonth - 1]}/${String(curYear).slice(2)}`,
    is_current:       true,
    projected:        projectedEOM,
    budget:           budgetCurrent,
    gap_pct:
      projectedEOM != null && budgetCurrent != null && budgetCurrent > 0
        ? ((projectedEOM - budgetCurrent) / budgetCurrent) * 100
        : null,
    revpar_projected: revparEOM,
  })

  // Próximos 2 meses — projeção = budget × pace amortecido
  for (let offset = 1; offset <= 2; offset++) {
    let m = curMonth + offset
    let y = curYear
    if (m > 12) { m -= 12; y++ }

    const bgt = getBudget(budgetYearly, y, m)

    // Amortecimento: 50% no próximo, 25% no subsequente — evita extrapolar anomalias
    const damping = offset === 1 ? 0.5 : 0.25
    let projected: number | null = null
    if (bgt != null) {
      if (pace_ratio != null) {
        const adj = 1 + (pace_ratio - 1) * damping
        projected = bgt * Math.max(0.75, Math.min(1.35, adj))
      } else {
        projected = bgt  // sem pace: orçamento como melhor estimativa
      }
    }

    months.push({
      month:            m,
      year:             y,
      label:            `${MONTHS_PT[m - 1]}/${String(y).slice(2)}`,
      is_current:       false,
      projected,
      budget:           bgt,
      gap_pct:
        projected != null && bgt != null && bgt > 0
          ? ((projected - bgt) / bgt) * 100
          : null,
      revpar_projected: null,
    })
  }

  const projValues  = months.map(m => m.projected).filter((v): v is number => v != null)
  const bgtValues   = months.map(m => m.budget).filter((v): v is number => v != null)
  const total_projected = projValues.length ? projValues.reduce((s, v) => s + v, 0) : null
  const total_budget    = bgtValues.length === 3 ? bgtValues.reduce((s, v) => s + v, 0) : null
  const total_gap_pct   =
    total_projected != null && total_budget != null && total_budget > 0
      ? ((total_projected - total_budget) / total_budget) * 100
      : null

  return { months, total_projected, total_budget, total_gap_pct, pace_ratio }
}

// ─── Bloco markdown para o agente ─────────────────────────────────────────────

export function buildForecastBlock(forecast: ForecastResult | null): string {
  if (!forecast) return ''
  const { months, total_projected, total_budget, total_gap_pct, pace_ratio } = forecast
  if (!months.some(m => m.projected != null || m.budget != null)) return ''

  const fmtBRL = (n: number) =>
    `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n)}`
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  const hasAnyBudget = months.some(m => m.budget != null)

  const header = hasAnyBudget
    ? '| Mês | Previsto | Orçado | Gap | Status |\n|-----|----------|--------|-----|--------|'
    : '| Mês | Previsto |\n|-----|----------|'

  const rows = months.map(m => {
    const tag    = m.is_current ? ' ← atual' : ''
    const proj   = m.projected  != null ? fmtBRL(m.projected)  : '—'
    const bgt    = m.budget     != null ? fmtBRL(m.budget)     : '—'
    const gap    = m.gap_pct    != null ? fmtPct(m.gap_pct)   : '—'
    const status =
      m.gap_pct == null ? '⬜' :
      m.gap_pct >= -2   ? '✅' :
      m.gap_pct >= -8   ? '🟡' : '⚠️'

    return hasAnyBudget
      ? `| ${m.label}${tag} | ${proj} | ${bgt} | ${gap} | ${status} |`
      : `| ${m.label}${tag} | ${proj} |`
  }).join('\n')

  const totalLine = total_projected != null
    ? total_budget != null
      ? `Total 3 meses: ${fmtBRL(total_projected)} vs ${fmtBRL(total_budget)} orçado (${total_gap_pct != null ? fmtPct(total_gap_pct) : '—'})`
      : `Total 3 meses projetado: ${fmtBRL(total_projected)}`
    : ''

  const paceNote = pace_ratio != null
    ? pace_ratio > 1.02
      ? `Ritmo atual: **${(pace_ratio * 100).toFixed(0)}% do orçado** — acima da meta. Pode adotar postura mais conservadora nos próximos meses sem sacrificar a meta anual.`
      : pace_ratio < 0.96
      ? `Ritmo atual: **${(pace_ratio * 100).toFixed(0)}% do orçado** — abaixo da meta. Propostas mais agressivas são justificadas para recuperar o gap no fechamento do mês.`
      : `Ritmo atual: **${(pace_ratio * 100).toFixed(0)}% do orçado** — alinhado com a meta.`
    : ''

  return `\n\n## Previsão de receita — próximos 3 meses
${header}
${rows}
${totalLine ? `\n${totalLine}` : ''}${paceNote ? `\n${paceNote}` : ''}

Use esta previsão para calibrar a agressividade das propostas: meses com gap negativo precisam de ação mais ousada; meses já acima da meta permitem conservadorismo para proteger margem.`
}
