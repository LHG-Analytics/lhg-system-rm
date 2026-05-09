'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeeklyReportData, KPISnapshot } from '@/lib/reports/types'
import { MonetaryKpiChart, GiroKpiChart } from '../charts/kpi-comparison-chart'

interface Props {
  data: WeeklyReportData['kpis']
}

const KPI_ITEMS: { key: keyof KPISnapshot; label: string; fmt: (v: number) => string }[] = [
  { key: 'receita', label: 'Receita', fmt: v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) },
  { key: 'revpar', label: 'RevPAR', fmt: v => `R$ ${v.toFixed(2)}` },
  { key: 'trevpar', label: 'TRevPAR', fmt: v => `R$ ${v.toFixed(2)}` },
  { key: 'giro', label: 'Giro', fmt: v => v.toFixed(2) },
  { key: 'ocupacao', label: 'Ocupação', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'ticket', label: 'Ticket Médio', fmt: v => `R$ ${v.toFixed(2)}` },
  { key: 'locacoes', label: 'Locações', fmt: v => v.toFixed(0) },
  { key: 'tmo', label: 'TMO (h)', fmt: v => v.toFixed(1) },
]

function deltaPct(curr: number, prev: number): string {
  if (!prev) return '—'
  const d = ((curr - prev) / prev) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`
}

export function KpisSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">④ KPIs do período</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">RevPAR · TRevPAR · Ticket Médio (R$/suíte)</p>
            <MonetaryKpiChart
              current={data.current}
              previousWeek={data.previousWeek}
              sameWeekLastYear={data.sameWeekLastYear}
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Giro (locações/suíte/dia) — referência: &lt;1.0 baixo · 1.0–1.8 normal · &gt;1.8 alto</p>
            <GiroKpiChart
              current={data.current}
              previousWeek={data.previousWeek}
              sameWeekLastYear={data.sameWeekLastYear}
            />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left pb-1 font-medium">KPI</th>
                <th className="text-right pb-1 font-medium">Este período</th>
                {data.previousWeek && <th className="text-right pb-1 font-medium">Período ant.</th>}
                {data.sameWeekLastYear && <th className="text-right pb-1 font-medium">Ano anterior</th>}
              </tr>
            </thead>
            <tbody>
              {KPI_ITEMS.map(item => (
                <tr key={item.key} className="border-b last:border-0">
                  <td className="py-1.5 text-muted-foreground">{item.label}</td>
                  <td className="text-right font-medium">{item.fmt(data.current[item.key])}</td>
                  {data.previousWeek && (
                    <td className="text-right text-muted-foreground">
                      {item.fmt(data.previousWeek[item.key])}
                      <span className="text-xs ml-1">({deltaPct(data.current[item.key], data.previousWeek[item.key])})</span>
                    </td>
                  )}
                  {data.sameWeekLastYear && (
                    <td className="text-right text-muted-foreground">
                      {item.fmt(data.sameWeekLastYear[item.key])}
                      <span className="text-xs ml-1">({deltaPct(data.current[item.key], data.sameWeekLastYear[item.key])})</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
