import type {
  CompanyKPIResponse,
  CompanyBigNumbers,
  CompanyTotalResult,
  DataTableSuiteCategory,
  SuiteCategoryKPI,
  DataTableGiroByWeek,
  DataTableRevparByWeek,
} from '@/lib/kpis/types'
import { getAutomPool, UNIT_CATEGORY_IDS } from './client'

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** DD/MM/YYYY → ISO string para uso em SQL (UTC midnight) */
function ddmmyyyyToIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 00:00:00`
}

/** Adiciona N dias a uma string ISO 'YYYY-MM-DD 00:00:00' */
function addDays(iso: string, n: number): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10) + ' 00:00:00'
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
 * Gera fragmento SQL para filtrar por hora de início da locação.
 * startHour=0 + endHour=23 → sem filtro (todos os horários).
 * Suporta wrap-around: ex. startHour=22, endHour=6 → OR condition.
 */
function buildTimeFilter(startHour: number, endHour: number): string {
  if (startHour === 0 && endHour === 23) return ''
  const h = `EXTRACT(HOUR FROM la.datainicialdaocupacao)::int`
  if (startHour <= endHour) {
    return `AND ${h} >= ${startHour} AND ${h} <= ${endHour}`
  }
  // Wrap-around (ex: 22h até 06h, passa da meia-noite)
  return `AND (${h} >= ${startHour} OR ${h} <= ${endHour})`
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
  total_suites: string
}

async function queryBigNumbers(
  pool: ReturnType<typeof getAutomPool>,
  catIds: string,
  isoStart: string,
  isoEnd: string,          // exclusive upper bound (D+1 midnight)
  daysDiff: number,
  timeFilter = '',
) {
  if (!pool) throw new Error('pool is null')

  const sql = `
    WITH receita_consumo AS (
      SELECT
        la.id_apartamentostate AS id_locacao,
        COALESCE(SUM(
          CAST(sei.precovenda AS DECIMAL(15,4)) * CAST(sei.quantidade AS DECIMAL(15,4))
        ), 0) AS valor_consumo_bruto
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a       ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca_apt ON a.id_categoriaapartamento = ca_apt.id
      INNER JOIN vendalocacao vl     ON la.id_apartamentostate = vl.id_locacaoapartamento
      INNER JOIN saidaestoque se     ON vl.id_saidaestoque = se.id
      INNER JOIN saidaestoqueitem sei ON se.id = sei.id_saidaestoque
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND sei.cancelado IS NULL
        AND ca_apt.id IN (${catIds})
        ${timeFilter}
      GROUP BY la.id_apartamentostate
    ),
    sale_direct AS (
      SELECT COALESCE(SUM(
        (CAST(sei.precovenda AS DECIMAL(15,4)) * CAST(sei.quantidade AS DECIMAL(15,4))) -
        COALESCE(
          CAST(v.desconto AS DECIMAL(15,4)) /
          NULLIF((
            SELECT COUNT(*) FROM saidaestoqueitem sei2
            WHERE sei2.id_saidaestoque = se.id AND sei2.cancelado IS NULL
          ), 0),
          0
        )
      ), 0) AS total_sale_direct
      FROM saidaestoque se
      INNER JOIN vendadireta vd      ON se.id = vd.id_saidaestoque
      INNER JOIN saidaestoqueitem sei ON se.id = sei.id_saidaestoque
      LEFT JOIN  venda v              ON se.id = v.id_saidaestoque
      WHERE vd.venda_completa = true
        AND sei.cancelado IS NULL
        AND sei.datasaidaitem >= $1
        AND sei.datasaidaitem <  $2
    ),
    suites AS (
      SELECT COUNT(*) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${catIds}) AND a.dataexclusao IS NULL
    )
    SELECT
      COUNT(*)                    AS total_rentals,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotalpermanencia   AS DECIMAL(15,4)), 0) +
        COALESCE(CAST(la.valortotalocupadicional AS DECIMAL(15,4)), 0) +
        COALESCE(rc.valor_consumo_bruto,                             0) -
        COALESCE(CAST(la.desconto                AS DECIMAL(15,4)), 0)
      ), 0)                       AS total_all_value,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)
      ), 0)                       AS total_occupied_time,
      (SELECT total_sale_direct FROM sale_direct) AS total_sale_direct,
      (SELECT total_suites      FROM suites)      AS total_suites
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    LEFT JOIN  receita_consumo rc   ON la.id_apartamentostate = rc.id_locacao
    WHERE la.datainicialdaocupacao >= $1
      AND la.datainicialdaocupacao <  $2
      AND la.fimocupacaotipo = 'FINALIZADA'
      AND ca.id IN (${catIds})
      ${timeFilter}
  `

  const { rows } = await pool.query<BigNumbersRow>(sql, [isoStart, isoEnd])
  const r = rows[0]

  const totalSuites    = Number(r.total_suites)    || 1
  const totalRentals   = Number(r.total_rentals)   || 0
  const locacaoValue   = Number(r.total_all_value)  || 0
  const saleDirect     = Number(r.total_sale_direct) || 0
  const totalAllValue  = +(locacaoValue + saleDirect).toFixed(2)
  const occupiedTime   = Number(r.total_occupied_time) || 0

  const avgTicket = totalRentals > 0 ? +(totalAllValue / totalRentals).toFixed(2) : 0
  const giro      = +(totalRentals / totalSuites / daysDiff).toFixed(2)
  const trevpar   = +(totalAllValue / totalSuites / daysDiff).toFixed(2)
  const avgOccTime = totalRentals > 0 ? secondsToHMS(occupiedTime / totalRentals) : '00:00:00'

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
  total_suites: string
}

async function queryDataTableSuiteCategory(
  pool: NonNullable<ReturnType<typeof getAutomPool>>,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  daysDiff: number,
  timeFilter = '',
): Promise<DataTableSuiteCategory[]> {
  const sql = `
    WITH receita_consumo AS (
      SELECT
        la.id_apartamentostate AS id_locacao,
        COALESCE(SUM(
          CAST(sei.precovenda AS DECIMAL(15,4)) * CAST(sei.quantidade AS DECIMAL(15,4))
        ), 0) AS valor_consumo_bruto
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca_apt ON a.id_categoriaapartamento = ca_apt.id
      INNER JOIN vendalocacao vl      ON la.id_apartamentostate = vl.id_locacaoapartamento
      INNER JOIN saidaestoque se      ON vl.id_saidaestoque = se.id
      INNER JOIN saidaestoqueitem sei ON se.id = sei.id_saidaestoque
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND sei.cancelado IS NULL
        AND ca_apt.id IN (${catIds})
        ${timeFilter}
      GROUP BY la.id_apartamentostate
    ),
    suites_por_cat AS (
      SELECT ca.descricao AS descricao, COUNT(*) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${catIds}) AND a.dataexclusao IS NULL
      GROUP BY ca.descricao
    )
    SELECT
      ca.descricao                       AS category,
      COUNT(*)                           AS total_rentals,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotalpermanencia   AS DECIMAL(15,4)), 0) +
        COALESCE(CAST(la.valortotalocupadicional AS DECIMAL(15,4)), 0) +
        COALESCE(rc.valor_consumo_bruto,                             0) -
        COALESCE(CAST(la.desconto                AS DECIMAL(15,4)), 0)
      ), 0)                              AS total_value,
      COALESCE(SUM(
        COALESCE(CAST(la.valorliquidolocacao     AS DECIMAL(15,4)), 0)
      ), 0)                              AS rental_revenue,
      COALESCE(SUM(
        COALESCE(CAST(la.valortotalpermanencia   AS DECIMAL(15,4)), 0) +
        COALESCE(CAST(la.valortotalocupadicional AS DECIMAL(15,4)), 0) +
        COALESCE(rc.valor_consumo_bruto,                             0) -
        COALESCE(CAST(la.desconto                AS DECIMAL(15,4)), 0) +
        COALESCE(CAST(la.gorjeta                 AS DECIMAL(15,4)), 0)
      ), 0)                              AS trevpar_revenue,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)
      ), 0)                              AS total_occupied_time,
      sc.total_suites
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    LEFT JOIN  receita_consumo rc   ON la.id_apartamentostate = rc.id_locacao
    INNER JOIN suites_por_cat sc    ON ca.descricao = sc.descricao
    WHERE la.datainicialdaocupacao >= $1
      AND la.datainicialdaocupacao <  $2
      AND la.fimocupacaotipo = 'FINALIZADA'
      AND ca.id IN (${catIds})
      ${timeFilter}
    GROUP BY ca.descricao, sc.total_suites
    ORDER BY total_value DESC
  `

  const { rows } = await pool.query<SuiteCatRow>(sql, [isoStart, isoEnd])

  return rows.map((r) => {
    const totalRentals    = Number(r.total_rentals)    || 0
    const totalValue      = Number(r.total_value)       || 0
    const rentalRevenue   = Number(r.rental_revenue)    || 0
    const trevparRevenue  = Number(r.trevpar_revenue)   || 0
    const occupiedTime    = Number(r.total_occupied_time) || 0
    const suitesInCat     = Number(r.total_suites)      || 1

    const ticketAverage   = totalRentals > 0 ? +(totalValue / totalRentals).toFixed(2) : 0
    const giro            = +(totalRentals / suitesInCat / daysDiff).toFixed(2)
    const revpar          = +(rentalRevenue / suitesInCat / daysDiff).toFixed(2)
    const trevpar         = +(trevparRevenue / suitesInCat / daysDiff).toFixed(2)
    const availableTime   = suitesInCat * daysDiff * 86_400
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
  total_suites:       string
  dow_occurrences:    string
  total_rentals_dow:  string
  total_revenue_dow:  string
  all_suites:         string
}

async function queryWeekTables(
  pool: NonNullable<ReturnType<typeof getAutomPool>>,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  timeFilter = '',
): Promise<{ giro: DataTableGiroByWeek[]; revpar: DataTableRevparByWeek[] }> {
  // CROSS JOIN entre categorias ativas × todos os DOW do período.
  // LEFT JOIN nos dados reais → dias sem locação aparecem com 0 (comportamento original).
  const sql = `
    WITH categories_in_period AS (
      -- Apenas categorias que tiveram ao menos 1 locação no período
      SELECT DISTINCT ca.descricao AS category
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
        ${timeFilter}
    ),
    dow_occurrences AS (
      -- Quantidade de ocorrências de cada dia da semana no período
      SELECT
        EXTRACT(DOW FROM gs::date) AS dow,
        COUNT(*) AS n
      FROM generate_series($1::date, $2::date - INTERVAL '1 day', '1 day'::interval) gs
      GROUP BY EXTRACT(DOW FROM gs::date)
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
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
        ${timeFilter}
      GROUP BY ca.descricao, dow
    ),
    suites_por_cat AS (
      SELECT ca.descricao AS descricao, COUNT(*) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${catIds}) AND a.dataexclusao IS NULL
      GROUP BY ca.descricao
    ),
    all_suites AS (SELECT COALESCE(SUM(total_suites), 1) AS n FROM suites_por_cat),
    totals_by_dow AS (
      SELECT
        dow,
        SUM(total_rentals)  AS total_rentals,
        SUM(rental_revenue) AS rental_revenue
      FROM rentals_cat_dow
      GROUP BY dow
    )
    -- CROSS JOIN: toda categoria × todo DOW do período, LEFT JOIN nos dados reais
    SELECT
      c.category,
      occ.dow::int                          AS dow,
      COALESCE(r.total_rentals,  0)         AS total_rentals,
      COALESCE(r.rental_revenue, 0)         AS rental_revenue,
      COALESCE(sc.total_suites,  1)         AS total_suites,
      occ.n                                 AS dow_occurrences,
      COALESCE(td.total_rentals,  0)        AS total_rentals_dow,
      COALESCE(td.rental_revenue, 0)        AS total_revenue_dow,
      al.n                                  AS all_suites
    FROM categories_in_period c
    CROSS JOIN dow_occurrences occ
    LEFT JOIN suites_por_cat  sc ON c.category = sc.descricao
    LEFT JOIN rentals_cat_dow  r ON c.category = r.category AND occ.dow = r.dow
    LEFT JOIN totals_by_dow   td ON occ.dow = td.dow
    CROSS JOIN all_suites al
    ORDER BY c.category, occ.dow
  `

  const { rows } = await pool.query<WeekRow>(sql, [isoStart, isoEnd])

  const giroMap  = new Map<string, Record<string, { giro: number; totalGiro: number }>>()
  const revparMap = new Map<string, Record<string, { revpar: number; totalRevpar: number }>>()

  for (const r of rows) {
    const dow        = Number(r.dow)
    const dayName    = DOW_TO_PT[dow]
    if (!dayName) continue

    const catRentals  = Number(r.total_rentals)     || 0
    const catRevenue  = Number(r.rental_revenue)    || 0
    const suitesInCat = Number(r.total_suites)      || 1
    const occurrences = Number(r.dow_occurrences)   || 1
    const totRentals  = Number(r.total_rentals_dow) || 0
    const totRevenue  = Number(r.total_revenue_dow) || 0
    const allSuites   = Number(r.all_suites)        || 1

    const giro       = +(catRentals  / suitesInCat / occurrences).toFixed(2)
    const totalGiro  = +(totRentals  / allSuites   / occurrences).toFixed(2)
    const revpar     = +(catRevenue  / suitesInCat / occurrences).toFixed(2)
    const totalRevpar = +(totRevenue / allSuites   / occurrences).toFixed(2)

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
  total_suites:       string
}

async function queryTotalRevOcc(
  pool: NonNullable<ReturnType<typeof getAutomPool>>,
  catIds: string,
  isoStart: string,
  isoEnd: string,
  daysDiff: number,
  timeFilter = '',
): Promise<{ totalRevpar: number; totalOccupancyRate: number }> {
  const sql = `
    SELECT
      COALESCE(SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))), 0) AS rental_revenue,
      COALESCE(SUM(EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)), 0) AS total_occupied_time,
      (SELECT COUNT(*) FROM apartamento a2
       INNER JOIN categoriaapartamento ca2 ON a2.id_categoriaapartamento = ca2.id
       WHERE ca2.id IN (${catIds}) AND a2.dataexclusao IS NULL) AS total_suites
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE la.datainicialdaocupacao >= $1
      AND la.datainicialdaocupacao <  $2
      AND la.fimocupacaotipo = 'FINALIZADA'
      AND ca.id IN (${catIds})
      ${timeFilter}
  `

  const { rows } = await pool.query<TotalRevOccRow>(sql, [isoStart, isoEnd])
  const r = rows[0]
  const rentalRevenue  = Number(r.rental_revenue)      || 0
  const occupiedTime   = Number(r.total_occupied_time)  || 0
  const totalSuites    = Number(r.total_suites)          || 1

  const totalRevpar      = +(rentalRevenue / totalSuites / daysDiff).toFixed(2)
  const availableTime    = totalSuites * daysDiff * 86_400
  const totalOccupancyRate = availableTime > 0 ? +((occupiedTime / availableTime) * 100).toFixed(2) : 0

  return { totalRevpar, totalOccupancyRate }
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
): Promise<CompanyKPIResponse> {
  const pool = getAutomPool(unitSlug)
  if (!pool) throw new Error(`Automo pool indisponível para ${unitSlug}`)

  const catIds = (UNIT_CATEGORY_IDS[unitSlug] ?? []).join(',')
  if (!catIds) throw new Error(`Nenhum category ID configurado para ${unitSlug}`)

  // Período atual
  const isoStart  = ddmmyyyyToIso(startDateDDMMYYYY)
  const isoEnd    = addDays(ddmmyyyyToIso(endDateDDMMYYYY), 1) // exclusive upper bound
  const daysDiff  = daysBetween(isoStart, isoEnd)

  // Período anterior (mesmo período do ano passado)
  const prevIsoStart = isoStart.replace(/^(\d{4})/, (y) => String(Number(y) - 1))
  const prevIsoEnd   = isoEnd.replace(/^(\d{4})/, (y) => String(Number(y) - 1))

  // Dados do mês atual até ontem (para previsão de fechamento)
  const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const monthStart = new Date(nowBR.getFullYear(), nowBR.getMonth(), 1)
  const yesterday  = new Date(nowBR.getFullYear(), nowBR.getMonth(), nowBR.getDate() - 1)
  const monIsoStart = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
  const monIsoEnd   = addDays(
    `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')} 00:00:00`,
    1
  )
  const daysElapsed = yesterday.getDate()
  const totalDaysInMonth = new Date(nowBR.getFullYear(), nowBR.getMonth() + 1, 0).getDate()
  const remainingDays = totalDaysInMonth - daysElapsed

  // Filtro de hora (aplicado a todas as queries de locação)
  const timeFilter = buildTimeFilter(startHour, endHour)

  // Executa queries em paralelo — cada uma loga o próprio erro para diagnóstico
  const tag = `[KPIs/${unitSlug}]`

  function tagError(query: string) {
    return (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e))
      console.error(`${tag} Query falhou [${query}]:`, err.message)
      throw err
    }
  }

  const [currentBN, prevBN, monthBN, revOcc, suiteCatTable, weekTables] = await Promise.all([
    queryBigNumbers(pool, catIds, isoStart,    isoEnd,    daysDiff,       timeFilter).catch(tagError('BigNumbers/current')),
    queryBigNumbers(pool, catIds, prevIsoStart, prevIsoEnd, daysDiff,     timeFilter).catch(tagError('BigNumbers/prev')),
    queryBigNumbers(pool, catIds, monIsoStart,  monIsoEnd,  daysElapsed || 1, timeFilter).catch(tagError('BigNumbers/month')),
    queryTotalRevOcc(pool, catIds, isoStart, isoEnd, daysDiff,            timeFilter).catch(tagError('TotalRevOcc')),
    queryDataTableSuiteCategory(pool, catIds, isoStart, isoEnd, daysDiff, timeFilter).catch(tagError('DataTableSuiteCategory')),
    queryWeekTables(pool, catIds, isoStart, isoEnd,                        timeFilter).catch(tagError('WeekTables')),
  ])

  // Previsão de fechamento do mês
  const safeElapsed = daysElapsed > 0 ? daysElapsed : 1
  const dailyAvgValue   = monthBN.totalAllValue   / safeElapsed
  const dailyAvgRentals = monthBN.totalRentals     / safeElapsed
  const forecastValue   = monthBN.totalAllValue   + dailyAvgValue   * remainingDays
  const forecastRentals = monthBN.totalRentals     + dailyAvgRentals * remainingDays

  const monthlyForecast: CompanyBigNumbers['monthlyForecast'] = {
    totalAllValueForecast:              +forecastValue.toFixed(2),
    totalAllRentalsApartmentsForecast:  Math.round(forecastRentals),
    totalAllTicketAverageForecast:      forecastRentals > 0 ? +(forecastValue / forecastRentals).toFixed(2) : 0,
    totalAllTrevparForecast:            currentBN.totalSuites > 0 ? +(forecastValue / currentBN.totalSuites / totalDaysInMonth).toFixed(2) : 0,
    totalAllGiroForecast:               currentBN.totalSuites > 0 ? +(forecastRentals / currentBN.totalSuites / totalDaysInMonth).toFixed(2) : 0,
    totalAverageOccupationTimeForecast: monthBN.avgOccTime,
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
      totalAllGiroPreviousData:               prevBN.giro,
      totalAverageOccupationTimePreviousData: prevBN.avgOccTime,
    },
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
    // Chart series não renderizadas no dashboard atual — arrays vazios
    BillingRentalType:          [],
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
