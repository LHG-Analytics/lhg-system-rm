'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from 'recharts'
import type { KPISnapshot } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  current: KPISnapshot
  previousWeek: KPISnapshot | null
  sameWeekLastYear: KPISnapshot | null
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#0f0f11',
    border: '1px solid #27272a',
    borderRadius: '6px',
    fontSize: '11px',
    color: '#f4f4f5',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    padding: '8px 12px',
  },
  labelStyle: { color: '#71717a', marginBottom: 4, fontSize: '10px' },
  itemStyle: { color: '#e4e4e7', padding: '2px 0' },
}

const MONETARY_METRICS = [
  { key: 'revpar' as keyof KPISnapshot, label: 'RevPAR' },
  { key: 'trevpar' as keyof KPISnapshot, label: 'TRevPAR' },
  { key: 'ticket' as keyof KPISnapshot, label: 'Ticket' },
]

const COLOR_PREV = '#94a3b8'
const COLOR_YEAR = '#64748b'

function compactMoney(v: number, symbol: string): string {
  if (v >= 1000) return `${symbol}${(v / 1000).toFixed(1)}k`
  return `${symbol}${v.toFixed(0)}`
}

// Atual: label acima da barra em violeta; comparações: label dentro no topo em branco
function makeLabelRenderer(isAtual: boolean, fmt: (v: unknown) => string) {
  return (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props
    if (value == null || value === '') return null
    const label = fmt(value)
    const cx = x + width / 2
    if (isAtual) {
      return (
        <text x={cx} y={y - 4} textAnchor="middle" fontSize={9} fill="#818cf8" fontWeight={700}>
          {label}
        </text>
      )
    }
    return (
      <text x={cx} y={y + 11} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.78)" fontWeight={600}>
        {label}
      </text>
    )
  }
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: '#71717a' }}>{label}</span>
    </div>
  )
}

function LegendRow({ hasPrev, hasYear }: { hasPrev: boolean; hasYear: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 6 }}>
      <LegendDot color="#818cf8" label="Atual" />
      {hasPrev && <LegendDot color={COLOR_PREV} label="Sem.ant." />}
      {hasYear && <LegendDot color={COLOR_YEAR} label="Ano ant." />}
    </div>
  )
}

export function MonetaryKpiChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const { symbol } = useCurrency()

  const data = MONETARY_METRICS.map(m => ({
    name: m.label,
    Atual: current[m.key],
    'Sem.ant.': previousWeek ? previousWeek[m.key] : undefined,
    'Ano ant.': sameWeekLastYear ? sameWeekLastYear[m.key] : undefined,
  }))

  const fmtMoney = (v: unknown) => compactMoney(Number(v), symbol)

  return (
    <div className="w-full" data-pdf-height="80">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={data}
          barSize={44}
          barGap={3}
          barCategoryGap="10%"
          margin={{ top: 26, right: 6, bottom: 0, left: 6 }}
        >
          <defs>
            <linearGradient id="kpi-atual-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          {/* YAxis oculto — mantém o domain para calcular alturas das barras */}
          <YAxis hide width={0} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(99,102,241,0.07)' }}
            formatter={(value: unknown, name: unknown) => {
              const v = Number(value)
              const n = String(name)
              return [`${symbol} ${v.toFixed(2)}`, n]
            }}
          />
          <Bar dataKey="Atual" fill="url(#kpi-atual-grad)" radius={[3, 3, 0, 0]}>
            <LabelList dataKey="Atual" content={makeLabelRenderer(true, fmtMoney) as any} />
          </Bar>
          {previousWeek && (
            <Bar dataKey="Sem.ant." fill={COLOR_PREV} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="Sem.ant." content={makeLabelRenderer(false, fmtMoney) as any} />
            </Bar>
          )}
          {sameWeekLastYear && (
            <Bar dataKey="Ano ant." fill={COLOR_YEAR} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="Ano ant." content={makeLabelRenderer(false, fmtMoney) as any} />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
      <LegendRow hasPrev={!!previousWeek} hasYear={!!sameWeekLastYear} />
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

  const fmtGiro = (v: unknown) => Number(v).toFixed(2)

  return (
    <div className="w-full" data-pdf-height="50">
      <ResponsiveContainer width="100%" height={90}>
        <BarChart
          data={data}
          barSize={60}
          barGap={5}
          barCategoryGap="8%"
          margin={{ top: 24, right: 6, bottom: 0, left: 6 }}
        >
          <defs>
            <linearGradient id="kpi-giro-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <YAxis hide width={0} domain={[0, 'auto']} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(99,102,241,0.07)' }}
            formatter={(value: unknown, name: unknown) => [Number(value).toFixed(2), String(name)]}
          />
          <Bar dataKey="Atual" fill="url(#kpi-giro-grad)" radius={[3, 3, 0, 0]}>
            <LabelList dataKey="Atual" content={makeLabelRenderer(true, fmtGiro) as any} />
          </Bar>
          {previousWeek && (
            <Bar dataKey="Sem.ant." fill={COLOR_PREV} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="Sem.ant." content={makeLabelRenderer(false, fmtGiro) as any} />
            </Bar>
          )}
          {sameWeekLastYear && (
            <Bar dataKey="Ano ant." fill={COLOR_YEAR} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="Ano ant." content={makeLabelRenderer(false, fmtGiro) as any} />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
      <LegendRow hasPrev={!!previousWeek} hasYear={!!sameWeekLastYear} />
    </div>
  )
}

// Backward compat export
export function KpiComparisonChart(props: Props) {
  return <MonetaryKpiChart {...props} />
}
