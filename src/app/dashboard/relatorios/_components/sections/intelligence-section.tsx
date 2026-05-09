'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['intelligence']
}

export function IntelligenceSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑩ O que o agente aprendeu no período</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {data.weekHighlight && (
            <div className="text-sm bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Destaque do período</p>
              <p>{data.weekHighlight}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Novas lições" value={data.newLessonsCount} />
            <Stat label="Elasticidades calculadas" value={data.elasticityUpdatedCount} />
            <Stat label="Anomalias detectadas" value={data.anomaliesDetected.length} accent="amber" />
            <Stat label="Anomalias resolvidas" value={data.anomaliesResolved.length} accent="emerald" />
          </div>

          {data.anomaliesDetected.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Anomalias abertas</p>
              <div className="space-y-1">
                {data.anomaliesDetected.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-medium">{a.metric}</span>
                    <span className={cn('text-xs', a.direction === 'negative_outlier' ? 'text-destructive' : 'text-emerald-600')}>
                      {a.direction === 'negative_outlier' ? '↓' : '↑'} z={a.zScore.toFixed(1)}σ
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{a.scope}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'amber' | 'emerald' }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-xl font-semibold',
        accent === 'amber' && value > 0 ? 'text-amber-600' :
        accent === 'emerald' && value > 0 ? 'text-emerald-600' : ''
      )}>
        {value}
      </p>
    </div>
  )
}
