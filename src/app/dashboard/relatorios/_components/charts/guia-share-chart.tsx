'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface Props {
  currentPct: number
  prevPct: number
}

export function GuiaShareChart({ currentPct, prevPct }: Props) {
  const data = [
    { name: 'Sem. ant.', share: prevPct },
    { name: 'Esta sem.', share: currentPct },
  ]

  return (
    <ResponsiveContainer width="100%" height={100}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 50]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
        <Tooltip formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'Participação no Guia']} />
        <ReferenceLine y={15} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '15%', fontSize: 10 }} />
        <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '40%', fontSize: 10 }} />
        <Line type="monotone" dataKey="share" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
