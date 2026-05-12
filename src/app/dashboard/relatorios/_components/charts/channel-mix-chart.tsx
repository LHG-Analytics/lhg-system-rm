'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'

interface ChannelItem {
  canal: string
  label: string
  reservas: number
  receita: number
  representatividade: number
}

const COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981']

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

export function ChannelMixChart({ data }: { data: ChannelItem[] }) {
  const sorted = [...data].sort((a, b) => b.representatividade - a.representatividade).slice(0, 5)

  return (
    <div className="w-full overflow-hidden" data-pdf-height="75">
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 0 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(0)}%`} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={90} />
        <Tooltip
          {...TOOLTIP_STYLE}
          cursor={false}
          formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'Participação']}
        />
        <Bar dataKey="representatividade" radius={[0, 3, 3, 0]}>
          {sorted.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          <LabelList
            dataKey="representatividade"
            position="right"
            style={{ fontSize: 10, fill: '#94a3b8' }}
            formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  )
}
