/**
 * Helpers de classificação de período por tipo de unidade.
 * Compartilhado entre company-kpis.ts e channel-kpis.ts — evita dependência circular.
 *
 * 'standard' = mínimo 3h (Lush, Tout, Andar de Cima, LIV, etc.)
 * 'altana'   = mínimo 1h
 */

export function getValidPeriodsForType(periodType: 'standard' | 'altana'): string[] {
  if (periodType === 'altana') return ['1 hora', '2 horas', '4 horas', '12 horas']
  return ['3 horas', '6 horas', '12 horas', 'Day Use', 'Diária', 'Pernoite']
}

/**
 * EXISTS para detectar se uma locação veio de uma RESERVA PROGRAMADA (site programado
 * ou Guia programado). Day Use / Pernoite / Diária são produtos EXCLUSIVOS desse canal —
 * locações de balcão/walk-in nunca são esses produtos, mesmo que a duração/horário "pareça".
 *
 * Mesma detecção usada em queryChannelKPIs (WEBSITE_SCHEDULED / GUIA_SCHEDULED).
 * `la` = alias da tabela locacaoapartamento na query externa.
 */
export function scheduledReservaExistsSQL(la = 'la'): string {
  return `EXISTS (
            SELECT 1 FROM reserva r
            WHERE r.id_locacaoapartamento = ${la}.id_apartamentostate
              AND (r.cancelada IS NULL OR r.cancelada::date > (r.datainicio::date + 7))
              AND (
                (r.id_tipoorigemreserva = 3 AND COALESCE(r.reserva_programada_guia, false) = true)
                OR (r.id_tipoorigemreserva = 4 AND (
                      (r.periodocontratado = '06:00' AND EXTRACT(HOUR FROM r.datainicio) = 13)
                   OR (r.periodocontratado = '16:00' AND EXTRACT(HOUR FROM r.datainicio) = 20)
                   OR (r.periodocontratado = '21:00' AND EXTRACT(HOUR FROM r.datainicio) = 15)
                   OR (r.periodocontratado IS NULL
                       AND EXTRACT(HOUR FROM r.datainicio) IN (12, 13, 15, 18, 20)
                       AND EXTRACT(MINUTE FROM r.datainicio) = 0)
                ))
              )
          )`
}

/**
 * Gera o CASE SQL de classificação de período.
 * Day Use verificado ANTES de 6h para não engolir chegadas às 12-14h com duração curta.
 *
 * @param gateScheduled quando true, Day Use / Pernoite / Diária só são atribuídos a locações
 *   com reserva programada associada (coluna `is_scheduled` deve existir no SELECT externo).
 *   Locações imediatas/balcão caem sempre em 3h/6h/12h por duração — evita inflar Day Use.
 */
export function buildPeriodCaseSQL(periodType: 'standard' | 'altana', gateScheduled = false): string {
  if (periodType === 'standard') {
    if (gateScheduled) {
      return `
          CASE
            WHEN is_scheduled AND h_in BETWEEN 12 AND 14 AND dur <= 9.0  THEN 'Day Use'
            WHEN is_scheduled AND h_in BETWEEN 19 AND 21 AND dur < 20.0  THEN 'Pernoite'
            WHEN is_scheduled AND dur > 13.5                              THEN 'Diária'
            WHEN dur <= 3.25 THEN '3 horas'
            WHEN dur <= 6.25 THEN '6 horas'
            ELSE '12 horas'
          END`
    }
    return `
          CASE
            WHEN dur <= 3.25 THEN '3 horas'
            WHEN h_in BETWEEN 12 AND 14 AND dur <= 9.0 THEN 'Day Use'
            WHEN dur <= 6.25 THEN '6 horas'
            WHEN dur <= 13.5 THEN '12 horas'
            WHEN h_in BETWEEN 19 AND 21 AND dur < 20.0 THEN 'Pernoite'
            ELSE 'Diária'
          END`
  }
  return `
          CASE
            WHEN dur < 1.5  THEN '1 hora'
            WHEN dur < 2.5  THEN '2 horas'
            WHEN dur < 5.0  THEN '4 horas'
            ELSE '12 horas'
          END`
}
