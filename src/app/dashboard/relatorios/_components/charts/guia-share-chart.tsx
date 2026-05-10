'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface Props {
  currentPct: number
  prevPct: number
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

export function GuiaShareChart({ currentPct, prevPct }: Props) {
  const data = [
    { name: 'Per. ant.', share: prevPct },
    { name: 'Este per.', share: currentPct },
  ]

  return (
    <ResponsiveContainer width="100%" height={100}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 30]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'Participação no Guia']}
        />
        <ReferenceLine y={5}  stroke="#ef4444" strokeDasharray="3 3" label={{ value: '5%',  fontSize: 10 }} />
        <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '20%', fontSize: 10 }} />
        <Line type="monotone" dataKey="share" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
