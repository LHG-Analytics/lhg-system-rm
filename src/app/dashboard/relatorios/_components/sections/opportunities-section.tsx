'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, BotMessageSquare } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['opportunities']
}

const DIMENSION_LABEL: Record<string, string> = {
  periodo: 'Período',
  turno: 'Turno',
  dia_semana: 'Dia da semana',
}

export function OpportunitiesSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  if (!data.length) return null

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑦ Oportunidades e plano de ação</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-2">
          <p className="text-xs text-muted-foreground mb-2">
            Desvios de giro/RevPAR de pelo menos 25% em relação à média da própria categoria — calculados a partir dos dados do período, não gerados pela IA.
          </p>

          {data.map((o, i) => {
            const isBelow = o.direction === 'below'
            const Icon = isBelow ? TrendingDown : TrendingUp
            return (
              <div
                key={i}
                className={cn(
                  'rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
                  isBelow ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10' : 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/10'
                )}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', isBelow ? 'text-amber-600' : 'text-emerald-600')} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold">{o.categoria}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                        {DIMENSION_LABEL[o.dimension] ?? o.dimension}: {o.label}
                      </span>
                      <span className={cn('text-xs font-semibold', isBelow ? 'text-amber-600' : 'text-emerald-600')}>
                        {o.gapPct >= 0 ? '+' : ''}{o.gapPct.toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm">{o.suggestion}</p>
                  </div>
                </div>

                <Link
                  href={o.agentPromptLink}
                  className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-primary hover:underline whitespace-nowrap self-start sm:self-center"
                >
                  <BotMessageSquare className="w-3.5 h-3.5" />
                  Analisar no Agente RM
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
