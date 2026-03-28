import type { CompanyKPIResponse } from '@/lib/lhg-analytics/types'

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

interface DashboardChartsProps {
  company: CompanyKPIResponse | null
}

export function DashboardCharts({ company }: DashboardChartsProps) {
  if (!company) return null

  const suiteTable = company.DataTableSuiteCategory
  if (!suiteTable?.length) return null

  // API format: Array<{ [categoryName]: SuiteCategoryKPI }>
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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Categoria</th>
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
