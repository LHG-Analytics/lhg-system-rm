'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['evolution']
}

const KPI_LABELS: Record<string, string> = {
  revpar: 'RevPAR',
  giro: 'Giro',
  ocupacao: 'Ocupação',
  ticket: 'Ticket Médio',
  receita: 'Receita',
  tmo: 'TMO',
}

export function EvolutionBanner({ data }: Props) {
  const kpis = data.kpiDeltas
  const items = Object.entries(kpis) as [string, number][]

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Evolução vs semana anterior
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map(([key, val]) => (
          <DeltaChip key={key} label={KPI_LABELS[key] ?? key} value={val} />
        ))}
        <DeltaChip label="Guia de Motéis" value={data.guiaShareDelta} suffix=" p.p." />
      </div>
      {(data.lessonsVerdict.acertos > 0 || data.lessonsVerdict.falhas > 0) && (
        <div className="mt-3 pt-3 border-t flex gap-4 text-xs text-muted-foreground">
          <span className="text-emerald-600">✓ {data.lessonsVerdict.acertos} acerto(s)</span>
          <span className="text-muted-foreground">– {data.lessonsVerdict.neutros} neutro(s)</span>
          <span className="text-destructive">✕ {data.lessonsVerdict.falhas} falha(s)</span>
          {data.anomaliesNewCount > 0 && <span className="text-amber-600">⚠ {data.anomaliesNewCount} anomalia(s) nova(s)</span>}
        </div>
      )}
    </div>
  )
}

function DeltaChip({ label, value, suffix = '%' }: { label: string; value: number; suffix?: string }) {
  const isPositive = value > 0.5
  const isNegative = value < -0.5
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(
        'flex items-center gap-0.5 text-sm font-medium',
        isPositive ? 'text-emerald-600' : isNegative ? 'text-destructive' : 'text-muted-foreground'
      )}>
        <Icon className="w-3.5 h-3.5" />
        {value > 0 ? '+' : ''}{value.toFixed(1)}{suffix}
      </span>
    </div>
  )
}
