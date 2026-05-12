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
    // Sem overflow-hidden — tooltip precisa flutuar livremente acima do chart
    <div className="w-full" data-pdf-height="65">
      <ResponsiveContainer width="100%" height={115}>
        <BarChart data={data} barSize={14} barGap={2} barCategoryGap="20%" margin={{ top: 22, right: 10, bottom: 2, left: 0 }}>
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
          <Bar dataKey="Atual" fill={COLOR_ATUAL} radius={[2, 2, 0, 0]}>
            <LabelList
              dataKey="Atual"
              position="top"
              style={{ fontSize: 8, fill: '#818cf8', fontWeight: 700 }}
              formatter={(v: unknown) => compactMoney(Number(v), symbol)}
            />
          </Bar>
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
    // Sem overflow-hidden — tooltip precisa flutuar livremente acima do chart
    <div className="w-full" data-pdf-height="40">
      <ResponsiveContainer width="100%" height={65}>
        <BarChart data={data} barSize={28} barGap={3} barCategoryGap="25%" margin={{ top: 20, right: 10, bottom: 2, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={28} domain={[0, 'auto']} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={false}
            formatter={(value: unknown, name: unknown) => [Number(value).toFixed(2), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Bar dataKey="Atual" fill={COLOR_ATUAL} radius={[2, 2, 0, 0]}>
            <LabelList
              dataKey="Atual"
              position="top"
              style={{ fontSize: 8, fill: '#818cf8', fontWeight: 700 }}
              formatter={(v: unknown) => Number(v).toFixed(2)}
            />
          </Bar>
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
