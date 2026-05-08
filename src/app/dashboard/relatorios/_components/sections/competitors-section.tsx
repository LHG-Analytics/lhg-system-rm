'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['competitors']
}

const positionConfig = {
  underprice: { label: 'Abaixo', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/20' },
  aligned:    { label: 'Alinhado', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20' },
  overprice:  { label: 'Acima', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20' },
}

export function CompetitorsSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  if (data.gaps.length === 0) return null

  const dominant = positionConfig[data.dominantPosition]

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">⑧ Inteligência competitiva</h3>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', dominant.color)}>
            {dominant.label}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left pb-1 font-medium">Categoria / Período</th>
                <th className="text-right pb-1 font-medium">Nosso</th>
                <th className="text-right pb-1 font-medium">Mediana conc.</th>
                <th className="text-right pb-1 font-medium">Gap</th>
                <th className="text-right pb-1 font-medium">Posição</th>
              </tr>
            </thead>
            <tbody>
              {data.gaps.slice(0, 12).map((g, i) => {
                const pc = positionConfig[g.position]
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{g.categoria} {g.periodo} ({g.diaTipo})</td>
                    <td className="text-right">R$ {g.precoNosso.toFixed(2)}</td>
                    <td className="text-right">R$ {g.medianaConc.toFixed(2)}</td>
                    <td className={cn('text-right font-medium',
                      g.gapPct > 5 ? 'text-amber-600' : g.gapPct < -5 ? 'text-blue-600' : 'text-muted-foreground'
                    )}>
                      {g.gapPct > 0 ? '+' : ''}{g.gapPct.toFixed(1)}%
                    </td>
                    <td className="text-right">
                      <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', pc.color)}>
                        {pc.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
