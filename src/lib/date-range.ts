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

/**
 * Data de fim para QUERIES (nunca para exibição/label).
 *
 * No período personalizado, o calendário deixa o usuário escolher duas datas como
 * um range inclusivo (ex: 04/07 → 05/07 = "os dois dias, 04 e 05"). Mas o ERP Automo
 * e o LHG Analytics rotulam o boundary de um período com a MESMA convenção usada
 * nos relatórios nativos: "Início: D1 06:00, Fim: D2 06:00" já representa 1 dia
 * (apenas D1) quando D2 = D1+1 — o Fim é o limite EXCLUSIVO, não mais um dia cheio.
 *
 * Sem este ajuste, selecionar "04/07 → 05/07" no calendário soma os DOIS dias
 * operacionais (04/07 completo + 05/07 completo) em vez de apenas 04/07, dobrando
 * o Faturamento/Giro/etc. exibidos em relação ao relatório do ERP para o mesmo range.
 *
 * Só se aplica ao preset 'custom' e quando end > start (range de 2+ células no
 * calendário) — selecionar o mesmo dia duas vezes já funciona corretamente hoje
 * e não deve ser alterado.
 */
export function toQueryEndDate(preset: string, startDate: string, endDate: string): string {
  if (preset !== 'custom' || endDate <= startDate) return endDate
  const [y, m, d] = endDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
