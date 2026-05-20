import { getAutomPool, getUnitCategoryIds, getUnitPeriodType } from './client'
import { ddmmyyyyToIso, addDays, buildDateRangeFilter, buildStatusFilter, buildTimeFilter } from './company-kpis'
import { buildPeriodCaseSQL, getValidPeriodsForType } from './period-helpers'
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
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  // Datas sem corte 06:00 — igual ao BETWEEN por dia do Analytics
  const startDate = ddmmyyyyToIso(startDateDDMMYYYY).slice(0, 10)        // YYYY-MM-DD
  const endDate   = addDays(ddmmyyyyToIso(endDateDDMMYYYY), 1).slice(0, 10) // exclusive next day

  const sql = `
    WITH canal_classificado AS (
      SELECT
        r.id,
        r.id_tipoorigemreserva,
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
        END AS canal
      FROM reserva r
      LEFT JOIN locacaoapartamento la ON r.id_locacaoapartamento = la.id_apartamentostate
      WHERE (r.cancelada IS NULL OR r.cancelada::date > (r.datainicio::date + 7))
        AND (r.valorcontratado IS NOT NULL OR la.valortotalpermanencia IS NOT NULL)
        AND r.id_tipoorigemreserva IN (1, 3, 4, 6, 7, 8)
        AND r.dataatendimento >= $1 AND r.dataatendimento < $2
    ),
    -- Canais não-site: valorcontratado com desconto Guia Go (igual ao Analytics)
    valores_outros_canais AS (
      SELECT
        cc.id,
        cc.canal,
        CASE
          WHEN cc.id_tipoorigemreserva = 3 AND COALESCE(r.reserva_programada_guia, false) = false
          THEN COALESCE(r.valorcontratado, la.valortotalpermanencia) - COALESCE(r.desconto_reserva, 0)
          ELSE COALESCE(r.valorcontratado, la.valortotalpermanencia)
        END AS valor
      FROM canal_classificado cc
      JOIN reserva r           ON cc.id = r.id
      LEFT JOIN locacaoapartamento la ON r.id_locacaoapartamento = la.id_apartamentostate
      WHERE cc.id_tipoorigemreserva != 4
    ),
    -- Canal site (id=4): novo_lancamento versao=0 tipolancamento=RESERVA — valor financeiro oficial
    -- Captura valor real cobrado (inclui alterações de período/prorrogação)
    valores_website AS (
      SELECT
        cc.id,
        cc.canal,
        COALESCE(SUM(nl.valor), 0) AS valor
      FROM canal_classificado cc
      JOIN novo_lancamento nl ON cc.id = nl.id_originado
      WHERE cc.id_tipoorigemreserva = 4
        AND nl.versao = 0
        AND nl.dataexclusao IS NULL
        AND nl.tipolancamento = 'RESERVA'
      GROUP BY cc.id, cc.canal
    ),
    todos_valores AS (
      SELECT id, canal, valor FROM valores_outros_canais
      UNION ALL
      SELECT id, canal, valor FROM valores_website
    ),
    -- Total de locações finalizadas: denominador da representatividade (igual ao Analytics)
    total_locacoes AS (
      SELECT COALESCE(SUM(la2.valortotal), 0) AS total_geral
      FROM locacaoapartamento la2
      JOIN apartamentostate ast ON la2.id_apartamentostate = ast.id
      WHERE ast.datainicio >= $1 AND ast.datainicio < $2
        AND la2.fimocupacaotipo = 'FINALIZADA'
    )
    SELECT
      canal,
      ROUND(SUM(valor)::numeric, 2)             AS receita,
      COUNT(DISTINCT id)                         AS reservas,
      (SELECT total_geral FROM total_locacoes)   AS total_geral
    FROM todos_valores
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
    }>(sql, [startDate, endDate])

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

// ─── Helpers por period_type ─────────────────────────────────────────────────
// Re-exportados de period-helpers.ts para retrocompat de importadores externos.
export { buildPeriodCaseSQL, getValidPeriodsForType } from './period-helpers'


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
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = await getUnitCategoryIds(unitSlug)
  if (!catIds.length) return []

  const periodType   = await getUnitPeriodType(unitSlug)
  const isoStart     = ddmmyyyyToIso(startDateDDMMYYYY)
  const isoEnd       = buildIsoEnd(endDateDDMMYYYY)
  const statusFilter = buildStatusFilter(rentalStatus)
  const { col }      = buildDateRangeFilter(dateType)
  const timeFilter   = buildTimeFilter(startHour, endHour, col)
  const idList       = catIds.join(',')

  const periodCase = buildPeriodCaseSQL(periodType)

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
        ${periodCase} AS periodo,
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

  const validPeriods = getValidPeriodsForType(periodType)

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

// ─── Taxa de cancelamento por canal (GAP 5) ───────────────────────────────────

export interface CancellationRateRow {
  canal:      string
  label:      string
  total:      number
  canceladas: number
  taxa_pct:   number
}

/**
 * Taxa de cancelamento por canal no período, usando `dataatendimento` como eixo.
 * "Cancelamento" = reserva com `cancelada IS NOT NULL` dentro de 7 dias do início.
 * Retorna array vazio em caso de erro.
 */
export async function queryCancellationByChannel(
  unitSlug: string,
  startDateDDMMYYYY: string,
  endDateDDMMYYYY: string,
): Promise<CancellationRateRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const startDate = ddmmyyyyToIso(startDateDDMMYYYY).slice(0, 10)
  const endDate   = addDays(ddmmyyyyToIso(endDateDDMMYYYY), 1).slice(0, 10)

  const sql = `
    WITH canal_todos AS (
      SELECT
        r.id,
        r.cancelada,
        r.datainicio,
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
        END AS canal
      FROM reserva r
      WHERE r.id_tipoorigemreserva IN (1, 3, 4, 6, 7, 8)
        AND r.dataatendimento >= $1 AND r.dataatendimento < $2
    )
    SELECT
      canal,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE cancelada IS NOT NULL
          AND cancelada::date <= (datainicio::date + 7)
      )::int AS canceladas
    FROM canal_todos
    WHERE canal IS NOT NULL
    GROUP BY canal
    ORDER BY canceladas DESC
  `

  try {
    const { rows } = await pool.query<{
      canal:      string
      total:      number
      canceladas: number
    }>(sql, [startDate, endDate])

    return rows.map((r) => ({
      canal:      r.canal,
      label:      CANAL_LABELS[r.canal] ?? r.canal,
      total:      Number(r.total)      || 0,
      canceladas: Number(r.canceladas) || 0,
      taxa_pct:   r.total > 0 ? +((Number(r.canceladas) / Number(r.total)) * 100).toFixed(1) : 0,
    }))
  } catch (err) {
    console.error('[CancellationRate] Query falhou:', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Formata as taxas de cancelamento como bloco markdown para o agente.
 * Omitido quando todos os canais têm taxa 0 (não há cancelamentos no período).
 */
export function buildCancellationBlock(rows: CancellationRateRow[]): string {
  const withCancellations = rows.filter((r) => r.canceladas > 0)
  if (!withCancellations.length) return ''

  const lines = [
    '## Taxa de Cancelamento por Canal',
    '',
    '| Canal | Total Reservas | Canceladas | Taxa % |',
    '|-------|---------------|------------|--------|',
    ...withCancellations.map(
      (r) => `| ${r.label} | ${r.total} | ${r.canceladas} | ${r.taxa_pct.toFixed(1)}% |`
    ),
    '',
    '> Cancelamento = reserva cancelada dentro de 7 dias do início.',
  ]
  return lines.join('\n')
}
