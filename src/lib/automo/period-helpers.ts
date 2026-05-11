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
 * Gera o CASE SQL de classificação de período.
 * Day Use verificado ANTES de 6h para não engolir chegadas às 12-14h com duração curta.
 */
export function buildPeriodCaseSQL(periodType: 'standard' | 'altana'): string {
  if (periodType === 'standard') {
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
