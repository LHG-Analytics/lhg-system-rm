import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'
import { isValidIsoDate, resolvePreset } from '@/lib/date-range'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type HeatmapMetric   = 'giro' | 'ocupacao' | 'revpar' | 'trevpar'
export type HeatmapDateType = 'all' | 'checkin' | 'checkout'

export interface HeatmapCategory {
  id: number
  nome: string
}

export interface HeatmapCell {
  day_name: string
  hour_of_day: number
  value: number
}

export interface HeatmapResponse {
  rows: HeatmapCell[]
  metric: HeatmapMetric
  dateType: HeatmapDateType
  categories: HeatmapCategory[]
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

/** CASE expression que mapeia DOW de um timestamp para nome do dia */
function dowCase(col: string) {
  return `CASE EXTRACT(DOW FROM
      CASE WHEN EXTRACT(HOUR FROM ${col}) < 6
        THEN ${col} - INTERVAL '1 day'
        ELSE ${col}
      END
    )
      WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
      WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
      WHEN 6 THEN 'Sabado'
    END`
}

/** ORDER BY para dia da semana — requer alias qualificado para evitar ambiguidade */
function orderDay(alias: string) {
  return `CASE ${alias}.day_name
  WHEN 'Segunda' THEN 1 WHEN 'Terca' THEN 2 WHEN 'Quarta' THEN 3
  WHEN 'Quinta'  THEN 4 WHEN 'Sexta' THEN 5 WHEN 'Sabado' THEN 6
  WHEN 'Domingo' THEN 7
END`
}

function giroEventsSelect(
  col: string, idList: string,
  startDate: string, endDate: string,
  extraWhere = '',
) {
  return `
    SELECT
      ca.id  AS category_id,
      cs.suites,
      ${dowCase(col)} AS day_name,
      EXTRACT(HOUR FROM ${col})::INT AS hour_of_day,
      COUNT(*) AS rentals
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    INNER JOIN category_suites cs ON ca.id = cs.id
    WHERE ${col} >= '${startDate}'::date
      AND ${col} <  ('${endDate}'::date + INTERVAL '1 day')
      AND la.fimocupacaotipo = 'FINALIZADA'
      ${extraWhere}
      AND ca.id IN (${idList})
    GROUP BY ca.id, cs.suites, day_name, hour_of_day`
}

function buildGiroQuery(idList: string, dateType: HeatmapDateType, startDate: string, endDate: string): string {
  const checkinSel  = giroEventsSelect('la.datainicialdaocupacao', idList, startDate, endDate)
  const checkoutSel = giroEventsSelect(
    'la.datafinaldaocupacao', idList, startDate, endDate,
    'AND la.datafinaldaocupacao IS NOT NULL'
  )

  const eventsCTE =
    dateType === 'checkin'  ? checkinSel  :
    dateType === 'checkout' ? checkoutSel :
    `${checkinSel}\n        UNION ALL\n${checkoutSel}`

  return `
    WITH date_occurrences AS (
      SELECT
        CASE EXTRACT(DOW FROM d::date)
          WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
          WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sabado'
        END AS day_name,
        COUNT(*) AS n_days
      FROM generate_series('${startDate}'::date, '${endDate}'::date, '1 day'::interval) AS d
      GROUP BY day_name
    ),
    category_suites AS (
      SELECT ca.id, COUNT(a.id) AS suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
      GROUP BY ca.id
    ),
    events AS (${eventsCTE}
    )
    SELECT
      e.day_name,
      e.hour_of_day,
      ROUND(SUM(e.rentals::DECIMAL / e.suites) / dc.n_days, 2)::float AS value
    FROM events e
    JOIN date_occurrences dc ON dc.day_name = e.day_name
    GROUP BY e.day_name, e.hour_of_day, dc.n_days
    ORDER BY ${orderDay('e')}, e.hour_of_day`
}

function buildOcupacaoQuery(idList: string, dateType: HeatmapDateType, startDate: string, endDate: string): string {
  // Filtra locações pelo campo de referência conforme dateType
  const dateFilter =
    dateType === 'checkout'
      ? `la.datafinaldaocupacao >= '${startDate}'::date AND la.datafinaldaocupacao < ('${endDate}'::date + INTERVAL '1 day')`
      : `la.datainicialdaocupacao >= '${startDate}'::date AND la.datainicialdaocupacao < ('${endDate}'::date + INTERVAL '1 day')`

  return `
    WITH date_occurrences AS (
      SELECT
        CASE EXTRACT(DOW FROM d::date)
          WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
          WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sabado'
        END AS day_name,
        COUNT(*) AS n_days
      FROM generate_series('${startDate}'::date, '${endDate}'::date, '1 day'::interval) AS d
      GROUP BY day_name
    ),
    capacity AS (
      SELECT COUNT(*) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
    ),
    occupied_hours AS (
      -- Expande cada locação pelos slots de 1h que ela ocupa (checkin até checkout)
      -- Fórmula: suite_hours / (total_suites × n_dias_da_semana) × 100
      SELECT
        ${dowCase('h_ts')} AS day_name,
        EXTRACT(HOUR FROM h_ts)::INT AS hour_of_day,
        COUNT(*) AS suite_hours
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      CROSS JOIN LATERAL generate_series(
        date_trunc('hour', la.datainicialdaocupacao),
        date_trunc('hour', la.datafinaldaocupacao),
        '1 hour'::interval
      ) AS h_ts
      WHERE ${dateFilter}
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND la.datafinaldaocupacao IS NOT NULL
        AND ca.id IN (${idList})
      GROUP BY day_name, hour_of_day
    )
    SELECT
      oh.day_name,
      oh.hour_of_day,
      ROUND((oh.suite_hours::DECIMAL / (c.total_suites * dc.n_days)) * 100, 2)::float AS value
    FROM occupied_hours oh
    JOIN date_occurrences dc ON dc.day_name = oh.day_name
    CROSS JOIN capacity c
    ORDER BY ${orderDay('oh')}, oh.hour_of_day`
}

// ─── RevPAR por hora × dia ────────────────────────────────────────────────────
// RevPAR = receita de locações / total de suítes disponíveis (por dia da semana)

function buildRevparQuery(idList: string, startDate: string, endDate: string): string {
  return `
    WITH date_occurrences AS (
      SELECT
        CASE EXTRACT(DOW FROM d::date)
          WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
          WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sabado'
        END AS day_name,
        COUNT(*) AS n_days
      FROM generate_series('${startDate}'::date, '${endDate}'::date, '1 day'::interval) AS d
      GROUP BY day_name
    ),
    category_suites AS (
      SELECT COUNT(a.id) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
    ),
    revenue_hours AS (
      SELECT
        ${dowCase('la.datainicialdaocupacao')} AS day_name,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)::INT AS hour_of_day,
        SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))) AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= '${startDate}'::date
        AND la.datainicialdaocupacao <  ('${endDate}'::date + INTERVAL '1 day')
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${idList})
      GROUP BY day_name, hour_of_day
    )
    SELECT
      rh.day_name,
      rh.hour_of_day,
      ROUND((rh.receita / (cs.total_suites * dc.n_days)), 2)::float AS value
    FROM revenue_hours rh
    JOIN date_occurrences dc ON dc.day_name = rh.day_name
    CROSS JOIN category_suites cs
    ORDER BY ${orderDay('rh')}, rh.hour_of_day`
}

// ─── TRevPAR por hora × dia ───────────────────────────────────────────────────
// TRevPAR = (receita de locações + receita A&B vinculada) / total de suítes

function buildTrevparQuery(idList: string, startDate: string, endDate: string): string {
  return `
    WITH date_occurrences AS (
      SELECT
        CASE EXTRACT(DOW FROM d::date)
          WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
          WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sabado'
        END AS day_name,
        COUNT(*) AS n_days
      FROM generate_series('${startDate}'::date, '${endDate}'::date, '1 day'::interval) AS d
      GROUP BY day_name
    ),
    category_suites AS (
      SELECT COUNT(a.id) AS total_suites
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
    ),
    ab_por_locacao AS (
      -- Consumo A&B vinculado à locação via vendalocacao → saidaestoque → saidaestoqueitem
      SELECT
        vl.id_locacaoapartamento,
        COALESCE(SUM(
          CAST(sei.precovenda AS DECIMAL(15,4)) * CAST(sei.quantidade AS DECIMAL(15,4))
        ), 0) AS receita_ab
      FROM vendalocacao vl
      INNER JOIN saidaestoque     se  ON se.id  = vl.id_saidaestoque
      INNER JOIN saidaestoqueitem sei ON sei.id_saidaestoque = se.id
      WHERE sei.cancelado IS NULL
      GROUP BY vl.id_locacaoapartamento
    ),
    revenue_hours AS (
      SELECT
        ${dowCase('la.datainicialdaocupacao')} AS day_name,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)::INT AS hour_of_day,
        SUM(
          COALESCE(CAST(la.valortotalpermanencia   AS DECIMAL(15,4)), 0) +
          COALESCE(CAST(la.valortotalocupadicional AS DECIMAL(15,4)), 0) +
          COALESCE(ab.receita_ab, 0) -
          COALESCE(CAST(la.desconto                AS DECIMAL(15,4)), 0)
        ) AS receita_total
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      LEFT JOIN ab_por_locacao ab ON ab.id_locacaoapartamento = la.id
      WHERE la.datainicialdaocupacao >= '${startDate}'::date
        AND la.datainicialdaocupacao <  ('${endDate}'::date + INTERVAL '1 day')
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${idList})
      GROUP BY day_name, hour_of_day
    )
    SELECT
      rh.day_name,
      rh.hour_of_day,
      ROUND((rh.receita_total / (cs.total_suites * dc.n_days)), 2)::float AS value
    FROM revenue_hours rh
    JOIN date_occurrences dc ON dc.day_name = rh.day_name
    CROSS JOIN category_suites cs
    ORDER BY ${orderDay('rh')}, rh.hour_of_day`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const sp         = req.nextUrl.searchParams
  const unitSlug   = sp.get('unitSlug')
  const metric     = (sp.get('metric')   ?? 'giro') as HeatmapMetric
  const dateType   = (sp.get('dateType') ?? 'all')  as HeatmapDateType
  const categoryId = sp.get('categoryId')

  // Date range: accept explicit ISO dates or fall back to last 7 days
  const rawStart = sp.get('startDate')
  const rawEnd   = sp.get('endDate')
  const range    = (rawStart && rawEnd && isValidIsoDate(rawStart) && isValidIsoDate(rawEnd))
    ? { startDate: rawStart, endDate: rawEnd }
    : resolvePreset('7d')

  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  // Auth + unit check
  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, slug, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return new Response('Perfil não encontrado', { status: 403 })
  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const pool = getAutomPool(unitSlug)
  if (!pool) {
    return Response.json(
      { error: `Conexão Automo não configurada para ${unitSlug}.` },
      { status: 422 }
    )
  }

  const allCategoryIds = UNIT_CATEGORY_IDS[unitSlug]
  if (!allCategoryIds?.length) {
    return Response.json({ error: 'IDs de categoria não configurados.' }, { status: 422 })
  }

  const selectedIds = categoryId
    ? allCategoryIds.filter((id) => id === parseInt(categoryId, 10))
    : allCategoryIds

  if (!selectedIds.length) {
    return Response.json({ error: 'Categoria inválida para esta unidade.' }, { status: 400 })
  }

  const idList    = selectedIds.join(',')
  const allIdList = allCategoryIds.join(',')
  const { startDate, endDate } = range

  try {
    const catResult = await pool.query<{ id: number; nome: string }>(`
      SELECT ca.id, ca.descricao AS nome
      FROM categoriaapartamento ca
      WHERE ca.id IN (${allIdList})
      ORDER BY ca.descricao
    `)
    const categories: HeatmapCategory[] = catResult.rows

    const sql =
      metric === 'giro'     ? buildGiroQuery(idList, dateType, startDate, endDate) :
      metric === 'ocupacao' ? buildOcupacaoQuery(idList, dateType, startDate, endDate) :
      metric === 'revpar'   ? buildRevparQuery(idList, startDate, endDate) :
      buildTrevparQuery(idList, startDate, endDate)

    const result = await pool.query<HeatmapCell>(sql)

    return Response.json({ rows: result.rows, metric, dateType, categories } satisfies HeatmapResponse)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[heatmap] Erro Automo (${unitSlug}):`, msg)
    return Response.json(
      { error: `Erro ao conectar com o banco Automo: ${msg}` },
      { status: 500 }
    )
  }
}
