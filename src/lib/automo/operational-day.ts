/**
 * Corte operacional 06:00 — mesma convenção usada em company-kpis.ts e no resto
 * do dashboard, mas aplicada aos heatmaps (que antes usavam dia de calendário
 * puro, meia-noite a meia-noite, sem essa correção).
 *
 * Dia operacional D: começa D 06:00, termina (D+1) 05:59:59.
 * Diurno = 06:00–17:59 do dia D. Noturno = 18:00 do dia D até 05:59 do dia D+1,
 * mas CONTA como pertencente ao dia D.
 */

/** Hoje no fuso BRT, formato YYYY-MM-DD */
export function todayBRISO(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Resolve o range operacional (corte 06:00, igual ao resto do dashboard).
 * isoEnd = (endDate === hoje) ? endDate 05:59:59 (exclui hoje, incompleto)
 *        : (endDate+1) 05:59:59 (inclui o último dia operacional inteiro).
 */
export function resolveOperationalRange(startDate: string, endDate: string): { isoStart: string; isoEnd: string } {
  const isoStart = `${startDate} 06:00:00`
  const isToday  = endDate === todayBRISO()
  const isoEnd   = isToday ? `${endDate} 05:59:59` : `${addDaysISO(endDate, 1)} 05:59:59`
  return { isoStart, isoEnd }
}

/**
 * Timestamp "operacional" — rola para o dia anterior quando a hora é < 06:00.
 * Usar SEMPRE para classificar dia da semana/turno; NUNCA para hour_of_day
 * (esse deve mostrar a hora real do relógio).
 */
export function opTs(col: string): string {
  return `(CASE WHEN EXTRACT(HOUR FROM ${col}) >= 6 THEN ${col} ELSE ${col} - INTERVAL '1 day' END)`
}
