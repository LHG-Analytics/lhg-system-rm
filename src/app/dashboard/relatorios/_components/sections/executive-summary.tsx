'use client'

import { cn } from '@/lib/utils'
import { TrendingUp, AlertTriangle, Minus, ArrowRight } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['executiveSummary']
  aiSummary: string | null
}

export function ExecutiveSummary({ data, aiSummary }: Props) {
  const toneConfig = {
    positive: { border: 'border-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20', icon: TrendingUp, iconColor: 'text-emerald-600' },
    neutral:  { border: 'border-border', bg: 'bg-card', icon: Minus, iconColor: 'text-muted-foreground' },
    warning:  { border: 'border-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', icon: AlertTriangle, iconColor: 'text-amber-600' },
  }
  const config = toneConfig[data.tone]
  const Icon = config.icon

  return (
    <div className="space-y-3">
      <div className={cn('rounded-xl border-2 p-5 space-y-4', config.border, config.bg)}>
        <div className="flex items-start gap-3">
          <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', config.iconColor)} />
          <div>
            <h3 className="font-semibold text-base">{data.headline}</h3>
            {aiSummary && aiSummary !== data.headline && (
              <p className="text-sm text-muted-foreground mt-1">{aiSummary}</p>
            )}
          </div>
        </div>

        <ul className="space-y-1">
          {data.keyPoints.map((p, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Destaque</p>
            <p>{data.mainWin || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">Atenção</p>
            <p>{data.mainConcern || '—'}</p>
          </div>
        </div>
      </div>

      {data.priorityAction && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
          <ArrowRight className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Ação prioritária para o próximo período</p>
            <p className="text-sm font-medium">{data.priorityAction}</p>
          </div>
        </div>
      )}
    </div>
  )
}
