import type { CompanyKPIResponse } from '@/lib/lhg-analytics/types'

// Placeholder for charts — will be implemented with Recharts in LHG-21
interface DashboardChartsProps {
  company: CompanyKPIResponse | null
}

export function DashboardCharts({ company }: DashboardChartsProps) {
  if (!company) return null

  const suiteTable = company.DataTableSuiteCategory

  if (!suiteTable?.length) return null

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
            </tr>
          </thead>
          <tbody>
            {suiteTable.map((row) => (
              <tr key={row.suiteCategory} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{row.suiteCategory}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Math.round(row.rentals)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.revenue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.ticketAverage)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.giro.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.revpar)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.occupancyRate.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
