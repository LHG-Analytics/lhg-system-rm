'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'
import { GuiaShareChart } from '../charts/guia-share-chart'
import { cn } from '@/lib/utils'

interface Props {
  data: WeeklyReportData['discounts']
}

export function DiscountsSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  const shareDelta = data.guiaSharePct - data.guiaSharePrevWeek
  const shareStatus =
    data.guiaSharePct < 15 ? 'low' : data.guiaSharePct > 40 ? 'high' : 'ok'

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">⑥ Descontos Guia de Motéis</h3>
          <span className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            shareStatus === 'ok' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          )}>
            Participação {data.guiaSharePct.toFixed(1)}%
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <GuiaShareChart currentPct={data.guiaSharePct} prevPct={data.guiaSharePrevWeek} />
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Participação no período</p>
                <p className={cn('text-lg font-semibold', shareStatus !== 'ok' ? 'text-amber-600' : 'text-emerald-600')}>
                  {data.guiaSharePct.toFixed(1)}%
                </p>
                {data.guiaSharePrevWeek > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {shareDelta >= 0 ? '+' : ''}{shareDelta.toFixed(1)} p.p. vs sem. ant.
                  </p>
                )}
              </div>
              {data.discountProposalsApprovedThisWeek > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Propostas de desconto aprovadas</p>
                  <p className="font-medium">{data.discountProposalsApprovedThisWeek}</p>
                </div>
              )}
              {data.topDiscountImpact && (
                <div>
                  <p className="text-xs text-muted-foreground">Maior impacto</p>
                  <p className="text-sm">{data.topDiscountImpact}</p>
                </div>
              )}
            </div>
          </div>

          {data.activeDiscounts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Descontos ativos</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Categoria</th>
                    <th className="text-left pb-1 font-medium">Período</th>
                    <th className="text-left pb-1 font-medium">Dia</th>
                    <th className="text-left pb-1 font-medium">Faixa</th>
                    <th className="text-right pb-1 font-medium">Desconto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activeDiscounts.slice(0, 10).map((d, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5">{d.categoria}</td>
                      <td>{d.periodo}</td>
                      <td className="capitalize">{d.diaSemana}</td>
                      <td className="text-muted-foreground text-xs">{d.faixaHoraria}</td>
                      <td className="text-right font-medium">{d.valor}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
