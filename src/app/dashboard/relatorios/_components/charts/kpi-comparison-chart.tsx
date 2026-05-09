'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { KPISnapshot } from '@/lib/reports/types'

interface Props {
  current: KPISnapshot
  previousWeek: KPISnapshot | null
  sameWeekLastYear: KPISnapshot | null
}

const METRICS: { key: keyof KPISnapshot; label: string; prefix?: string }[] = [
  { key: 'revpar', label: 'RevPAR', prefix: 'R$' },
  { key: 'trevpar', label: 'TRevPAR', prefix: 'R$' },
  { key: 'giro', label: 'Giro' },
  { key: 'ticket', label: 'Ticket', prefix: 'R$' },
]

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#18181b',
    border: '1px solid #3f3f46',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f4f4f5',
  },
  labelStyle: { color: '#a1a1aa', marginBottom: 4 },
  itemStyle: { color: '#f4f4f5' },
}

export function KpiComparisonChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const data = METRICS.map(m => ({
    name: m.label,
    Atual: current[m.key],
    'Per. ant.': previousWeek ? previousWeek[m.key] : undefined,
    'Mesmo LY': sameWeekLastYear ? sameWeekLastYear[m.key] : undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: unknown, name: unknown, item: unknown) => {
            const v = Number(value)
            const n = String(name)
            const metricName = (item as { payload?: { name?: string } })?.payload?.name ?? ''
            const metric = METRICS.find(m => m.label === metricName)
            return [metric?.prefix ? `${metric.prefix} ${v.toFixed(2)}` : v.toFixed(2), n]
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Atual" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        {previousWeek && <Bar dataKey="Per. ant." fill="#94a3b8" radius={[3, 3, 0, 0]} />}
        {sameWeekLastYear && <Bar dataKey="Mesmo LY" fill="#64748b" radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  )
}
