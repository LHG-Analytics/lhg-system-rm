import type { CompanyKPIResponse, DataTableGiroByWeek, DataTableRevparByWeek } from '@/lib/lhg-analytics/types'

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

interface DashboardChartsProps {
  company: CompanyKPIResponse | null
}

// ─── Tabela Desempenho por Categoria ──────────────────────────────────────────

function SuiteCategoryTable({ company }: { company: CompanyKPIResponse }) {
  const suiteTable = company.DataTableSuiteCategory
  if (!suiteTable?.length) return null

  const rows = suiteTable.flatMap((item) =>
    Object.entries(item).map(([category, kpi]) => ({ category, ...kpi }))
  )
  if (!rows.length) return null

  const total = company.TotalResult

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">Desempenho por Categoria de Suíte</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left  px-4 py-3 font-medium text-muted-foreground">Categoria</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Locações</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Faturamento</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ticket Médio</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Giro</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">RevPAR</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ocupação</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">TMO</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{row.category}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.totalRentalsApartments}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.totalValue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.totalTicketAverage)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.giro.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.revpar)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.occupancyRate.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.averageOccupationTime}</td>
              </tr>
            ))}
            {total && (
              <tr className="bg-muted/40 border-t-2 border-border font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{total.totalAllRentalsApartments}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalAllValue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalAllTicketAverage)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total.totalGiro.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalRevpar)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total.totalOccupancyRate.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{total.totalAverageOccupationTime}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tabela Semanal — Giro por Dia da Semana ──────────────────────────────────
// Payload: Array<{ [categoria]: { [dia]: { giro, totalGiro } } }>
// Dias (chaves): "domingo" | "segunda-feira" | "terça-feira" | ... | "sábado"

const DAY_ORDER = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
const DAY_LABEL: Record<string, string> = {
  'segunda-feira': 'Seg', 'terça-feira': 'Ter', 'quarta-feira': 'Qua',
  'quinta-feira':  'Qui', 'sexta-feira':  'Sex', 'sábado':       'Sáb',
  'domingo':       'Dom',
}

function GiroWeekTable({ title, data }: { title: string; data: DataTableGiroByWeek[] }) {
  if (!data?.length) return null

  // Cada item do array = { [categoria]: { [dia]: { giro, totalGiro } } }
  const rows = data.map((item) => {
    const [cat, days] = Object.entries(item)[0]
    return { cat, days }
  })
  if (!rows.length) return null

  // Dias disponíveis, ordenados
  const dayCols = DAY_ORDER.filter((d) => d in rows[0].days)

  // Linha de total: totalGiro é o mesmo em todos (vem da API por coluna)
  const totalByDay: Record<string, number> = {}
  for (const d of dayCols) {
    const firstVal = rows.find((r) => r.days[d] !== undefined)?.days[d]
    if (firstVal !== undefined) totalByDay[d] = firstVal.totalGiro
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Categorias</th>
              {dayCols.map((d) => (
                <th key={d} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                  {DAY_LABEL[d] ?? d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, days }) => (
              <tr key={cat} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{cat}</td>
                {dayCols.map((d) => (
                  <td key={d} className="px-4 py-3 text-right tabular-nums">
                    {days[d] !== undefined ? days[d].giro.toFixed(2) : '–'}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-muted/40 border-t-2 border-border font-semibold">
              <td className="px-4 py-3 whitespace-nowrap">Total</td>
              {dayCols.map((d) => (
                <td key={d} className="px-4 py-3 text-right tabular-nums">
                  {totalByDay[d] !== undefined ? totalByDay[d].toFixed(2) : '–'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tabela Semanal — RevPAR por Dia da Semana ────────────────────────────────
// Payload: Array<{ [categoria]: { [dia]: { revpar, totalRevpar } } }>

function RevparWeekTable({ title, data }: { title: string; data: DataTableRevparByWeek[] }) {
  if (!data?.length) return null

  const rows = data.map((item) => {
    const [cat, days] = Object.entries(item)[0]
    return { cat, days }
  })
  if (!rows.length) return null

  const dayCols = DAY_ORDER.filter((d) => d in rows[0].days)

  const totalByDay: Record<string, number> = {}
  for (const d of dayCols) {
    const firstVal = rows.find((r) => r.days[d] !== undefined)?.days[d]
    if (firstVal !== undefined) totalByDay[d] = firstVal.totalRevpar
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Categorias</th>
              {dayCols.map((d) => (
                <th key={d} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                  {DAY_LABEL[d] ?? d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, days }) => (
              <tr key={cat} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{cat}</td>
                {dayCols.map((d) => (
                  <td key={d} className="px-4 py-3 text-right tabular-nums">
                    {days[d] !== undefined ? fmt.format(days[d].revpar) : '–'}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-muted/40 border-t-2 border-border font-semibold">
              <td className="px-4 py-3 whitespace-nowrap">Total</td>
              {dayCols.map((d) => (
                <td key={d} className="px-4 py-3 text-right tabular-nums">
                  {totalByDay[d] !== undefined ? fmt.format(totalByDay[d]) : '–'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Export principal ──────────────────────────────────────────────────────────

export function DashboardCharts({ company }: DashboardChartsProps) {
  if (!company) return null

  return (
    <div className="flex flex-col gap-6">
      <SuiteCategoryTable company={company} />

      <RevparWeekTable
        title="RevPAR por Dia da Semana"
        data={company.DataTableRevparByWeek ?? []}
      />

      <GiroWeekTable
        title="Giro por Dia da Semana"
        data={company.DataTableGiroByWeek ?? []}
      />
    </div>
  )
}
