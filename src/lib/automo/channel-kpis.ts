import { getAutomPool, UNIT_CATEGORY_IDS } from './client'
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

// ─── Helpers de formato de data ───────────────────────────────────────────────

function toSqlStart(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} 00:00:00`
}

function toSqlEnd(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} 23:59:59`
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
        AND r.dataatendimento BETWEEN $1 AND $2
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
    }>(sql, [toSqlStart(startDateDDMMYYYY), toSqlEnd(endDateDDMMYYYY)])

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

// ─── Mix por período de locação ───────────────────────────────────────────────

/**
 * Classifica locações por período usando duração + hora de check-in.
 * Períodos esperados por unidade:
 *   Lush/Tout/Andar de Cima: 1h, 3h, 6h, 12h, Day Use, Pernoite, Diária
 *   Altana:                   1h, 2h, 4h, 12h
 *
 * A distinção Day Use / Pernoite / 12h usa a hora do check-in:
 *   - check-in 08h–17h + duração 8–14h → Day Use
 *   - check-in 18h–05h + duração 8–14h → Pernoite
 *   - duração < 8h                     → período em horas (1h, 2h, 3h, 4h, 6h)
 *   - duração ≥ 20h                    → Diária
 *   - resto (12h fora dos rangos)      → 12h
 *
 * Usa `datainicialdaocupacao` com corte operacional 06:00 (igual às demais queries).
 */
export async function queryPeriodMix(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
  statusFilter = "AND la.fimocupacaotipo = 'FINALIZADA'",
): Promise<BillingRentalTypeItem[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = UNIT_CATEGORY_IDS[unitSlug]
  if (!catIds?.length) return []

  const [d1, m1, y1] = startDateDDMMYYYY.split('/')
  const [d2, m2, y2] = endDateDDMMYYYY.split('/')
  const isoStart = `${y1}-${m1.padStart(2,'0')}-${d1.padStart(2,'0')} 06:00:00`
  // Para o fim: se o end é "hoje", usar hoje 06:00 (período aberto); senão (end+1) 06:00
  const endDate = new Date(`${y2}-${m2}-${d2}T06:00:00`)
  const today6  = new Date(); today6.setHours(6,0,0,0)
  const isoEnd  = endDate >= today6
    ? `${y2}-${m2.padStart(2,'0')}-${d2.padStart(2,'0')} 06:00:00`
    : (() => {
        const next = new Date(endDate); next.setDate(next.getDate() + 1)
        return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')} 06:00:00`
      })()

  const idList = catIds.join(',')

  const sql = `
    WITH classificado AS (
      SELECT
        CASE
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 1.5
            THEN '1 hora'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 2.5
            THEN '2 horas'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 3.5
            THEN '3 horas'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 5.0
            THEN '4 horas'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 7.5
            THEN '6 horas'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 >= 20
            THEN 'Diária'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 >= 7.5
               AND EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 20
               AND EXTRACT(HOUR FROM la.datainicialdaocupacao) BETWEEN 8 AND 17
            THEN 'Day Use'
          WHEN EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 >= 7.5
               AND EXTRACT(EPOCH FROM (la.datafinaldaocupacao - la.datainicialdaocupacao)) / 3600.0 < 20
               AND (EXTRACT(HOUR FROM la.datainicialdaocupacao) >= 18
                    OR EXTRACT(HOUR FROM la.datainicialdaocupacao) < 8)
            THEN 'Pernoite'
          ELSE '12 horas'
        END AS periodo,
        la.valortotal::numeric AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        ${statusFilter}
        AND ca.id IN (${idList})
        AND la.datafinaldaocupacao IS NOT NULL
    ),
    totais AS (
      SELECT COALESCE(SUM(receita), 0) AS total FROM classificado
    )
    SELECT
      periodo,
      ROUND(SUM(receita)::numeric, 2) AS value,
      CASE WHEN (SELECT total FROM totais) > 0
           THEN ROUND((SUM(receita) / (SELECT total FROM totais) * 100)::numeric, 1)
           ELSE 0
      END AS percent
    FROM classificado
    GROUP BY periodo
    ORDER BY value DESC
  `

  try {
    const { rows } = await pool.query<{ periodo: string; value: string; percent: string }>(
      sql, [isoStart, isoEnd]
    )
    return rows.map((r) => ({
      rentalType: r.periodo,
      value:      Number(r.value)   || 0,
      percent:    Number(r.percent) || 0,
    }))
  } catch (err) {
    console.error('[PeriodMix] Query falhou:', err instanceof Error ? err.message : err)
    return []
  }
}
