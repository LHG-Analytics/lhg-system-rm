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
// Estrutura do payload: weekDay = nome da categoria, demais chaves = dias da semana.
// A API já inclui uma linha "Total ..." ao final.

const WEEK_COL_ORDER: Record<string, number> = {
  'Domingo': 1,
  'Segunda-Feira': 2, 'Segunda-feira': 2,
  'Terça-Feira':   3, 'Terça-feira':   3,
  'Quarta-Feira':  4, 'Quarta-feira':  4,
  'Quinta-Feira':  5, 'Quinta-feira':  5,
  'Sexta-Feira':   6, 'Sexta-feira':   6,
  'Sábado':        7,
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

  // Colunas = dias da semana (tudo exceto weekDay), ordenados
  const firstRow = data[0]
  const dayCols = Object.keys(firstRow)
    .filter((k) => k !== 'weekDay')
    .sort((a, b) => (WEEK_COL_ORDER[a] ?? 99) - (WEEK_COL_ORDER[b] ?? 99))
  if (!dayCols.length) return null

  // Separa linhas normais das linhas de total (weekDay começa com "Total")
  const dataRows  = data.filter((r) => !String(r.weekDay ?? '').toLowerCase().startsWith('total'))
  const totalRows = data.filter((r) =>  String(r.weekDay ?? '').toLowerCase().startsWith('total'))

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
                Categorias
              </th>
              {dayCols.map((col) => (
                <th key={col} className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, i) => (
              <tr key={`${String(row.weekDay)}-${i}`} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{String(row.weekDay ?? '–')}</td>
                {dayCols.map((col) => {
                  const v = row[col]
                  return (
                    <td key={col} className="px-4 py-3 text-right tabular-nums">
                      {typeof v === 'number' ? formatVal(v) : '–'}
                    </td>
                  )
                })}
              </tr>
            ))}
            {totalRows.map((row, i) => (
              <tr key={`total-${i}`} className="bg-muted/40 border-t-2 border-border font-semibold">
                <td className="px-4 py-3 whitespace-nowrap">{String(row.weekDay ?? 'Total')}</td>
                {dayCols.map((col) => {
                  const v = row[col]
                  return (
                    <td key={col} className="px-4 py-3 text-right tabular-nums">
                      {typeof v === 'number' ? formatVal(v) : '–'}
                    </td>
                  )
                })}
              </tr>
            ))}
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
