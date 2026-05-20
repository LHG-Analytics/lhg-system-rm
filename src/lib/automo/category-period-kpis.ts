import { getAutomPool, getUnitCategoryIds, getUnitPeriodType } from './client'
import { ddmmyyyyToIso, addDays } from './company-kpis'
import { buildPeriodCaseSQL, getValidPeriodsForType } from './period-helpers'
import { cteBaseSuiteDays, cteSuiteDaysByCategory } from './suite-days'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryPeriodKPIRow {
  categoria:  string
  periodo:    string
  locacoes:   number
  revpar:     number   // valorliquidolocacao / suite_dias_categoria
  giro:       number   // locacoes / suite_dias_categoria
  ticket:     number   // valortotal / locacoes
  tmo_horas:  number   // tempo médio de ocupação em horas (GAP 2)
  yield_hora: number   // ticket / tmo_horas (receita por hora — GAP 4)
  ocupacao:   number   // pct de tempo ocupado sobre tempo disponível (0–100)
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

interface RawRow {
  categoria:          string
  periodo:            string
  total_rentals:      string
  rental_revenue:     string
  total_value:        string
  total_occupied_sec: string
  suite_dias_cat:     string
}

// ─── Query principal ──────────────────────────────────────────────────────────

/**
 * Retorna KPIs desagregados por categoria × período:
 * RevPAR, Giro, Ticket Médio, TMO (h), Yield/hora e Ocupação.
 *
 * Usa o mesmo corte operacional 06:00 e denominador suítes-dia disponíveis
 * de fetchCompanyKPIsFromAutomo — números consistentes com o dashboard.
 *
 * Resolve GAPs 1, 2 e 4 do mapa de contexto do agente de RM.
 */
export async function queryCategoryPeriodKPIs(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
): Promise<CategoryPeriodKPIRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const categoryIds = await getUnitCategoryIds(unitSlug)
  if (!categoryIds.length) return []

  const periodType  = await getUnitPeriodType(unitSlug)
  const catIds      = categoryIds.join(',')
  const validPeriods = getValidPeriodsForType(periodType)

  // Corte operacional 06:00 — igual ao fetchCompanyKPIsFromAutomo
  const isoStart = ddmmyyyyToIso(startDateDDMMYYYY)
  const isoEnd   = addDays(ddmmyyyyToIso(endDateDDMMYYYY), 1)

  const periodSQL = buildPeriodCaseSQL(periodType)

  const sql = `
    WITH ${cteBaseSuiteDays(catIds)},
    ${cteSuiteDaysByCategory()},
    locacoes_classificadas AS (
      SELECT
        ca.descricao AS categoria,
        EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 AS dur,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)                                       AS h_in,
        COALESCE(CAST(la.valorliquidolocacao AS DECIMAL(15,4)), 0) AS receita_loc,
        COALESCE(CAST(la.valortotal          AS DECIMAL(15,4)), 0) AS valor_total,
        EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao))           AS occupied_sec
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND la.datafinaldaocupacao IS NOT NULL
        AND ca.id IN (${catIds})
    ),
    locacoes_com_periodo AS (
      SELECT
        categoria,
        ${periodSQL} AS periodo,
        receita_loc,
        valor_total,
        occupied_sec
      FROM locacoes_classificadas
    )
    SELECT
      lp.categoria,
      lp.periodo,
      COUNT(*)                                              AS total_rentals,
      COALESCE(SUM(lp.receita_loc), 0)                     AS rental_revenue,
      COALESCE(SUM(lp.valor_total), 0)                     AS total_value,
      COALESCE(SUM(lp.occupied_sec), 0)                    AS total_occupied_sec,
      sc.suite_dias                                         AS suite_dias_cat
    FROM locacoes_com_periodo lp
    INNER JOIN suite_dias_por_cat sc ON lp.categoria = sc.categoria
    GROUP BY lp.categoria, lp.periodo, sc.suite_dias
    ORDER BY lp.categoria, lp.periodo
  `

  try {
    const { rows } = await pool.query<RawRow>(sql, [isoStart, isoEnd])

    const result: CategoryPeriodKPIRow[] = rows
      .filter((r) => validPeriods.includes(r.periodo))
      .map((r) => {
        const locacoes     = Number(r.total_rentals)      || 0
        const receita      = Number(r.rental_revenue)     || 0
        const valorTotal   = Number(r.total_value)        || 0
        const occupiedSec  = Number(r.total_occupied_sec) || 0
        const suiteDias    = Number(r.suite_dias_cat)     || 1

        const ticket       = locacoes > 0 ? +(valorTotal / locacoes).toFixed(2) : 0
        const tmo_horas    = locacoes > 0 ? +(occupiedSec / locacoes / 3600).toFixed(2) : 0
        const yield_hora   = tmo_horas > 0 ? +(ticket / tmo_horas).toFixed(2) : 0
        const giro         = +(locacoes / suiteDias).toFixed(3)
        const revpar       = +(receita / suiteDias).toFixed(2)
        const availableSec = suiteDias * 86_400
        const ocupacao     = availableSec > 0 ? +((occupiedSec / availableSec) * 100).toFixed(2) : 0

        return { categoria: r.categoria, periodo: r.periodo, locacoes, revpar, giro, ticket, tmo_horas, yield_hora, ocupacao }
      })

    return result
  } catch {
    return []
  }
}

// ─── Builder de contexto para o agente ───────────────────────────────────────

/**
 * Formata os dados de categoria×período como bloco markdown para o system prompt.
 * Agrupa por categoria para facilitar leitura do agente.
 */
export function buildCategoryPeriodBlock(
  rows: CategoryPeriodKPIRow[],
  fmtMoney: (v: number) => string = (v) => `R$ ${v.toFixed(2)}`,
): string {
  if (!rows.length) return ''

  // Agrupa por categoria
  const byCategory = new Map<string, CategoryPeriodKPIRow[]>()
  for (const row of rows) {
    const list = byCategory.get(row.categoria) ?? []
    list.push(row)
    byCategory.set(row.categoria, list)
  }

  const lines: string[] = ['## Desempenho por Categoria × Período', '']
  lines.push('> RevPAR e Giro usam denominador suítes-dia disponíveis. Yield/hora = Ticket ÷ TMO.')
  lines.push('')

  for (const [cat, catRows] of byCategory) {
    lines.push(`### ${cat}`)
    lines.push('')
    lines.push('| Período | Loc. | RevPAR | Giro | Ticket | TMO (h) | Yield/h | Ocup. % |')
    lines.push('|---------|------|--------|------|--------|---------|---------|---------|')

    for (const r of catRows) {
      lines.push(
        `| ${r.periodo} | ${r.locacoes} | ${fmtMoney(r.revpar)} | ${r.giro.toFixed(2)} | ${fmtMoney(r.ticket)} | ${r.tmo_horas.toFixed(1)}h | ${fmtMoney(r.yield_hora)} | ${r.ocupacao.toFixed(1)}% |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
