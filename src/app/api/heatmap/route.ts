import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, getUnitCategoryIds, getUnitPeriodType } from '@/lib/automo/client'
import {
  cteBaseSuiteDays,
  cteSuiteDaysTotal,
  cteSuiteDaysByCategoryDow,
  cteSuiteDaysByDow,
} from '@/lib/automo/suite-days'
import { getValidPeriodsForType, buildPeriodoFilterSQL } from '@/lib/automo/period-helpers'
import { resolveOperationalRange, opTs } from '@/lib/automo/operational-day'
import { isValidIsoDate, resolvePreset } from '@/lib/date-range'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type HeatmapMetric   = 'giro' | 'locacoes' | 'ocupacao' | 'revpar' | 'trevpar' | 'receita'
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
  periodos: string[]
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

/** CASE expression que mapeia DOW de um timestamp (já ajustado ao dia operacional) para nome do dia */
function dowCase(col: string) {
  return `CASE EXTRACT(DOW FROM ${col})
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
  isoStart: string, isoEnd: string,
  extraWhere = '',
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
  periodoFilter = '',
) {
  return `
    SELECT
      ca.id  AS category_id,
      ${dowCase(opTs(col))} AS day_name,
      EXTRACT(DOW FROM ${opTs(col)})::int AS dow,
      EXTRACT(HOUR FROM ${col})::INT AS hour_of_day,
      COUNT(*) AS rentals
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE ${col} >= '${isoStart}'
      AND ${col} <= '${isoEnd}'
      ${statusFilter}
      ${extraWhere}
      ${periodoFilter}
      AND ca.id IN (${idList})
    GROUP BY ca.id, day_name, dow, hour_of_day`
}

function buildGiroQuery(idList: string, dateType: HeatmapDateType, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  const checkinSel  = giroEventsSelect('la.datainicialdaocupacao', idList, isoStart, isoEnd, '', statusFilter, periodoFilter)
  const checkoutSel = giroEventsSelect(
    'la.datafinaldaocupacao', idList, isoStart, isoEnd,
    'AND la.datafinaldaocupacao IS NOT NULL', statusFilter, periodoFilter
  )

  const eventsCTE =
    dateType === 'checkin'  ? checkinSel  :
    dateType === 'checkout' ? checkoutSel :
    `${checkinSel}\n        UNION ALL\n${checkoutSel}`

  // Denominador: suite_dias_cat_dow (suítes-dia daquela categoria nesse DOW, descontando bloqueios)
  return `
    WITH ${cteBaseSuiteDays(idList, `'${isoStart}'`, `'${isoEnd}'`)},
    ${cteSuiteDaysByCategoryDow()},
    events AS (${eventsCTE}
    )
    SELECT
      e.day_name,
      e.hour_of_day,
      ROUND(SUM(e.rentals::DECIMAL / scd.suite_dias), 2)::float AS value
    FROM events e
    JOIN suite_dias_cat_dow scd ON scd.id_categoria = e.category_id AND scd.dow = e.dow
    GROUP BY e.day_name, e.hour_of_day
    ORDER BY ${orderDay('e')}, e.hour_of_day`
}

// ─── Locações (contagem crua) por hora × dia ──────────────────────────────────
// Número absoluto de locações no slot — sem denominador de suítes-dia.
function buildLocacoesQuery(idList: string, dateType: HeatmapDateType, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  const checkinSel  = giroEventsSelect('la.datainicialdaocupacao', idList, isoStart, isoEnd, '', statusFilter, periodoFilter)
  const checkoutSel = giroEventsSelect(
    'la.datafinaldaocupacao', idList, isoStart, isoEnd,
    'AND la.datafinaldaocupacao IS NOT NULL', statusFilter, periodoFilter
  )

  const eventsCTE =
    dateType === 'checkin'  ? checkinSel  :
    dateType === 'checkout' ? checkoutSel :
    `${checkinSel}\n        UNION ALL\n${checkoutSel}`

  return `
    WITH events AS (${eventsCTE}
    )
    SELECT
      e.day_name,
      e.hour_of_day,
      SUM(e.rentals)::float AS value
    FROM events e
    GROUP BY e.day_name, e.hour_of_day
    ORDER BY ${orderDay('e')}, e.hour_of_day`
}

function buildOcupacaoQuery(idList: string, dateType: HeatmapDateType, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  // Filtra locações pelo campo de referência conforme dateType
  const dateFilter =
    dateType === 'checkout'
      ? `la.datafinaldaocupacao >= '${isoStart}' AND la.datafinaldaocupacao <= '${isoEnd}'`
      : `la.datainicialdaocupacao >= '${isoStart}' AND la.datainicialdaocupacao <= '${isoEnd}'`

  // Denominador: suite_dias_total_dow (suítes-dia totais do DOW, descontando bloqueios)
  return `
    WITH ${cteBaseSuiteDays(idList, `'${isoStart}'`, `'${isoEnd}'`)},
    ${cteSuiteDaysByDow()},
    occupied_hours AS (
      SELECT
        ${dowCase(opTs('h_ts'))} AS day_name,
        EXTRACT(DOW FROM ${opTs('h_ts')})::int AS dow,
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
        ${statusFilter}
        ${periodoFilter}
        AND la.datafinaldaocupacao IS NOT NULL
        AND ca.id IN (${idList})
      GROUP BY day_name, dow, hour_of_day
    )
    SELECT
      oh.day_name,
      oh.hour_of_day,
      ROUND((oh.suite_hours::DECIMAL / sdtd.suite_dias) * 100, 2)::float AS value
    FROM occupied_hours oh
    JOIN suite_dias_total_dow sdtd ON sdtd.dow = oh.dow
    ORDER BY ${orderDay('oh')}, oh.hour_of_day`
}

// ─── RevPAR por hora × dia ────────────────────────────────────────────────────
// RevPAR = receita de locações / total de suítes disponíveis (por dia da semana)

function buildRevparQuery(idList: string, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  return `
    WITH ${cteBaseSuiteDays(idList, `'${isoStart}'`, `'${isoEnd}'`)},
    ${cteSuiteDaysByDow()},
    revenue_hours AS (
      SELECT
        ${dowCase(opTs('la.datainicialdaocupacao'))} AS day_name,
        EXTRACT(DOW FROM ${opTs('la.datainicialdaocupacao')})::int AS dow,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)::INT AS hour_of_day,
        SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))) AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= '${isoStart}'
        AND la.datainicialdaocupacao <= '${isoEnd}'
        ${statusFilter}
        ${periodoFilter}
        AND ca.id IN (${idList})
      GROUP BY day_name, dow, hour_of_day
    )
    SELECT
      rh.day_name,
      rh.hour_of_day,
      ROUND((rh.receita / sdtd.suite_dias), 2)::float AS value
    FROM revenue_hours rh
    JOIN suite_dias_total_dow sdtd ON sdtd.dow = rh.dow
    ORDER BY ${orderDay('rh')}, rh.hour_of_day`
}

// ─── TRevPAR por hora × dia ───────────────────────────────────────────────────
// TRevPAR = (receita de locações + receita A&B vinculada) / total de suítes

function buildTrevparQuery(idList: string, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  return `
    WITH ${cteBaseSuiteDays(idList, `'${isoStart}'`, `'${isoEnd}'`)},
    ${cteSuiteDaysByDow()},
    ab_por_locacao AS (
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
        ${dowCase(opTs('la.datainicialdaocupacao'))} AS day_name,
        EXTRACT(DOW FROM ${opTs('la.datainicialdaocupacao')})::int AS dow,
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
      LEFT JOIN ab_por_locacao ab ON ab.id_locacaoapartamento = la.id_apartamentostate
      WHERE la.datainicialdaocupacao >= '${isoStart}'
        AND la.datainicialdaocupacao <= '${isoEnd}'
        ${statusFilter}
        ${periodoFilter}
        AND ca.id IN (${idList})
      GROUP BY day_name, dow, hour_of_day
    )
    SELECT
      rh.day_name,
      rh.hour_of_day,
      ROUND((rh.receita_total / sdtd.suite_dias), 2)::float AS value
    FROM revenue_hours rh
    JOIN suite_dias_total_dow sdtd ON sdtd.dow = rh.dow
    ORDER BY ${orderDay('rh')}, rh.hour_of_day`
}

// ─── Receita (soma bruta) por hora × dia ──────────────────────────────────────
// Diferente de RevPAR/TRevPAR: não normaliza por suítes-dia — é a soma de valortotal
// (locação + consumo - desconto), mesma definição de "Faturamento" do dashboard.

function buildReceitaQuery(idList: string, isoStart: string, isoEnd: string, statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'", periodoFilter = ''): string {
  return `
    SELECT
      ${dowCase(opTs('la.datainicialdaocupacao'))} AS day_name,
      EXTRACT(DOW  FROM ${opTs('la.datainicialdaocupacao')})::int AS dow,
      EXTRACT(HOUR FROM la.datainicialdaocupacao)::INT AS hour_of_day,
      ROUND(SUM(COALESCE(CAST(la.valortotal AS DECIMAL(15,4)), 0)), 2)::float AS value
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE la.datainicialdaocupacao >= '${isoStart}'
      AND la.datainicialdaocupacao <= '${isoEnd}'
      ${statusFilter}
      ${periodoFilter}
      AND ca.id IN (${idList})
    GROUP BY EXTRACT(DOW FROM ${opTs('la.datainicialdaocupacao')}), EXTRACT(HOUR FROM la.datainicialdaocupacao)
    ORDER BY 2, hour_of_day`
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
  const periodo    = sp.get('periodo')

  const VALID_STATUSES = ['FINALIZADA', 'TRANSFERIDA', 'CANCELADA', 'ABERTA', 'TODAS'] as const
  type HeatmapStatus = typeof VALID_STATUSES[number]
  const rawStatus = sp.get('status') ?? 'FINALIZADA'
  const rentalStatus: HeatmapStatus = VALID_STATUSES.includes(rawStatus as HeatmapStatus)
    ? (rawStatus as HeatmapStatus) : 'FINALIZADA'
  const statusFilter = rentalStatus === 'TODAS'    ? '' :
                       rentalStatus === 'ABERTA'   ? 'AND la.fimocupacaotipo IS NULL' :
                       `AND la.fimocupacaotipo = '${rentalStatus}'`

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
  const hasGlobalAccess = ['super_admin', 'admin'].includes(profile.role ?? '') && !profile.unit_id
  if (!hasGlobalAccess && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const pool = await getAutomPool(unitSlug)
  if (!pool) {
    return Response.json(
      { error: `Conexão Automo não configurada para ${unitSlug}.` },
      { status: 422 }
    )
  }

  const allCategoryIds = await getUnitCategoryIds(unitSlug)
  if (!allCategoryIds.length) {
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
  const { isoStart, isoEnd } = resolveOperationalRange(startDate, endDate)

  try {
    const periodType = await getUnitPeriodType(unitSlug)
    const periodos    = getValidPeriodsForType(periodType)
    const periodoFilter = buildPeriodoFilterSQL(periodType, periodo)

    const catResult = await pool.query<{ id: number; nome: string }>(`
      SELECT ca.id, ca.descricao AS nome
      FROM categoriaapartamento ca
      WHERE ca.id IN (${allIdList})
      ORDER BY ca.descricao
    `)
    const categories: HeatmapCategory[] = catResult.rows

    const sql =
      metric === 'giro'     ? buildGiroQuery(idList, dateType, isoStart, isoEnd, statusFilter, periodoFilter) :
      metric === 'locacoes' ? buildLocacoesQuery(idList, dateType, isoStart, isoEnd, statusFilter, periodoFilter) :
      metric === 'ocupacao' ? buildOcupacaoQuery(idList, dateType, isoStart, isoEnd, statusFilter, periodoFilter) :
      metric === 'revpar'   ? buildRevparQuery(idList, isoStart, isoEnd, statusFilter, periodoFilter) :
      metric === 'receita'  ? buildReceitaQuery(idList, isoStart, isoEnd, statusFilter, periodoFilter) :
      buildTrevparQuery(idList, isoStart, isoEnd, statusFilter, periodoFilter)

    const result = await pool.query<HeatmapCell>(sql)

    return Response.json({ rows: result.rows, metric, dateType, categories, periodos } satisfies HeatmapResponse)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[heatmap] Erro Automo (${unitSlug}):`, msg)
    return Response.json(
      { error: `Erro ao conectar com o banco Automo: ${msg}` },
      { status: 500 }
    )
  }
}
