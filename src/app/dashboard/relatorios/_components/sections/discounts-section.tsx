'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'
import { cn } from '@/lib/utils'

interface Props {
  data: WeeklyReportData['discounts']
}

export function DiscountsSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  const shareDelta = data.guiaSharePct - data.guiaSharePrevWeek
  const shareStatus = data.guiaSharePct > 20 ? 'high' : data.guiaSharePct < 5 ? 'low' : 'ok'

  const DeltaIcon = shareDelta > 0.5 ? TrendingUp : shareDelta < -0.5 ? TrendingDown : Minus

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
            shareStatus === 'ok'   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
            shareStatus === 'low'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          )}>
            Participação {data.guiaSharePct.toFixed(1)}%
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {/* Explicação + 3 cards de participação */}
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              % das reservas via planos Go e Programado do Guia de Motéis. Faixa saudável: 5–20%. Abaixo de 5% = invisível no canal (considere aumentar desconto); acima de 20% = dependência excessiva (avalie reduzir desconto para melhorar margem).
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Período anterior</p>
                <p className="text-xl font-semibold">
                  {data.guiaSharePrevWeek > 0 ? `${data.guiaSharePrevWeek.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className={cn(
                'rounded-lg p-3 text-center border-2',
                shareStatus === 'ok'  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' :
                shareStatus === 'low' ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' :
                'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
              )}>
                <p className="text-xs text-muted-foreground mb-1">Este período</p>
                <p className={cn(
                  'text-xl font-semibold',
                  shareStatus === 'ok'  ? 'text-emerald-700 dark:text-emerald-400' :
                  shareStatus === 'low' ? 'text-blue-700 dark:text-blue-400' :
                  'text-amber-700 dark:text-amber-400'
                )}>
                  {data.guiaSharePct.toFixed(1)}%
                </p>
                {data.guiaSharePrevWeek > 0 && (
                  <p className={cn(
                    'text-xs flex items-center justify-center gap-0.5 mt-0.5',
                    shareDelta > 0 ? 'text-destructive' : shareDelta < 0 ? 'text-emerald-600' : 'text-muted-foreground'
                  )}>
                    <DeltaIcon className="w-3 h-3" />
                    {shareDelta >= 0 ? '+' : ''}{shareDelta.toFixed(1)} p.p.
                  </p>
                )}
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center border border-dashed">
                <p className="text-xs text-muted-foreground mb-1">Faixa saudável</p>
                <p className="text-xl font-semibold text-muted-foreground">5–20%</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {shareStatus === 'low' ? 'invisível no canal' : shareStatus === 'high' ? 'dependência excessiva' : 'participação ideal'}
                </p>
              </div>
            </div>
          </div>

          {data.discountProposalsApprovedThisWeek > 0 && (
            <p className="text-xs text-muted-foreground">
              {data.discountProposalsApprovedThisWeek} proposta(s) de desconto aprovada(s) neste período.
            </p>
          )}

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
