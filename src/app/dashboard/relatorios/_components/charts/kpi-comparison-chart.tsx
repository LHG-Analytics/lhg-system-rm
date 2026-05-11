'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LabelList, ResponsiveContainer } from 'recharts'
import type { KPISnapshot } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  current: KPISnapshot
  previousWeek: KPISnapshot | null
  sameWeekLastYear: KPISnapshot | null
}

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

const MONETARY_METRIC_LABELS = ['RevPAR', 'TRevPAR', 'Ticket']
const MONETARY_METRICS = [
  { key: 'revpar' as keyof KPISnapshot, label: 'RevPAR' },
  { key: 'trevpar' as keyof KPISnapshot, label: 'TRevPAR' },
  { key: 'ticket' as keyof KPISnapshot, label: 'Ticket' },
]

export function MonetaryKpiChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const { symbol, formatMoney } = useCurrency()

  const data = MONETARY_METRICS.map(m => ({
    name: m.label,
    Atual: current[m.key],
    'Semana ant.': previousWeek ? previousWeek[m.key] : undefined,
    'Ano anterior': sameWeekLastYear ? sameWeekLastYear[m.key] : undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 18, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: unknown, name: unknown, item: unknown) => {
            const v = Number(value)
            const n = String(name)
            const metricName = (item as { payload?: { name?: string } })?.payload?.name ?? ''
            const isMoney = MONETARY_METRIC_LABELS.includes(metricName)
            return [isMoney ? `${symbol} ${v.toFixed(2)}` : v.toFixed(2), n]
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Atual" fill="#3b82f6" radius={[3, 3, 0, 0]}>
          <LabelList
            dataKey="Atual"
            position="top"
            style={{ fontSize: 10, fill: '#94a3b8' }}
            formatter={(v: unknown) => formatMoney(Number(v))}
          />
        </Bar>
        {previousWeek && <Bar dataKey="Semana ant." fill="#94a3b8" radius={[3, 3, 0, 0]} />}
        {sameWeekLastYear && <Bar dataKey="Ano anterior" fill="#64748b" radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function GiroKpiChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const data = [
    {
      name: 'Giro (loc/suíte/dia)',
      Atual: current.giro,
      'Semana ant.': previousWeek?.giro ?? undefined,
      'Ano anterior': sameWeekLastYear?.giro ?? undefined,
    },
  ]

  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 18, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={36} domain={[0, 'auto']} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: unknown, name: unknown) => [Number(value).toFixed(2), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Atual" fill="#3b82f6" radius={[3, 3, 0, 0]}>
          <LabelList
            dataKey="Atual"
            position="top"
            style={{ fontSize: 10, fill: '#94a3b8' }}
            formatter={(v: unknown) => Number(v).toFixed(2)}
          />
        </Bar>
        {previousWeek && <Bar dataKey="Semana ant." fill="#94a3b8" radius={[3, 3, 0, 0]} />}
        {sameWeekLastYear && <Bar dataKey="Ano anterior" fill="#64748b" radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  )
}

// Backward compat export
export function KpiComparisonChart(props: Props) {
  return <MonetaryKpiChart {...props} />
}
