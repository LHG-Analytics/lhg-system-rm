'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['budgetTracking']
}

export function BudgetTracking({ data }: Props) {
  const { formatMoney: fmt } = useCurrency()
  // Quando sem meta, escala em relação à projeção (projeção = 100%)
  const ref = data.meta > 0 ? data.meta : data.projecao
  const progressPct = ref > 0 ? Math.min((data.realizado / ref) * 100, 100) : 100
  const projecaoPct = data.meta > 0 ? Math.min((data.projecao / ref) * 100, 100) : 100
  const gapPct = data.meta > 0 ? ((data.projecao - data.meta) / data.meta) * 100 : 0

  const gapColor = gapPct >= -2 ? 'text-emerald-600' : gapPct >= -8 ? 'text-amber-600' : 'text-destructive'

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4 print:break-inside-avoid">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Meta × Previsão × Realizado</h3>
          <p className="text-xs text-muted-foreground capitalize">{data.monthName}</p>
        </div>
        {data.meta > 0 && (
          <span className={cn('text-sm font-semibold', gapColor)}>
            {gapPct >= 0 ? '+' : ''}{gapPct.toFixed(1)}% vs meta
          </span>
        )}
      </div>

      {/* Progress bars */}
      <div className="space-y-3">
        <ProgressRow label="Realizado" value={data.realizado} pct={progressPct} color="bg-primary" />
        {data.projecao > data.realizado && (
          <ProgressRow label="Projeção" value={data.projecao} pct={projecaoPct} color="bg-primary/40" />
        )}
        {data.meta > 0 && (
          <ProgressRow label="Meta" value={data.meta} pct={100} color="bg-muted" isMeta />
        )}
      </div>

      {/* Ritmo */}
      <div className="grid grid-cols-3 gap-3 text-sm pt-1">
        <div>
          <p className="text-xs text-muted-foreground">Ritmo atual</p>
          <p className="font-medium">{fmt(data.paceDiarioAtual)}/dia</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Ritmo necessário</p>
          {data.meta > 0 ? (
            <p className={cn('font-medium', data.paceDiarioNecessario > data.paceDiarioAtual ? 'text-amber-600' : 'text-emerald-600')}>
              {fmt(data.paceDiarioNecessario)}/dia
            </p>
          ) : (
            <p className="font-medium text-muted-foreground">Sem meta</p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Dias restantes</p>
          <p className="font-medium">{data.monthDaysTotal - data.monthDaysElapsed} dias</p>
        </div>
      </div>

      {data.aiLeverageComment && (
        <div className="flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{data.aiLeverageComment}</p>
        </div>
      )}
    </div>
  )
}

function ProgressRow({ label, value, pct, color, isMeta }: {
  label: string; value: number; pct: number; color: string; isMeta?: boolean
}) {
  const { formatMoney } = useCurrency()
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{formatMoney(value)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden print:bg-zinc-300">
        <div className={cn('h-full rounded-full transition-all print:!bg-zinc-600', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
