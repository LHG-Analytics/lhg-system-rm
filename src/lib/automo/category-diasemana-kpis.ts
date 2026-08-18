import { getAutomPool, getUnitCategoryIds } from './client'
import { ddmmyyyyToIso, ddmmyyyyToIsoEnd } from './company-kpis'
import { cteBaseSuiteDays, cteSuiteDaysByCategoryDow } from './suite-days'

export interface CategoryDiaSemanaKPIRow {
  categoria: string
  diaSemana: string  // 'domingo'...'sábado'
  locacoes:  number  // contagem real — usado pro filtro de amostra mínima do motor de oportunidades
  giro:      number  // locações / suíte-dias-categoria-dow
}

const DOW_TO_PT: Record<number, string> = {
  0: 'domingo', 1: 'segunda-feira', 2: 'terça-feira', 3: 'quarta-feira',
  4: 'quinta-feira', 5: 'sexta-feira', 6: 'sábado',
}

/**
 * Giro por categoria × dia da semana, com CONTAGEM REAL de locações — diferente de
 * DataTableGiroByWeek (usado no chat do agente), que só tem a taxa de giro, sem contagem.
 * Sem a contagem real, o motor de oportunidades (opportunities.ts) não tinha como filtrar
 * dias com poucas locações — um único aluguel num dia fraco podia disparar um "desvio de
 * 60%" que é só ruído estatístico, não um padrão real.
 */
export async function queryCategoryDiaSemanaKPIs(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
): Promise<CategoryDiaSemanaKPIRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const categoryIds = await getUnitCategoryIds(unitSlug)
  if (!categoryIds.length) return []

  const catIds = categoryIds.join(',')

  const isoStart = ddmmyyyyToIso(startDateDDMMYYYY)
  const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayBR = `${String(nowBR.getDate()).padStart(2, '0')}/${String(nowBR.getMonth() + 1).padStart(2, '0')}/${nowBR.getFullYear()}`
  const isoEnd = endDateDDMMYYYY === todayBR
    ? ddmmyyyyToIsoEnd(endDateDDMMYYYY)
    : (() => {
        const [d, m, y] = endDateDDMMYYYY.split('/').map(Number)
        const dt = new Date(y, m - 1, d + 1)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} 05:59:59`
      })()

  const sql = `
    WITH ${cteBaseSuiteDays(catIds)},
    ${cteSuiteDaysByCategoryDow()},
    locacoes_dow AS (
      SELECT
        ca.descricao AS categoria,
        EXTRACT(DOW FROM (
          CASE
            WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) >= 6
              THEN la.datainicialdaocupacao
            ELSE la.datainicialdaocupacao - INTERVAL '1 day'
          END
        ))::int AS dow,
        COUNT(*) AS total_rentals
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <= $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
      GROUP BY ca.descricao, dow
    )
    SELECT
      scd.categoria                     AS categoria,
      scd.dow                           AS dow,
      COALESCE(ld.total_rentals, 0)     AS total_rentals,
      scd.suite_dias                    AS suite_dias
    FROM suite_dias_cat_dow scd
    LEFT JOIN locacoes_dow ld ON scd.categoria = ld.categoria AND scd.dow = ld.dow
  `

  try {
    const { rows } = await pool.query<{ categoria: string; dow: string; total_rentals: string; suite_dias: string }>(sql, [isoStart, isoEnd])

    return rows
      .map((r) => {
        const dow = Number(r.dow)
        const diaSemana = DOW_TO_PT[dow]
        if (!diaSemana) return null
        const locacoes = Number(r.total_rentals) || 0
        const suiteDias = Number(r.suite_dias) || 0
        const giro = suiteDias > 0 ? +(locacoes / suiteDias).toFixed(3) : 0
        return { categoria: r.categoria, diaSemana, locacoes, giro }
      })
      .filter((x): x is CategoryDiaSemanaKPIRow => x !== null)
  } catch {
    return []
  }
}
