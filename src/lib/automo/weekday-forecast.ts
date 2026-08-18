import { Pool } from 'pg'
import { cteBaseSuiteDays, cteSuiteDaysByDow } from './suite-days'

/**
 * Previsão de fechamento do mês ponderada por dia da semana.
 *
 * O método anterior (`dailyAvgValue = totalAllValue / diasElapsed`) tratava todo dia
 * restante do mês como igual à média corrida — se o mês ainda teve poucos fins de
 * semana, a previsão subestima os fins de semana que faltam (e vice-versa).
 *
 * Aqui, para cada dia que falta no mês:
 *   1. Pega o giro (locações / suíte-dia) e o ticket médio das ÚLTIMAS ocorrências
 *      daquele mesmo dia da semana (janela de 28 dias corridos = exatamente 4 ocorrências
 *      de cada dia da semana, ex: os últimos 4 sábados).
 *   2. Aplica esse giro à quantidade de suítes REALMENTE disponíveis no dia futuro
 *      (já descontando bloqueios/manutenção agendados — mesma CTE de suítes-dia usada
 *      em todo o resto do dashboard).
 *
 * Soma-se o resultado dos dias restantes ao que já foi realizado no mês para chegar
 * na previsão de fechamento (faturamento, locações, giro e TRevPAR).
 */

interface HistoricalDowRow {
  dow:            string  // '0'..'6'
  total_rentals:  string
  total_value:    string  // valortotal (locação + consumo - desconto) — mesma base de queryBigNumbers
  suite_dias:     string
}

export interface WeekdayForecastBasis {
  /** locações / suíte-dia, por dia da semana (0=domingo…6=sábado), baseado nas últimas ~4 ocorrências */
  giroByDow:   Map<number, number>
  /** ticket médio por locação, por dia da semana */
  ticketByDow: Map<number, number>
  /** fallback quando um dia da semana específico não teve amostra (giro/ticket = 0/0) */
  overallGiro:   number
  overallTicket: number
}

/**
 * Base histórica: giro e ticket médio por dia da semana, na janela [histStartIso, histEndIso).
 * Chamador deve passar uma janela de ~28 dias terminando "ontem" (06:00) para pegar
 * exatamente as últimas 4 ocorrências de cada dia da semana.
 */
export async function queryWeekdayForecastBasis(
  pool: Pool,
  catIds: string,
  histStartIso: string,
  histEndIso: string,
): Promise<WeekdayForecastBasis> {
  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2')},
    ${cteSuiteDaysByDow()},
    locacoes_dow AS (
      SELECT
        EXTRACT(DOW FROM (
          CASE
            WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) >= 6
              THEN la.datainicialdaocupacao
            ELSE la.datainicialdaocupacao - INTERVAL '1 day'
          END
        ))::int AS dow,
        COUNT(*) AS total_rentals,
        COALESCE(SUM(CAST(la.valortotal AS DECIMAL(15,4))), 0) AS total_value
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <= $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
      GROUP BY 1
    )
    SELECT
      sdtd.dow                             AS dow,
      COALESCE(ld.total_rentals, 0)        AS total_rentals,
      COALESCE(ld.total_value, 0)          AS total_value,
      sdtd.suite_dias                      AS suite_dias
    FROM suite_dias_total_dow sdtd
    LEFT JOIN locacoes_dow ld ON sdtd.dow = ld.dow
  `

  const giroByDow   = new Map<number, number>()
  const ticketByDow = new Map<number, number>()
  let totalRentalsAll = 0
  let totalValueAll   = 0
  let totalSuiteDiasAll = 0

  try {
    const { rows } = await pool.query<HistoricalDowRow>(sql, [histStartIso, histEndIso])

    for (const r of rows) {
      const dow = Number(r.dow)
      const rentals = Number(r.total_rentals) || 0
      const value = Number(r.total_value) || 0
      const suiteDias = Number(r.suite_dias) || 0

      totalRentalsAll += rentals
      totalValueAll += value
      totalSuiteDiasAll += suiteDias

      giroByDow.set(dow, suiteDias > 0 ? rentals / suiteDias : 0)
      ticketByDow.set(dow, rentals > 0 ? value / rentals : 0)
    }
  } catch (e) {
    console.error('[weekday-forecast] queryWeekdayForecastBasis falhou:', e instanceof Error ? e.message : String(e))
  }

  return {
    giroByDow,
    ticketByDow,
    overallGiro:   totalSuiteDiasAll > 0 ? totalRentalsAll / totalSuiteDiasAll : 0,
    overallTicket: totalRentalsAll > 0 ? totalValueAll / totalRentalsAll : 0,
  }
}

/**
 * Suítes-dia disponíveis nos dias FUTUROS que faltam no mês, agrupadas por dia da semana.
 * Usa a mesma CTE de bloqueios do resto do sistema — se já existe um bloqueio agendado
 * (obra/manutenção futura) para algum dia restante, ele é descontado automaticamente.
 */
export async function queryFutureSuiteDaysByDow(
  pool: Pool,
  catIds: string,
  futureStartIso: string,
  futureEndIso: string,
): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (futureStartIso >= futureEndIso) return result

  const sql = `
    WITH ${cteBaseSuiteDays(catIds, '$1', '$2')},
    ${cteSuiteDaysByDow()}
    SELECT dow, suite_dias FROM suite_dias_total_dow
  `
  try {
    const { rows } = await pool.query<{ dow: string; suite_dias: string }>(sql, [futureStartIso, futureEndIso])
    for (const r of rows) result.set(Number(r.dow), Number(r.suite_dias) || 0)
  } catch (e) {
    console.error('[weekday-forecast] queryFutureSuiteDaysByDow falhou:', e instanceof Error ? e.message : String(e))
  }
  return result
}

export interface WeekdayWeightedRemainder {
  remainingLocacoes:  number
  remainingValue:      number
  remainingSuiteDias: number
}

/** Combina a base histórica (giro/ticket por dow) com as suítes-dia futuras por dow. */
export function computeWeekdayWeightedRemainder(
  basis: WeekdayForecastBasis,
  futureSuiteDaysByDow: Map<number, number>,
): WeekdayWeightedRemainder {
  let remainingLocacoes = 0
  let remainingValue = 0
  let remainingSuiteDias = 0

  for (const [dow, suiteDias] of futureSuiteDaysByDow) {
    if (suiteDias <= 0) continue
    const giro   = basis.giroByDow.get(dow) || basis.overallGiro
    const ticket = basis.ticketByDow.get(dow) || basis.overallTicket
    const locacoes = giro * suiteDias
    remainingLocacoes += locacoes
    remainingValue += locacoes * ticket
    remainingSuiteDias += suiteDias
  }

  return { remainingLocacoes, remainingValue, remainingSuiteDias }
}
