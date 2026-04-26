import { getAutomPool, UNIT_CATEGORY_IDS } from './client'
import { ddmmyyyyToIso, addDays, buildDateRangeFilter, buildStatusFilter, buildTimeFilter } from './company-kpis'
import type { ChannelKPIRow, BillingRentalTypeItem } from '@/lib/kpis/types'

// ─── Labels legíveis por tipo de canal ────────────────────────────────────────

const CANAL_LABELS: Record<string, string> = {
  INTERNAL:          'Balcão / Interno',
  GUIA_SCHEDULED:    'Guia Programado',
  GUIA_GO:           'Guia Go (imediato)',
  WEBSITE_IMMEDIATE: 'Site Imediato',
  WEBSITE_SCHEDULED: 'Site Programado',
  BOOKING:           'Booking.com',
  EXPEDIA:           'Expedia',
}

// ─── Helper de isoEnd BRT-aware (igual ao fetchCompanyKPIsFromAutomo) ─────────

function buildIsoEnd(ddmmyyyy: string): string {
  const nowBR     = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayBR   = `${String(nowBR.getDate()).padStart(2, '0')}/${String(nowBR.getMonth() + 1).padStart(2, '0')}/${nowBR.getFullYear()}`
  return ddmmyyyy === todayBR
    ? ddmmyyyyToIso(ddmmyyyy)
    : addDays(ddmmyyyyToIso(ddmmyyyy), 1)
}

// ─── Query principal ──────────────────────────────────────────────────────────

/**
 * Busca desempenho por canal de reserva (balcão, Guia Go, Guia Programado, Site, OTAs)
 * diretamente da tabela `reserva` do ERP Automo.
 *
 * Usa `dataatendimento` (data do atendimento/serviço) como eixo temporal —
 * diferente das queries de locação que usam `datainicialdaocupacao`.
 *
 * Retorna array vazio em caso de erro (não quebra o agente).
 */
export async function queryChannelKPIs(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
): Promise<ChannelKPIRow[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const sql = `
    WITH canal_classificado AS (
      SELECT
        r.id,
        CASE
          WHEN r.id_tipoorigemreserva IN (1, 6) THEN 'INTERNAL'
          WHEN r.id_tipoorigemreserva = 7        THEN 'BOOKING'
          WHEN r.id_tipoorigemreserva = 8        THEN 'EXPEDIA'
          WHEN r.id_tipoorigemreserva = 3
            AND COALESCE(r.reserva_programada_guia, false) = true  THEN 'GUIA_SCHEDULED'
          WHEN r.id_tipoorigemreserva = 3        THEN 'GUIA_GO'
          WHEN r.id_tipoorigemreserva = 4 AND (
              (r.periodocontratado = '06:00' AND EXTRACT(HOUR FROM r.datainicio) = 13)
           OR (r.periodocontratado = '16:00' AND EXTRACT(HOUR FROM r.datainicio) = 20)
           OR (r.periodocontratado = '21:00' AND EXTRACT(HOUR FROM r.datainicio) = 15)
           OR (r.periodocontratado IS NULL
               AND EXTRACT(HOUR FROM r.datainicio) IN (12, 13, 15, 18, 20)
               AND EXTRACT(MINUTE FROM r.datainicio) = 0)
          ) THEN 'WEBSITE_SCHEDULED'
          WHEN r.id_tipoorigemreserva = 4 THEN 'WEBSITE_IMMEDIATE'
          ELSE NULL
        END AS canal,
        CASE
          WHEN r.id_tipoorigemreserva = 3
            AND COALESCE(r.reserva_programada_guia, false) = false
          THEN COALESCE(r.valorcontratado, la.valortotalpermanencia) - COALESCE(r.desconto_reserva, 0)
          ELSE COALESCE(r.valorcontratado, la.valortotalpermanencia)
        END AS valor
      FROM reserva r
      LEFT JOIN locacaoapartamento la ON r.id_locacaoapartamento = la.id_apartamentostate
      WHERE (r.cancelada IS NULL OR r.cancelada::date > (r.datainicio::date + 7))
        AND (r.valorcontratado IS NOT NULL OR la.valortotalpermanencia IS NOT NULL)
        AND r.id_tipoorigemreserva IN (1, 3, 4, 6, 7, 8)
        AND r.dataatendimento >= $1 AND r.dataatendimento < $2
    ),
    totais AS (
      SELECT COALESCE(SUM(valor), 0) AS total_geral
      FROM canal_classificado
      WHERE canal IS NOT NULL
    )
    SELECT
      canal,
      ROUND(SUM(valor)::numeric, 2)    AS receita,
      COUNT(DISTINCT id)               AS reservas,
      (SELECT total_geral FROM totais) AS total_geral
    FROM canal_classificado
    WHERE canal IS NOT NULL
    GROUP BY canal
    ORDER BY receita DESC
  `

  try {
    const { rows } = await pool.query<{
      canal: string
      receita: string
      reservas: string
      total_geral: string
    }>(sql, [ddmmyyyyToIso(startDateDDMMYYYY), buildIsoEnd(endDateDDMMYYYY)])

    const totalGeral = Number(rows[0]?.total_geral ?? 0)

    return rows.map((row) => {
      const receita  = Number(row.receita)  || 0
      const reservas = Number(row.reservas) || 0
      return {
        canal:              row.canal,
        label:              CANAL_LABELS[row.canal] ?? row.canal,
        receita,
        reservas,
        ticket:             reservas > 0 ? +(receita / reservas).toFixed(2) : 0,
        representatividade: totalGeral > 0 ? +((receita / totalGeral) * 100).toFixed(1) : 0,
      }
    })
  } catch (err) {
    console.error('[ChannelKPIs] Query falhou:', err instanceof Error ? err.message : err)
    return []
  }
}

// ─── Períodos válidos por unidade ────────────────────────────────────────────

export const UNIT_VALID_PERIODS: Record<string, string[]> = {
  'altana':        ['1 hora', '2 horas', '4 horas', '12 horas'],
  'lush-ipiranga': ['3 horas', '6 horas', '12 horas', 'Day Use', 'Diária', 'Pernoite'],
  'lush-lapa':     ['3 horas', '6 horas', '12 horas', 'Day Use', 'Diária', 'Pernoite'],
  'tout':          ['3 horas', '6 horas', '12 horas', 'Day Use', 'Diária', 'Pernoite'],
  'andar-de-cima': ['3 horas', '6 horas', '12 horas', 'Day Use', 'Diária', 'Pernoite'],
}

// ─── Mix por período de locação ───────────────────────────────────────────────

/**
 * Classifica locações por período usando duração + hora de check-in.
 * Respeita os mesmos filtros de data, status, hora e dateType que fetchCompanyKPIsFromAutomo.
 */
export async function queryPeriodMix(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
  rentalStatus = 'FINALIZADA',
  startHour = 6,
  endHour = 5,
  dateType = 'checkin',
): Promise<BillingRentalTypeItem[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = UNIT_CATEGORY_IDS[unitSlug]
  if (!catIds?.length) return []

  const isoStart     = ddmmyyyyToIso(startDateDDMMYYYY)
  const isoEnd       = buildIsoEnd(endDateDDMMYYYY)
  const statusFilter = buildStatusFilter(rentalStatus)
  const { col }      = buildDateRangeFilter(dateType)
  const timeFilter   = buildTimeFilter(startHour, endHour, col)
  const idList       = catIds.join(',')

  const sql = `
    WITH base AS (
      SELECT
        EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 AS dur,
        EXTRACT(HOUR FROM la.datainicialdaocupacao)                                       AS h_in,
        la.valortotal::numeric AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ${col} >= $1
        AND ${col} <  $2
        ${statusFilter}
        ${timeFilter}
        AND ca.id IN (${idList})
        AND la.datafinaldaocupacao IS NOT NULL
    ),
    classificado AS (
      SELECT
        CASE
          -- Pacotes por duração (qualquer horário)
          WHEN dur < 1.5  THEN '1 hora'
          WHEN dur < 2.5  THEN '2 horas'
          WHEN dur < 3.5  THEN '3 horas'
          WHEN dur < 5.0  THEN '4 horas'
          -- Day Use: check-in slot 13h (12h–14h) + ~6h de duração
          WHEN h_in BETWEEN 12 AND 14 AND dur >= 5.0 AND dur < 8.0
            THEN 'Day Use'
          -- 6 horas: ~6h em qualquer outro horário
          WHEN dur < 8.0
            THEN '6 horas'
          -- 12 horas: ~12h de duração (qualquer horário)
          WHEN dur < 14.0
            THEN '12 horas'
          -- Pernoite: check-in slot 20h (19h–21h) + ~16h de duração
          WHEN h_in BETWEEN 19 AND 21 AND dur >= 14.0 AND dur < 20.0
            THEN 'Pernoite'
          -- Diária: check-in slot 15h (14h–16h) + longa duração, ou qualquer estadia muito longa
          ELSE 'Diária'
        END AS periodo,
        receita
      FROM base
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

  const validPeriods = UNIT_VALID_PERIODS[unitSlug]

  try {
    const { rows } = await pool.query<{
      periodo: string; value: string; locacoes: string; ticket: string; percent: string
    }>(sql, [isoStart, isoEnd])

    const all = rows.map((r) => ({
      rentalType: r.periodo,
      value:      Number(r.value)    || 0,
      locacoes:   Number(r.locacoes) || 0,
      ticket:     Number(r.ticket)   || 0,
      percent:    Number(r.percent)  || 0,
    }))

    // Filtra e reordena conforme períodos válidos da unidade
    if (validPeriods?.length) {
      const ordered = validPeriods
        .map((p) => all.find((r) => r.rentalType === p))
        .filter((r): r is BillingRentalTypeItem => !!r)

      // Recalcula % sobre o total filtrado
      const totalFiltered = ordered.reduce((s, r) => s + r.value, 0)
      return ordered.map((r) => ({
        ...r,
        percent: totalFiltered > 0 ? +((r.value / totalFiltered) * 100).toFixed(1) : 0,
      }))
    }

    return all
  } catch (err) {
    console.error('[PeriodMix] Query falhou:', err instanceof Error ? err.message : err)
    return []
  }
}
