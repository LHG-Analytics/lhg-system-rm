import type { CompanyKPIResponse, DataTableByWeek } from '@/lib/lhg-analytics/types'

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

// ─── Tabela Semanal Genérica ───────────────────────────────────────────────────

const DAY_ORDER: Record<string, number> = {
  'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3,
  'Quinta-feira':  4, 'Sexta-feira': 5, 'Sábado':       6, 'Domingo': 7,
  'Segunda': 1, 'Terca': 2, 'Quarta': 3,
  'Quinta':  4, 'Sexta': 5, 'Sabado': 6,
}

function WeeklyTable({
  title,
  data,
  formatVal,
}: {
  title:     string
  data:      DataTableByWeek[]
  formatVal: (v: number) => string
}) {
  if (!data?.length) return null

  // Extrai colunas (tudo exceto weekDay)
  const firstRow = data[0]
  const categories = Object.keys(firstRow).filter((k) => k !== 'weekDay')
  if (!categories.length) return null

  // Ordena por dia da semana
  const sorted = [...data].sort(
    (a, b) => (DAY_ORDER[a.weekDay] ?? 99) - (DAY_ORDER[b.weekDay] ?? 99)
  )

  // Calcula média por categoria
  const avgs: Record<string, number> = {}
  for (const cat of categories) {
    const vals = data
      .map((r) => r[cat])
      .filter((v): v is number => typeof v === 'number')
    avgs[cat] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                Dia
              </th>
              {categories.map((cat) => (
                <th key={cat} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                  {cat}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={`${row.weekDay ?? i}-${i}`} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{row.weekDay}</td>
                {categories.map((cat) => {
                  const v = row[cat]
                  return (
                    <td key={cat} className="px-4 py-3 text-right tabular-nums">
                      {typeof v === 'number' ? formatVal(v) : '–'}
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* Linha de média */}
            <tr className="bg-muted/40 border-t-2 border-border font-semibold">
              <td className="px-4 py-3 whitespace-nowrap">Média</td>
              {categories.map((cat) => (
                <td key={cat} className="px-4 py-3 text-right tabular-nums">
                  {formatVal(avgs[cat])}
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

      <WeeklyTable
        title="RevPAR por Dia da Semana"
        data={company.DataTableRevparByWeek ?? []}
        formatVal={(v) => fmt.format(v)}
      />

      <WeeklyTable
        title="Giro por Dia da Semana"
        data={company.DataTableGiroByWeek ?? []}
        formatVal={(v) => v.toFixed(2)}
      />
    </div>
  )
}
