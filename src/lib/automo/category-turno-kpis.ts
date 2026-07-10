import { getAutomPool, getUnitCategoryIds } from './client'
import { ddmmyyyyToIso, ddmmyyyyToIsoEnd } from './company-kpis'
import { cteBaseSuiteDays, cteSuiteDaysByCategory } from './suite-days'
import { getUnitTurnos, buildTurnoCaseSQL } from './turno-helpers'

export interface CategoryTurnoKPIRow {
  categoria: string
  turno:     string
  locacoes:  number
  giro:      number   // locações / suíte-dias-categoria prorateado pelas horas do turno
  receita:   number   // SUM(valortotal)
}

interface RawRow {
  categoria:      string
  turno:          string
  total_rentals:  string
  total_value:    string
  suite_dias_cat: string
}

/**
 * Retorna giro e receita desagregados por categoria × turno (Pico/Fora de pico
 * ou Diurno/Noturno, conforme a unidade — ver getUnitTurnos).
 *
 * Giro usa o mesmo denominador de suítes-dia disponíveis das demais queries de KPI,
 * prorateado pela fração de horas do turno no dia (turno de 6h = 6/24 da capacidade diária).
 */
export async function queryCategoryTurnoKPIs(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
): Promise<CategoryTurnoKPIRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const categoryIds = await getUnitCategoryIds(unitSlug)
  if (!categoryIds.length) return []

  const catIds  = categoryIds.join(',')
  const turnos  = await getUnitTurnos(unitSlug)
  const turnoSQL = buildTurnoCaseSQL(turnos, 'EXTRACT(HOUR FROM la.datainicialdaocupacao)::int')

  const isoStart = ddmmyyyyToIso(startDateDDMMYYYY)
  const nowBR    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayBR  = `${String(nowBR.getDate()).padStart(2, '0')}/${String(nowBR.getMonth() + 1).padStart(2, '0')}/${nowBR.getFullYear()}`
  const isoEnd   = endDateDDMMYYYY === todayBR
    ? ddmmyyyyToIsoEnd(endDateDDMMYYYY)
    : (() => {
        const [d, m, y] = endDateDDMMYYYY.split('/').map(Number)
        const dt = new Date(y, m - 1, d + 1)
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} 05:59:59`
      })()

  const sql = `
    WITH ${cteBaseSuiteDays(catIds)},
    ${cteSuiteDaysByCategory()},
    locacoes_com_turno AS (
      SELECT
        ca.descricao AS categoria,
        ${turnoSQL} AS turno,
        COALESCE(CAST(la.valortotal AS DECIMAL(15,4)), 0) AS valor_total
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <= $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
    )
    SELECT
      lt.categoria,
      lt.turno,
      COUNT(*)                          AS total_rentals,
      COALESCE(SUM(lt.valor_total), 0) AS total_value,
      sc.suite_dias                     AS suite_dias_cat
    FROM locacoes_com_turno lt
    INNER JOIN suite_dias_por_cat sc ON lt.categoria = sc.categoria
    GROUP BY lt.categoria, lt.turno, sc.suite_dias
    ORDER BY lt.categoria, lt.turno
  `

  try {
    const { rows } = await pool.query<RawRow>(sql, [isoStart, isoEnd])

    const turnoHours = (label: string) => {
      const t = turnos.find((x) => x.label === label)
      if (!t) return 24
      return t.startHour < t.endHour ? t.endHour - t.startHour : 24 - t.startHour + t.endHour
    }

    return rows.map((r) => {
      const locacoes  = Number(r.total_rentals)  || 0
      const receita   = Number(r.total_value)    || 0
      const suiteDias = Number(r.suite_dias_cat) || 1
      const capacidadeTurno = suiteDias * (turnoHours(r.turno) / 24)
      const giro = capacidadeTurno > 0 ? +(locacoes / capacidadeTurno).toFixed(3) : 0
      return { categoria: r.categoria, turno: r.turno, locacoes, giro, receita: +receita.toFixed(2) }
    })
  } catch {
    return []
  }
}
