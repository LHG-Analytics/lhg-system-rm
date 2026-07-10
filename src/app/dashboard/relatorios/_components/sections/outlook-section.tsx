'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { WeeklyReportData } from '@/lib/reports/types'
import { SeasonalOutlookChart } from '../charts/seasonal-outlook-chart'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['outlook']
}

export function OutlookSection({ data }: Props) {
  const [open, setOpen] = useState(true)
  const { formatMoney: fm } = useCurrency()

  const hasContent = data.seasonalFactors.length > 0 || data.upcomingEvents.length > 0 || data.revenueForecast.length > 0

  if (!hasContent) return null

  const hotDays = data.seasonalFactors.filter(f => f.level === 'hot').length
  const coldDays = data.seasonalFactors.filter(f => f.level === 'cold').length

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">⑧ Outlook — próximas 2 semanas</h3>
          {hotDays > 0 && <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">{hotDays} dia(s) quente(s)</span>}
          {coldDays > 0 && <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">{coldDays} dia(s) fraco(s)</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5">
          {data.seasonalFactors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sazonalidade histórica</p>
              <SeasonalOutlookChart data={data.seasonalFactors} />
              <p className="text-xs text-muted-foreground mt-1">1.0x = normal · acima 1.15x = quente · abaixo 0.85x = frio</p>
            </div>
          )}

          {data.upcomingEvents.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Eventos cadastrados</p>
              <div className="space-y-2">
                {data.upcomingEvents.map((e, i) => (
                  <div key={i} className={cn(
                    'flex items-start gap-3 rounded-lg p-3 text-sm',
                    e.eventType === 'positivo' ? 'bg-emerald-50 dark:bg-emerald-950/20' :
                    e.eventType === 'negativo' ? 'bg-red-50 dark:bg-red-950/20' : 'bg-muted/50'
                  )}>
                    <div className="shrink-0 text-xs text-muted-foreground pt-0.5">
                      {format(new Date(e.eventDate + 'T12:00:00Z'), 'dd/MM', { locale: ptBR })}
                    </div>
                    <div>
                      <p className="font-medium">{e.title}</p>
                      {e.impactDescription && <p className="text-xs text-muted-foreground">{e.impactDescription}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.revenueForecast.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Previsão de receita</p>
              <div className="grid grid-cols-3 gap-3 mb-2">
                {data.revenueForecast.slice(0, 3).map((m, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="text-xs text-muted-foreground mb-1 capitalize">{m.month}</p>
                    <p className="font-semibold">{fm(m.projected)}</p>
                    {m.budgeted > 0 && (
                      <p className={cn('text-xs', m.gapPct >= -2 ? 'text-emerald-600' : m.gapPct >= -8 ? 'text-amber-600' : 'text-destructive')}>
                        {m.gapPct >= 0 ? '+' : ''}{m.gapPct.toFixed(1)}% vs meta
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Metodologia: mês atual = projeção do ERP com base no ritmo diário acumulado × dias restantes.
                Meses seguintes = orçamento ajustado pelo ritmo atual com amortecimento 50% → 25%
                (desvio não é extrapolado — evita superestimar anomalias pontuais).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
