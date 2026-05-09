'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface SeasonalFactor {
  date: string
  dowLabel: string
  factorRevpar: number
  level: 'hot' | 'normal' | 'cold'
}

export function SeasonalOutlookChart({ data }: { data: SeasonalFactor[] }) {
  const chartData = data.map(d => ({
    name: format(new Date(d.date + 'T12:00:00Z'), 'dd/MM', { locale: ptBR }),
    fator: d.factorRevpar,
    level: d.level,
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={1} />
        <YAxis domain={[0.5, 1.8]} tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}x`} />
        <Tooltip formatter={(value: unknown) => [`${Number(value).toFixed(2)}x`, 'Fator RevPAR']} />
        <ReferenceLine y={1} stroke="#64748b" strokeDasharray="3 3" />
        <ReferenceLine y={1.15} stroke="#10b981" strokeDasharray="2 2" opacity={0.7} />
        <ReferenceLine y={0.85} stroke="#ef4444" strokeDasharray="2 2" opacity={0.7} />
        <Area
          type="monotone"
          dataKey="fator"
          stroke="#3b82f6"
          fill="#3b82f620"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
