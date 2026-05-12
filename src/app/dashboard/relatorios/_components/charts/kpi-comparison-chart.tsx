'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
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

const COLOR_ATUAL = '#6366f1'
const COLOR_PREV  = '#94a3b8'
const COLOR_YEAR  = '#64748b'

function compactMoney(v: number, symbol: string): string {
  if (v >= 1000) return `${symbol}${(v / 1000).toFixed(1)}k`
  return `${symbol}${v.toFixed(0)}`
}

export function MonetaryKpiChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const { symbol } = useCurrency()

  const data = MONETARY_METRICS.map(m => ({
    name: m.label,
    Atual: current[m.key],
    'Sem.ant.': previousWeek ? previousWeek[m.key] : undefined,
    'Ano ant.': sameWeekLastYear ? sameWeekLastYear[m.key] : undefined,
  }))

  return (
    <div className="w-full overflow-hidden" data-pdf-height="55">
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} maxBarSize={18} barCategoryGap="20%" barGap={2} margin={{ top: 6, right: 6, bottom: 2, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 9 }} width={36} tickFormatter={v => compactMoney(Number(v), symbol)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={false}
            formatter={(value: unknown, name: unknown, item: unknown) => {
              const v = Number(value)
              const n = String(name)
              const metricName = (item as { payload?: { name?: string } })?.payload?.name ?? ''
              const isMoney = MONETARY_METRIC_LABELS.includes(metricName)
              return [isMoney ? `${symbol} ${v.toFixed(2)}` : v.toFixed(2), n]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Bar dataKey="Atual" fill={COLOR_ATUAL} radius={[2, 2, 0, 0]} />
          {previousWeek && <Bar dataKey="Sem.ant." fill={COLOR_PREV} radius={[2, 2, 0, 0]} />}
          {sameWeekLastYear && <Bar dataKey="Ano ant." fill={COLOR_YEAR} radius={[2, 2, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function GiroKpiChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const data = [
    {
      name: 'Giro',
      Atual: current.giro,
      'Sem.ant.': previousWeek?.giro ?? undefined,
      'Ano ant.': sameWeekLastYear?.giro ?? undefined,
    },
  ]

  return (
    <div className="w-full overflow-hidden" data-pdf-height="38">
      <ResponsiveContainer width="100%" height={60}>
        <BarChart data={data} maxBarSize={24} barCategoryGap="20%" barGap={2} margin={{ top: 6, right: 6, bottom: 2, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={28} domain={[0, 'auto']} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={false}
            formatter={(value: unknown, name: unknown) => [Number(value).toFixed(2), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Bar dataKey="Atual" fill={COLOR_ATUAL} radius={[2, 2, 0, 0]} />
          {previousWeek && <Bar dataKey="Sem.ant." fill={COLOR_PREV} radius={[2, 2, 0, 0]} />}
          {sameWeekLastYear && <Bar dataKey="Ano ant." fill={COLOR_YEAR} radius={[2, 2, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Backward compat export
export function KpiComparisonChart(props: Props) {
  return <MonetaryKpiChart {...props} />
}
