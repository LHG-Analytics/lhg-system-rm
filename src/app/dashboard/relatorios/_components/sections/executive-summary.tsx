'use client'

import { cn } from '@/lib/utils'
import { TrendingUp, AlertTriangle, Minus, ArrowRight, BotMessageSquare, Settings2, Sparkles, Eye, TrendingDown } from 'lucide-react'
import Link from 'next/link'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['executiveSummary']
  opportunities: WeeklyReportData['opportunities']
  aiSummary: string | null
}

export function ExecutiveSummary({ data, opportunities, aiSummary }: Props) {
  const toneConfig = {
    positive: { border: 'border-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20', icon: TrendingUp, iconColor: 'text-emerald-600' },
    neutral:  { border: 'border-border', bg: 'bg-card', icon: Minus, iconColor: 'text-muted-foreground' },
    warning:  { border: 'border-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', icon: AlertTriangle, iconColor: 'text-amber-600' },
  }
  const config = toneConfig[data.tone]
  const Icon = config.icon
  const topOpportunities = opportunities.slice(0, 3)

  return (
    <div className="space-y-3">
      <div className={cn('rounded-xl border-2 p-5 space-y-4', config.border, config.bg)}>
        <div className="flex items-start gap-3">
          <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', config.iconColor)} />
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{data.headline}</h3>
            {aiSummary && aiSummary !== data.headline && !data.diagnosis && (
              <p className="text-sm text-muted-foreground mt-1">{aiSummary}</p>
            )}
          </div>
        </div>

        {data.diagnosis && (
          <div className="flex items-start gap-2.5 pl-1">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary/70" />
            <p className="text-sm leading-relaxed text-foreground/90">{data.diagnosis}</p>
          </div>
        )}

        {data.keyPoints.length > 0 && (
          <ul className="space-y-1 pl-1">
            {data.keyPoints.map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span>•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(data.priorityAction || topOpportunities.length > 0) && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Plano de ação — o que fazer agora</p>

          {data.priorityAction && (
            <div className="flex items-start gap-3">
              <ArrowRight className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{data.priorityAction}</p>
              </div>
            </div>
          )}

          {data.agentPromptLink && data.actionType !== 'none' && (
            <Link
              href={data.agentPromptLink}
              className={cn(
                'flex items-center gap-2 w-fit px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              <BotMessageSquare className="w-4 h-4 shrink-0" />
              {data.actionType === 'price_proposal' && 'Gerar proposta de preços no Agente RM →'}
              {data.actionType === 'discount_proposal' && 'Gerar proposta de descontos no Agente RM →'}
              {data.actionType === 'agent_config' && 'Ajustar estratégia no Agente RM →'}
            </Link>
          )}

          {topOpportunities.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {topOpportunities.map((o, i) => {
                const isBelow = o.direction === 'below'
                const DirIcon = isBelow ? TrendingDown : TrendingUp
                return (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg bg-background/60 border border-border/60 p-2.5">
                    <span className="flex items-center justify-center size-5 rounded-full bg-muted text-[11px] font-semibold shrink-0 mt-0.5">{i + 1}</span>
                    <DirIcon className={cn('w-3.5 h-3.5 mt-1 shrink-0', isBelow ? 'text-amber-600' : 'text-emerald-600')} />
                    <p className="text-xs flex-1 min-w-0">{o.suggestion}</p>
                    <Link href={o.agentPromptLink} className="text-[11px] font-medium text-primary hover:underline shrink-0 whitespace-nowrap mt-0.5">
                      Analisar →
                    </Link>
                  </div>
                )
              })}
            </div>
          )}

          {data.agentConfigSuggestion && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-2">
              <Settings2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
              <span><span className="font-medium text-amber-600">Configuração sugerida:</span> {data.agentConfigSuggestion}</span>
            </div>
          )}
        </div>
      )}

      {data.watchNextWeek && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
          <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium text-foreground/80">Observar na próxima semana:</span> {data.watchNextWeek}</span>
        </div>
      )}
    </div>
  )
}
