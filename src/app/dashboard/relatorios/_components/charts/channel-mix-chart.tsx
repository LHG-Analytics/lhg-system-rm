'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface ChannelItem {
  canal: string
  label: string
  reservas: number
  receita: number
  representatividade: number
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--primary)/0.7)', 'hsl(var(--primary)/0.5)', 'hsl(var(--primary)/0.35)', 'hsl(var(--primary)/0.2)']

export function ChannelMixChart({ data }: { data: ChannelItem[] }) {
  const sorted = [...data].sort((a, b) => b.representatividade - a.representatividade).slice(0, 5)

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(0)}%`} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={90} />
        <Tooltip formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'Representatividade']} />
        <Bar dataKey="representatividade" radius={[0, 3, 3, 0]}>
          {sorted.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
