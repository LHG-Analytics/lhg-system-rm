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

export function KpiComparisonChart({ current, previousWeek, sameWeekLastYear }: Props) {
  const data = METRICS.map(m => ({
    name: m.label,
    Atual: current[m.key],
    'Sem. Ant.': previousWeek ? previousWeek[m.key] : undefined,
    'Mesmo LY': sameWeekLastYear ? sameWeekLastYear[m.key] : undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip
          formatter={(value: unknown, name: unknown) => {
            const v = Number(value)
            const n = String(name)
            return [METRICS.find(m => m.label === n)?.prefix ? `R$ ${v.toFixed(2)}` : v.toFixed(2), n]
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Atual" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        {previousWeek && <Bar dataKey="Sem. Ant." fill="hsl(var(--muted-foreground))" opacity={0.6} radius={[3, 3, 0, 0]} />}
        {sameWeekLastYear && <Bar dataKey="Mesmo LY" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[3, 3, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  )
}
