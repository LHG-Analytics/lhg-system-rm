import type {
  CompanyKPIResponse,
  CompanyBigNumbers,
  CompanyTotalResult,
  CompanyBigNumbersPrevMonthDate,
  DataTableSuiteCategory,
  SuiteCategoryKPI,
  DataTableGiroByWeek,
  DataTableRevparByWeek,
  BillingRentalTypeItem,
} from '@/lib/kpis/types'
import { Pool } from 'pg'
import { getAutomPool, getUnitCategoryIds, getUnitPeriodType } from './client'
import { buildPeriodCaseSQL, getValidPeriodsForType, scheduledReservaExistsSQL } from './period-helpers'
import {
  cteBaseSuiteDays,
  cteSuiteDaysTotal,
  cteSuiteDaysByCategory,
  cteSuiteDaysByCategoryDow,
  cteSuiteDaysByDow,
} from './suite-days'
import { buildWeekdayFilterSQL } from './operational-day'

// ─── Date helpers (exportados para uso em channel-kpis.ts) ────────────────────

/** DD/MM/YYYY → ISO string para uso em SQL (corte operacional 06:00, igual ao Analytics) */
export function ddmmyyyyToIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 06:00:00`
}

/** Adiciona N dias a uma string ISO 'YYYY-MM-DD HH:MM:SS' preservando horário 06:00 */
export function addDays(iso: string, n: number): string {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, mo - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} 06:00:00`
}

/**
 * DD/MM/YYYY → ISO string para bound INCLUSIVO de fim de período (05:59:59).
 * Idêntico ao Analytics: endHour=5, endMinute=59, endSecond=59.
 * Usar com <= $2 (nunca com < $2).
 */
export function ddmmyyyyToIsoEnd(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 05:59:59`
}

/**
 * Adiciona N dias e retorna horário de fim 05:59:59.
 * Usar para calcular isoEnd de períodos fechados (endDate + 1 dia a 05:59:59).
 * Dia operacional: 06:00:00 → 05:59:59 (igual ao Automo).
 */
function addDaysEnd(iso: string, n: number): string {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, mo - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} 05:59:59`
}

/** Desloca N meses em uma string ISO 'YYYY-MM-DD HH:MM:SS' (clampeia dia ao último do mês destino).
 *  Preserva o horário da string de entrada (06:00:00 para isoStart, 05:59:59 para isoEnd). */
function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
  if (dt.getMonth() !== ((m - 1 + months + 12) % 12)) {
    dt.setDate(0)
  }
  const timePart = iso.length > 10 ? iso.slice(10) : ' 06:00:00'
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}${timePart}`
}

/** Número de dias entre duas strings ISO */
function daysBetween(isoStart: string, isoEnd: string): number {
  const s = new Date(isoStart.replace(' ', 'T') + 'Z')
  const e = new Date(isoEnd.replace(' ', 'T') + 'Z')
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000))
}

/** Formata total de segundos para HH:MM:SS */
function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Gera fragmento SQL de intervalo de data conforme tipo (entrada/saída/ambas).
 * 'all' e 'checkin' → filtra por datainicialdaocupacao (padrão KPI).
 * 'checkout'        → filtra por datafinaldaocupacao.
 * Retorna um par [coluna, fragmento] — a coluna é usada nos filtros de hora.
 */
export function buildDateRangeFilter(dateType: string): { col: string; fragment: string } {
  if (dateType === 'checkout') {
    return {
      col:      'la.datafinaldaocupacao',
      fragment: 'la.datafinaldaocupacao >= $1 AND la.datafinaldaocupacao <= $2',
    }
  }
  return {
    col:      'la.datainicialdaocupacao',
    fragment: 'la.datainicialdaocupacao >= $1 AND la.datainicialdaocupacao <= $2',
  }
}

/**
 * Gera fragmento SQL para filtrar por fimocupacaotipo.
 * 'TODAS' → sem filtro; 'ABERTA' → IS NULL; outros → = 'VALOR'
 */
export function buildStatusFilter(status: string): string {
  if (status === 'TODAS')  return ''
  if (status === 'ABERTA') return 'AND la.fimocupacaotipo IS NULL'
  return `AND la.fimocupacaotipo = '${status}'`
}

/**
 * Gera fragmento SQL para filtrar por hora de início da locação.
 * startHour=0 + endHour=23 → sem filtro (todos os horários).
 * Suporta wrap-around: ex. startHour=22, endHour=6 → OR condition.
 */
export function buildTimeFilter(startHour: number, endHour: number, col = 'la.datainicialdaocupacao'): string {
  // 06:00:00 → 05:59:59 = dia operacional completo = sem filtro adicional
  if (startHour === 6 && endHour === 5) return ''
  // 00:00:00 → 23:59:59 = sem filtro (legado)
  if (startHour === 0 && endHour === 23) return ''

  const sh = `'${String(startHour).padStart(2, '0')}:00:00'`
  const eh = `'${String(endHour).padStart(2, '0')}:59:59'`
  const t  = `${col}::time`

  if (startHour <= endHour) {
    return `AND ${t} >= ${sh} AND ${t} <= ${eh}`
  }
  // Wrap-around (ex: 22:00:00 → 05:59:59, passa da meia-noite)
  return `AND (${t} >= ${sh} OR ${t} <= ${eh})`
}

/** Mapeamento DOW (0=domingo) → nome completo em pt-BR */
const DOW_TO_PT: Record<number, string> = {
  0: 'domingo',
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
  6: 'sábado',
}

// ─── BigNumbers query ─────────────────────────────────────────────────────────

interface BigNumbersRow {
  total_rentals: string
  total_all_value: string
  total_occupied_time: string
  total_sale_direct: string
  total_suite_dias: string
}

async function queryBigNumbers(
  pool: Pool,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  daysDiff: number,
  timeFilter = '',
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
  dateCol = 'la.datainicialdaocupacao',
  weekdays?: number[],
) {
  if (!pool) throw new Error('pool is null')

  const weekdayFilter = buildWeekdayFilterSQL(weekdays, dateCol)

  // la.valortotal = locação + consumo - desconto (campo pré-calculado pelo ERP).
  // Analytics soma ainda vendas_diretas (vendadireta) com os mesmos $1/$2 — replicado aqui.
  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2', weekdays)},
    ${cteSuiteDaysTotal()},
    vendas_diretas AS (
      SELECT COALESCE(SUM(receita_item - desconto_proporcional), 0) AS total_sale_direct
      FROM (
        SELECT
          CAST(sei.precovenda  AS DECIMAL(15,4)) * CAST(sei.quantidade AS DECIMAL(15,4)) AS receita_item,
          COALESCE(CAST(v.desconto AS DECIMAL(15,4)), 0) /
            NULLIF((
              SELECT COUNT(*) FROM saidaestoqueitem sei2
              WHERE sei2.id_saidaestoque = se.id AND sei2.cancelado IS NULL
            ), 0) AS desconto_proporcional
        FROM saidaestoque se
        INNER JOIN vendadireta         vd  ON se.id = vd.id_saidaestoque
        INNER JOIN saidaestoqueitem    sei ON se.id = sei.id_saidaestoque
        LEFT  JOIN venda               v   ON se.id = v.id_saidaestoque
        WHERE vd.venda_completa = true
          AND sei.cancelado IS NULL
          AND sei.datasaidaitem >= $1
          AND sei.datasaidaitem <= $2
      ) vd_detail
    )
    SELECT
      COUNT(*)                                                   AS total_rentals,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotal AS DECIMAL(15,4)), 0)
      ), 0)                                                      AS total_all_value,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)
      ), 0)                                                      AS total_occupied_time,
      (SELECT total_sale_direct FROM vendas_diretas)             AS total_sale_direct,
      (SELECT suite_dias FROM suite_dias_total)                  AS total_suite_dias
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE ${dateCol} >= $1
      AND ${dateCol} <= $2
      ${statusFilter}
      AND ca.id IN (${catIds})
      ${timeFilter}
      ${weekdayFilter}
  `

  const { rows } = await pool.query<BigNumbersRow>(sql, [isoStart, isoEnd])
  const r = rows[0]

  // total_suite_dias já considera bloqueios e janela do período
  const totalSuiteDias  = Number(r.total_suite_dias)    || 1
  const totalRentals    = Number(r.total_rentals)        || 0
  const locacaoValue    = Number(r.total_all_value)      || 0
  const saleDirect      = Number(r.total_sale_direct)    || 0
  const totalAllValue   = +(locacaoValue + saleDirect).toFixed(2)
  const occupiedTime   = Number(r.total_occupied_time) || 0

  const avgTicket = totalRentals > 0 ? +(totalAllValue / totalRentals).toFixed(2) : 0
  // Giro/TRevPAR: total_rentals (ou valor) / suite-dias disponíveis
  const giro      = +(totalRentals / totalSuiteDias).toFixed(2)
  const trevpar   = +(totalAllValue / totalSuiteDias).toFixed(2)
  const avgOccTime = totalRentals > 0 ? secondsToHMS(occupiedTime / totalRentals) : '00:00:00'

  // Para retrocompatibilidade, expomos um "totalSuites equivalente" = suite_dias / dias
  const totalSuites = Math.max(1, Math.round(totalSuiteDias / Math.max(1, daysDiff)))

  return { totalAllValue, totalRentals, avgTicket, giro, trevpar, avgOccTime, totalSuites }
}

// ─── DataTableSuiteCategory query ─────────────────────────────────────────────

interface SuiteCatRow {
  category: string
  total_rentals: string
  total_value: string
  rental_revenue: string
  trevpar_revenue: string
  total_occupied_time: string
  suite_dias_categoria: string
}

async function queryDataTableSuiteCategory(
  pool: Pool,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  daysDiff: number,
  timeFilter = '',
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
  dateCol = 'la.datainicialdaocupacao',
  weekdays?: number[],
): Promise<DataTableSuiteCategory[]> {
  const weekdayFilter = buildWeekdayFilterSQL(weekdays, dateCol)
  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2', weekdays)},
    ${cteSuiteDaysByCategory()}
    SELECT
      ca.descricao                       AS category,
      COUNT(*)                           AS total_rentals,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotal          AS DECIMAL(15,4)), 0)
      ), 0)                              AS total_value,
      COALESCE(SUM(
        COALESCE(CAST(la.valorliquidolocacao AS DECIMAL(15,4)), 0)
      ), 0)                              AS rental_revenue,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotal          AS DECIMAL(15,4)), 0) +
        COALESCE(CAST(la.gorjeta             AS DECIMAL(15,4)), 0)
      ), 0)                              AS trevpar_revenue,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)
      ), 0)                              AS total_occupied_time,
      sc.suite_dias                      AS suite_dias_categoria
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    INNER JOIN suite_dias_por_cat sc ON ca.descricao = sc.categoria
    WHERE ${dateCol} >= $1
      AND ${dateCol} <= $2
      ${statusFilter}
      AND ca.id IN (${catIds})
      ${timeFilter}
      ${weekdayFilter}
    GROUP BY ca.descricao, sc.suite_dias
    ORDER BY total_value DESC
  `

  const { rows } = await pool.query<SuiteCatRow>(sql, [isoStart, isoEnd])

  return rows.map((r) => {
    const totalRentals    = Number(r.total_rentals)         || 0
    const totalValue      = Number(r.total_value)            || 0  // valortotal = locação + consumo - desconto
    const rentalRevenue   = Number(r.rental_revenue)        || 0  // valorliquidolocacao — base do RevPAR
    const trevparRevenue  = Number(r.trevpar_revenue)       || 0
    const occupiedTime    = Number(r.total_occupied_time)    || 0
    const suiteDiasCat    = Number(r.suite_dias_categoria)  || 1

    const ticketAverage   = totalRentals > 0 ? +(totalValue / totalRentals).toFixed(2) : 0
    // Denominador agora é suítes-dia (já desconta bloqueios e considera janela)
    const giro            = +(totalRentals / suiteDiasCat).toFixed(2)
    const revpar          = +(rentalRevenue / suiteDiasCat).toFixed(2)
    const trevpar         = +(trevparRevenue / suiteDiasCat).toFixed(2)
    const availableTime   = suiteDiasCat * 86_400
    const occupancyRate   = availableTime > 0 ? +((occupiedTime / availableTime) * 100).toFixed(2) : 0
    const avgOccTime      = totalRentals > 0 ? secondsToHMS(occupiedTime / totalRentals) : '00:00:00'

    const kpi: SuiteCategoryKPI = {
      totalRentalsApartments: totalRentals,
      totalValue:             +totalValue.toFixed(2),
      totalTicketAverage:     ticketAverage,
      giro,
      revpar,
      trevpar,
      occupancyRate,
      averageOccupationTime:  avgOccTime,
    }

    return { [r.category]: kpi } as DataTableSuiteCategory
  })
}

// ─── DataTableGiroByWeek + DataTableRevparByWeek query ────────────────────────

interface WeekRow {
  category:           string
  dow:                string   // '0'..'6'
  total_rentals:      string
  rental_revenue:     string
  suite_dias_cat_dow: string
  suite_dias_total_dow: string
  total_rentals_dow:  string
  total_revenue_dow:  string
}

async function queryWeekTables(
  pool: Pool,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  timeFilter = '',
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
  dateCol = 'la.datainicialdaocupacao',
  weekdays?: number[],
): Promise<{ giro: DataTableGiroByWeek[]; revpar: DataTableRevparByWeek[] }> {
  const weekdayFilter = buildWeekdayFilterSQL(weekdays, dateCol)
  // CROSS JOIN entre categorias ativas × todos os DOW do período.
  // LEFT JOIN nos dados reais → dias sem locação aparecem com 0 (comportamento original).
  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2', weekdays)},
    ${cteSuiteDaysByCategoryDow()},
    ${cteSuiteDaysByDow()},
    categories_in_period AS (
      -- Apenas categorias que tiveram ao menos 1 locação no período
      SELECT DISTINCT ca.descricao AS category
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ${dateCol} >= $1
        AND ${dateCol} <= $2
        ${statusFilter}
        AND ca.id IN (${catIds})
        ${timeFilter}
        ${weekdayFilter}
    ),
    rentals_cat_dow AS (
      SELECT
        ca.descricao AS category,
        EXTRACT(DOW FROM (
          CASE
            WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) >= 6
              THEN la.datainicialdaocupacao
            ELSE la.datainicialdaocupacao - INTERVAL '1 day'
          END
        )) AS dow,
        COUNT(*) AS total_rentals,
        COALESCE(SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))), 0) AS rental_revenue
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ${dateCol} >= $1
        AND ${dateCol} <= $2
        ${statusFilter}
        AND ca.id IN (${catIds})
        ${timeFilter}
        ${weekdayFilter}
      GROUP BY ca.descricao, dow
    ),
    totals_by_dow AS (
      SELECT
        dow,
        SUM(total_rentals)  AS total_rentals,
        SUM(rental_revenue) AS rental_revenue
      FROM rentals_cat_dow
      GROUP BY dow
    ),
    dow_universe AS (
      -- Universo de DOW que ocorreram no período (vem das suítes-dia)
      SELECT DISTINCT dow FROM suite_dias_total_dow
    )
    -- CROSS JOIN: toda categoria × todo DOW do período, LEFT JOIN nos dados reais
    SELECT
      c.category,
      du.dow                                                  AS dow,
      COALESCE(r.total_rentals,    0)                         AS total_rentals,
      COALESCE(r.rental_revenue,   0)                         AS rental_revenue,
      COALESCE(scd.suite_dias,     1)                         AS suite_dias_cat_dow,
      COALESCE(sdtd.suite_dias,    1)                         AS suite_dias_total_dow,
      COALESCE(td.total_rentals,   0)                         AS total_rentals_dow,
      COALESCE(td.rental_revenue,  0)                         AS total_revenue_dow
    FROM categories_in_period c
    CROSS JOIN dow_universe du
    LEFT JOIN suite_dias_cat_dow scd  ON c.category = scd.categoria AND du.dow = scd.dow
    LEFT JOIN suite_dias_total_dow sdtd ON du.dow = sdtd.dow
    LEFT JOIN rentals_cat_dow      r  ON c.category = r.category AND du.dow = r.dow
    LEFT JOIN totals_by_dow       td  ON du.dow = td.dow
    ORDER BY c.category, du.dow
  `

  const { rows } = await pool.query<WeekRow>(sql, [isoStart, isoEnd])

  const giroMap  = new Map<string, Record<string, { giro: number; totalGiro: number }>>()
  const revparMap = new Map<string, Record<string, { revpar: number; totalRevpar: number }>>()

  for (const r of rows) {
    const dow        = Number(r.dow)
    const dayName    = DOW_TO_PT[dow]
    if (!dayName) continue

    const catRentals       = Number(r.total_rentals)        || 0
    const catRevenue       = Number(r.rental_revenue)       || 0
    const suiteDiasCatDow  = Number(r.suite_dias_cat_dow)   || 1
    const suiteDiasTotDow  = Number(r.suite_dias_total_dow) || 1
    const totRentals       = Number(r.total_rentals_dow)    || 0
    const totRevenue       = Number(r.total_revenue_dow)    || 0

    // Denominador = suite-dias daquele DOW (já desconta bloqueios)
    const giro        = +(catRentals  / suiteDiasCatDow).toFixed(2)
    const totalGiro   = +(totRentals  / suiteDiasTotDow).toFixed(2)
    const revpar      = +(catRevenue  / suiteDiasCatDow).toFixed(2)
    const totalRevpar = +(totRevenue  / suiteDiasTotDow).toFixed(2)

    if (!giroMap.has(r.category))   giroMap.set(r.category, {})
    if (!revparMap.has(r.category)) revparMap.set(r.category, {})

    giroMap.get(r.category)![dayName]   = { giro, totalGiro }
    revparMap.get(r.category)![dayName] = { revpar, totalRevpar }
  }

  const giro:   DataTableGiroByWeek[]   = Array.from(giroMap.entries()).map(([cat, days]) => ({ [cat]: days } as DataTableGiroByWeek))
  const revpar: DataTableRevparByWeek[] = Array.from(revparMap.entries()).map(([cat, days]) => ({ [cat]: days } as DataTableRevparByWeek))

  return { giro, revpar }
}

// ─── RevPAR e Occupancy totais ────────────────────────────────────────────────

interface TotalRevOccRow {
  rental_revenue:     string
  total_occupied_time: string
  total_suite_dias:   string
}

async function queryTotalRevOcc(
  pool: Pool,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  _daysDiff: number,
  timeFilter = '',
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
  dateCol = 'la.datainicialdaocupacao',
  weekdays?: number[],
): Promise<{ totalRevpar: number; totalOccupancyRate: number }> {
  const weekdayFilter = buildWeekdayFilterSQL(weekdays, dateCol)
  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2', weekdays)},
    ${cteSuiteDaysTotal()}
    SELECT
      COALESCE(SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))), 0) AS rental_revenue,
      COALESCE(SUM(EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)), 0) AS total_occupied_time,
      (SELECT suite_dias FROM suite_dias_total) AS total_suite_dias
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE ${dateCol} >= $1
      AND ${dateCol} <= $2
      ${statusFilter}
      AND ca.id IN (${catIds})
      ${timeFilter}
      ${weekdayFilter}
  `

  const { rows } = await pool.query<TotalRevOccRow>(sql, [isoStart, isoEnd])
  const r = rows[0]
  const rentalRevenue  = Number(r.rental_revenue)      || 0
  const occupiedTime   = Number(r.total_occupied_time)  || 0
  const totalSuiteDias = Number(r.total_suite_dias)    || 1

  const totalRevpar      = +(rentalRevenue / totalSuiteDias).toFixed(2)
  const availableTime    = totalSuiteDias * 86_400
  const totalOccupancyRate = availableTime > 0 ? +((occupiedTime / availableTime) * 100).toFixed(2) : 0

  return { totalRevpar, totalOccupancyRate }
}

// ─── Period Mix (inline — mesmos params que queryBigNumbers) ─────────────────

async function queryPeriodMixInline(
  pool: Pool,
  periodType: 'standard' | 'altana',
  catIds: string,
  isoStart: string,
  isoEnd: string,
  timeFilter: string,
  statusFilter: string,
  dateCol: string,
  weekdays?: number[],
): Promise<BillingRentalTypeItem[]> {
  const periodCase   = buildPeriodCaseSQL(periodType, true)
  const validPeriods = getValidPeriodsForType(periodType)
  const weekdayFilter = buildWeekdayFilterSQL(weekdays, dateCol)

  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2', weekdays)},
    ${cteSuiteDaysByCategory()},
    base AS (
      SELECT
        EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 AS dur,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)                                       AS h_in,
        ${scheduledReservaExistsSQL('la')} AS is_scheduled,
        la.valortotal::numeric AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      INNER JOIN suite_dias_por_cat  spc ON ca.descricao = spc.categoria
      WHERE ${dateCol} >= $1
        AND ${dateCol} <= $2
        ${statusFilter}
        AND ca.id IN (${catIds})
        ${timeFilter}
        ${weekdayFilter}
    ),
    classificado AS (
      SELECT ${periodCase} AS periodo, receita FROM base
    ),
    totais AS (
      SELECT COALESCE(SUM(receita), 0) AS total FROM classificado
    )
    SELECT
      periodo,
      ROUND(SUM(receita)::numeric, 2)              AS value,
      COUNT(*)                                      AS locacoes,
      CASE WHEN COUNT(*) > 0
           THEN ROUND((SUM(receita) / COUNT(*))::numeric, 2)
           ELSE 0
      END AS ticket,
      CASE WHEN (SELECT total FROM totais) > 0
           THEN ROUND((SUM(receita) / (SELECT total FROM totais) * 100)::numeric, 1)
           ELSE 0
      END AS percent
    FROM classificado
    GROUP BY periodo
    ORDER BY value DESC
  `

  try {
    const { rows } = await pool.query<{
      periodo: string; value: string; locacoes: string; ticket: string; percent: string
    }>(sql, [isoStart, isoEnd])

    const all: BillingRentalTypeItem[] = rows.map((r) => ({
      rentalType: r.periodo,
      value:      Number(r.value)    || 0,
      locacoes:   Number(r.locacoes) || 0,
      ticket:     Number(r.ticket)   || 0,
      percent:    Number(r.percent)  || 0,
    }))

    if (validPeriods?.length) {
      const ordered = validPeriods
        .map((p) => all.find((r) => r.rentalType === p))
        .filter((r): r is BillingRentalTypeItem => !!r)

      const totalFiltered = ordered.reduce((s, r) => s + r.value, 0)
      return ordered.map((r) => ({
        ...r,
        percent: totalFiltered > 0 ? +((r.value / totalFiltered) * 100).toFixed(1) : 0,
      }))
    }
    return all
  } catch (err) {
    console.error('[PeriodMixInline] Query falhou:', err instanceof Error ? err.message : err)
    return []
  }
}

// ─── Ponto de entrada público ─────────────────────────────────────────────────

/**
 * Busca Company KPIs diretamente do Automo PostgreSQL.
 * KPIs agregados a partir do ERP Automo (PostgreSQL).
 */
export async function fetchCompanyKPIsFromAutomo(
  unitSlug: string,
  startDateDDMMYYYY: string,   // DD/MM/YYYY
  endDateDDMMYYYY:   string,   // DD/MM/YYYY
  startHour = 0,               // 0–23, inclusive
  endHour   = 23,              // 0–23, inclusive; 0+23 = sem filtro
  rentalStatus = 'FINALIZADA', // FINALIZADA | TRANSFERIDA | CANCELADA | ABERTA | TODAS
  dateType = 'checkin',        // checkin | checkout | all
  weekdays?: number[],         // 0=domingo…6=sábado; undefined/vazio/7 dias = sem filtro
): Promise<CompanyKPIResponse> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) throw new Error(`Automo pool indisponível para ${unitSlug}`)

  const catIds = (await getUnitCategoryIds(unitSlug)).join(',')
  if (!catIds) throw new Error(`Nenhum category ID configurado para ${unitSlug}`)

  // Hoje no fuso BRT (DD/MM/YYYY) — distingue período aberto (endDate=hoje) de fechado
  const nowBR      = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayBRStr = `${String(nowBR.getDate()).padStart(2, '0')}/${String(nowBR.getMonth() + 1).padStart(2, '0')}/${nowBR.getFullYear()}`

  // Período atual
  const isoStart = ddmmyyyyToIso(startDateDDMMYYYY)
  // Bound INCLUSIVO de fim de período, idêntico ao Analytics (endHour=5, endMinute=59, endSecond=59).
  // Período aberto (hoje): endDate 05:59:59 com <= $2 — inclui madrugada do dia corrente.
  // Período fechado (passado): (endDate+1) 05:59:59 com <= $2 — inclui o último dia operacional inteiro.
  // Isso garante que locações em sub-segundos (ex: 05:59:59.500000) NÃO entrem, alinhado ao Analytics.
  const isoEnd   = endDateDDMMYYYY === todayBRStr
    ? ddmmyyyyToIsoEnd(endDateDDMMYYYY)
    : addDaysEnd(ddmmyyyyToIso(endDateDDMMYYYY), 1)
  const daysDiff = daysBetween(isoStart, isoEnd)

  // Período anterior a/a (mesmo período do ano passado)
  const prevIsoStart = isoStart.replace(/^(\d{4})/, (y) => String(Number(y) - 1))
  const prevIsoEnd   = isoEnd.replace(/^(\d{4})/, (y) => String(Number(y) - 1))

  // Período anterior m/m (mesmo período deslocado 1 mês atrás)
  const prevMonIsoStart = shiftMonths(isoStart, -1)
  const prevMonIsoEnd   = shiftMonths(isoEnd,   -1)

  // Dados do mês atual até ontem (para previsão de fechamento)
  const monthStart = new Date(nowBR.getFullYear(), nowBR.getMonth(), 1)
  const yesterday  = new Date(nowBR.getFullYear(), nowBR.getMonth(), nowBR.getDate() - 1)
  const monIsoStart = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01 06:00:00`
  const monIsoEnd   = `${nowBR.getFullYear()}-${String(nowBR.getMonth() + 1).padStart(2, '0')}-${String(nowBR.getDate()).padStart(2, '0')} 05:59:59`
  const daysElapsed = yesterday.getDate()
  const totalDaysInMonth = new Date(nowBR.getFullYear(), nowBR.getMonth() + 1, 0).getDate()
  const remainingDays = totalDaysInMonth - daysElapsed

  const periodType = await getUnitPeriodType(unitSlug)

  // Filtros dinâmicos (aplicados a todas as queries de locação)
  const { col: dateCol } = buildDateRangeFilter(dateType)
  const timeFilter       = buildTimeFilter(startHour, endHour, dateCol)
  const statusFilter     = buildStatusFilter(rentalStatus)

  // Executa queries em paralelo — cada uma loga o próprio erro para diagnóstico
  const tag = `[KPIs/${unitSlug}]`

  function tagError(query: string) {
    return (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e))
      console.error(`${tag} Query falhou [${query}]:`, err.message)
      throw err
    }
  }

  const [currentBN, prevBN, prevMonBN, monthBN, revOcc, prevRevOcc, prevMonRevOcc, monthRevOcc, suiteCatTable, weekTables, periodMix] = await Promise.all([
    queryBigNumbers(pool, catIds, isoStart,         isoEnd,         daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('BigNumbers/current')),
    queryBigNumbers(pool, catIds, prevIsoStart,     prevIsoEnd,     daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('BigNumbers/prev')),
    queryBigNumbers(pool, catIds, prevMonIsoStart,  prevMonIsoEnd,  daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('BigNumbers/prevMonth')),
    queryBigNumbers(pool, catIds, monIsoStart,      monIsoEnd,      daysElapsed || 1,   timeFilter, statusFilter, dateCol, weekdays).catch(tagError('BigNumbers/month')),
    queryTotalRevOcc(pool, catIds, isoStart,        isoEnd,         daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('TotalRevOcc')),
    queryTotalRevOcc(pool, catIds, prevIsoStart,    prevIsoEnd,     daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('TotalRevOcc/prev')),
    queryTotalRevOcc(pool, catIds, prevMonIsoStart, prevMonIsoEnd,  daysDiff,           timeFilter, statusFilter, dateCol, weekdays).catch(tagError('TotalRevOcc/prevMonth')),
    queryTotalRevOcc(pool, catIds, monIsoStart,     monIsoEnd,      daysElapsed || 1,   timeFilter, statusFilter, dateCol, weekdays).catch(tagError('TotalRevOcc/month')),
    queryDataTableSuiteCategory(pool, catIds, isoStart, isoEnd, daysDiff,              timeFilter, statusFilter, dateCol, weekdays).catch(tagError('DataTableSuiteCategory')),
    queryWeekTables(pool, catIds, isoStart, isoEnd,                                     timeFilter, statusFilter, dateCol, weekdays).catch(tagError('WeekTables')),
    queryPeriodMixInline(pool, periodType, catIds, isoStart, isoEnd,                    timeFilter, statusFilter, dateCol, weekdays),
  ])

  // Previsão de fechamento do mês
  const safeElapsed = daysElapsed > 0 ? daysElapsed : 1
  const dailyAvgValue   = monthBN.totalAllValue   / safeElapsed
  const dailyAvgRentals = monthBN.totalRentals     / safeElapsed
  const forecastValue   = monthBN.totalAllValue   + dailyAvgValue   * remainingDays
  const forecastRentals = monthBN.totalRentals     + dailyAvgRentals * remainingDays
  // RevPAR/Ocupação forecast: taxa diária do mês atual (já normalizada por suites×dias) → projetada para o mês inteiro
  const revparForecast     = +monthRevOcc.totalRevpar.toFixed(2)
  const occupancyForecast  = +monthRevOcc.totalOccupancyRate.toFixed(2)

  const monthlyForecast: CompanyBigNumbers['monthlyForecast'] = {
    totalAllValueForecast:              +forecastValue.toFixed(2),
    totalAllRentalsApartmentsForecast:  Math.round(forecastRentals),
    totalAllTicketAverageForecast:      forecastRentals > 0 ? +(forecastValue / forecastRentals).toFixed(2) : 0,
    totalAllTrevparForecast:            currentBN.totalSuites > 0 ? +(forecastValue / currentBN.totalSuites / totalDaysInMonth).toFixed(2) : 0,
    totalAllRevparForecast:             revparForecast,
    totalAllGiroForecast:               currentBN.totalSuites > 0 ? +(forecastRentals / currentBN.totalSuites / totalDaysInMonth).toFixed(2) : 0,
    totalAverageOccupationTimeForecast: monthBN.avgOccTime,
    totalAllOccupancyRateForecast:      occupancyForecast,
  }

  const prevMonthDate: CompanyBigNumbersPrevMonthDate = {
    totalAllValuePrevMonth:              prevMonBN.totalAllValue,
    totalAllRentalsApartmentsPrevMonth:  prevMonBN.totalRentals,
    totalAllTicketAveragePrevMonth:      prevMonBN.avgTicket,
    totalAllTrevparPrevMonth:            prevMonBN.trevpar,
    totalAllRevparPrevMonth:             prevMonRevOcc.totalRevpar,
    totalAllGiroPrevMonth:               prevMonBN.giro,
    totalAverageOccupationTimePrevMonth: prevMonBN.avgOccTime,
    totalAllOccupancyRatePrevMonth:      prevMonRevOcc.totalOccupancyRate,
  }

  const bigNumbers: CompanyBigNumbers = {
    currentDate: {
      totalAllValue:              currentBN.totalAllValue,
      totalAllRentalsApartments:  currentBN.totalRentals,
      totalAllTicketAverage:      currentBN.avgTicket,
      totalAllTrevpar:            currentBN.trevpar,
      totalAllGiro:               currentBN.giro,
      totalAverageOccupationTime: currentBN.avgOccTime,
    },
    previousDate: {
      totalAllValuePreviousData:              prevBN.totalAllValue,
      totalAllRentalsApartmentsPreviousData:  prevBN.totalRentals,
      totalAllTicketAveragePreviousData:      prevBN.avgTicket,
      totalAllTrevparPreviousData:            prevBN.trevpar,
      totalAllRevparPreviousData:             prevRevOcc.totalRevpar,
      totalAllGiroPreviousData:               prevBN.giro,
      totalAverageOccupationTimePreviousData: prevBN.avgOccTime,
      totalAllOccupancyRatePreviousData:      prevRevOcc.totalOccupancyRate,
    },
    prevMonthDate,
    monthlyForecast,
  }

  const totalResult: CompanyTotalResult = {
    totalAllRentalsApartments: currentBN.totalRentals,
    totalAllValue:             currentBN.totalAllValue,
    totalAllTicketAverage:     currentBN.avgTicket,
    totalGiro:                 currentBN.giro,
    totalRevpar:               revOcc.totalRevpar,
    totalTrevpar:              currentBN.trevpar,
    totalAverageOccupationTime: currentBN.avgOccTime,
    totalOccupancyRate:        revOcc.totalOccupancyRate,
  }

  return {
    BigNumbers:                 [bigNumbers],
    TotalResult:                totalResult,
    BillingRentalType:          periodMix,
    RevenueByDate:              [],
    RevenueBySuiteCategory:     [],
    RentalsByDate:              [],
    RevparByDate:               [],
    TicketAverageByDate:        [],
    TrevparByDate:              [],
    GiroByDate:                 [],
    OccupancyRateByDate:        [],
    OccupancyRateBySuiteCategory: [],
    DataTableSuiteCategory:     suiteCatTable,
    DataTableGiroByWeek:        weekTables.giro,
    DataTableRevparByWeek:      weekTables.revpar,
  }
}
