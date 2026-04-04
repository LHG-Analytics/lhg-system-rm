import type { KPIQueryParams } from './types'

/** Formata uma Date como DD/MM/YYYY para consultas KPI (Automo). */
export function toApiDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

/**
 * Janela rolante de 12 meses: mesma data do ano passado → ontem.
 * Ex: hoje = 28/03/2026 → startDate = 28/03/2025, endDate = 27/03/2026.
 */
export function trailingYear(): KPIQueryParams {
  const now = new Date()

  const operationalToday =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const endDate = new Date(operationalToday)
  endDate.setDate(endDate.getDate() - 1)

  const startDate = new Date(operationalToday)
  startDate.setFullYear(startDate.getFullYear() - 1)

  return {
    startDate: toApiDate(startDate),
    endDate: toApiDate(endDate),
  }
}

/** Um único dia operacional (corte 06:00). */
export function todayOperational(): KPIQueryParams {
  const now = new Date()
  const operationalDate =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const dateStr = toApiDate(operationalDate)
  return { startDate: dateStr, endDate: dateStr }
}
