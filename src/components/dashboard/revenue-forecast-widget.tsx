'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ForecastResult } from '@/lib/forecast/revenue-forecast'

interface Props {
  forecast: ForecastResult | null
}

function fmtBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n)
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function GapBadge({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="text-xs text-muted-foreground">—</span>
  const cls =
    gap >= -2  ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' :
    gap >= -8  ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' :
                 'text-destructive bg-destructive/10'
  const Icon = gap > 0 ? TrendingUp : gap < -2 ? TrendingDown : Minus
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium', cls)}>
      <Icon className="size-2.5" />
      {fmtPct(gap)}
    </span>
  )
}

function ProgressBar({ projected, budget }: { projected: number | null; budget: number | null }) {
  if (projected == null || budget == null || budget === 0) return null
  const pct = Math.min(140, (projected / budget) * 100)
  const isOver = projected >= budget
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', isOver ? 'bg-emerald-500' : projected / budget >= 0.92 ? 'bg-amber-400' : 'bg-destructive/60')}
        style={{ width: `${pct}%` }}
      />
      {/* linha de meta */}
      <div className="absolute inset-y-0 left-[calc(100%/140*100)] w-px bg-border" style={{ left: `${(100 / 140) * 100}%` }} />
    </div>
  )
}

export function RevenueForecastWidget({ forecast }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('forecast-collapsed')
    if (stored === 'true') setCollapsed(true)
  }, [])

  function toggle() {
    setCollapsed((v) => {
      localStorage.setItem('forecast-collapsed', String(!v))
      return !v
    })
  }

  if (!forecast) return null
  const { months, total_projected, total_budget, total_gap_pct, pace_ratio } = forecast
  if (!months.some(m => m.projected != null || m.budget != null)) return null

  const paceColor =
    pace_ratio == null ? '' :
    pace_ratio >= 1.02  ? 'text-emerald-600' :
    pace_ratio < 0.96   ? 'text-destructive' :
    'text-amber-600'

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Previsão de Receita</span>
          {collapsed && pace_ratio != null && (
            <span className={cn('text-xs font-medium', paceColor)}>
              {(pace_ratio * 100).toFixed(0)}% do orçado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {collapsed && total_projected != null && (
            <span className="text-xs text-muted-foreground">{fmtBRL(total_projected)} · 3 meses</span>
          )}
          {collapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          {/* Meses */}
          <div className="flex flex-col gap-3">
            {months.map((m) => (
              <div key={`${m.year}-${m.month}`} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('text-sm font-medium', m.is_current && 'text-primary')}>
                      {m.label}
                    </span>
                    {m.is_current && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary">atual</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <GapBadge gap={m.gap_pct} />
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">
                        {m.projected != null ? fmtBRL(m.projected) : '—'}
                      </div>
                      {m.budget != null && (
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          meta {fmtBRL(m.budget)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <ProgressBar projected={m.projected} budget={m.budget} />
              </div>
            ))}
          </div>

          {/* Total */}
          {total_projected != null && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">Total 3 meses</span>
              <div className="flex items-center gap-2">
                {total_gap_pct != null && <GapBadge gap={total_gap_pct} />}
                <span className="text-sm font-semibold tabular-nums">{fmtBRL(total_projected)}</span>
                {total_budget != null && (
                  <span className="text-xs text-muted-foreground">/ {fmtBRL(total_budget)}</span>
                )}
              </div>
            </div>
          )}

          {/* Nota do pace */}
          {pace_ratio != null && (
            <p className={cn('mt-2 text-[11px]', paceColor)}>
              {pace_ratio > 1.02
                ? `Ritmo atual ${(pace_ratio * 100).toFixed(0)}% do orçado — postura conservadora nos próximos meses pode proteger margem.`
                : pace_ratio < 0.96
                ? `Ritmo atual ${(pace_ratio * 100).toFixed(0)}% do orçado — propostas mais agressivas são justificadas para recuperar o gap.`
                : `Ritmo atual ${(pace_ratio * 100).toFixed(0)}% do orçado — alinhado com a meta.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
