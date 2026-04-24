export type DatePreset = '7d' | 'this-month' | 'last-month' | 'custom'

export interface DateRange {
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  preset: DatePreset
  label: string
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Validates that a string is a safe YYYY-MM-DD date (used before SQL interpolation) */
export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

export function resolvePreset(
  preset?: string | null,
  customStart?: string | null,
  customEnd?: string | null,
): DateRange {
  const today = new Date()

  switch (preset) {
    case '7d': {
      const start = new Date(today)
      start.setDate(start.getDate() - 7)
      return { startDate: fmt(start), endDate: fmt(today), preset: '7d', label: 'Últimos 7 dias' }
    }
    case 'this-month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { startDate: fmt(start), endDate: fmt(today), preset: 'this-month', label: 'Este mês' }
    }
    case 'last-month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end   = new Date(today.getFullYear(), today.getMonth(), 0)
      return { startDate: fmt(start), endDate: fmt(end), preset: 'last-month', label: 'Último mês fechado' }
    }
    case 'custom': {
      if (
        customStart && customEnd &&
        isValidIsoDate(customStart) && isValidIsoDate(customEnd) &&
        customStart <= customEnd
      ) {
        const [sy, sm, sd] = customStart.split('-')
        const [ey, em, ed] = customEnd.split('-')
        return {
          startDate: customStart,
          endDate: customEnd,
          preset: 'custom',
          label: `${sd}/${sm}/${sy} → ${ed}/${em}/${ey}`,
        }
      }
      break
    }
  }

  // Default: este mês
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return { startDate: fmt(start), endDate: fmt(today), preset: 'this-month', label: 'Este mês' }
}

/** YYYY-MM-DD → DD/MM/YYYY (formato de período KPI / Automo) */
export function toLhgDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

/** YYYY-MM-DD → DD/MM/YYYY (display) */
export function fmtDisplay(isoDate: string): string {
  return toLhgDate(isoDate)
}
