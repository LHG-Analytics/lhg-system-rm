import { getAutomPool } from './client'
import type { ChannelKPIRow } from '@/lib/kpis/types'

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
