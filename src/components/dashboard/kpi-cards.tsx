'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { CompanyKPIResponse } from '@/lib/kpis/types'

// ─── Formatadores ─────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}
function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}
function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value))
}
function formatTime(hhmmss: string) {
  if (!hhmmss) return '—'
  const [h, m] = hhmmss.split(':')
  return `${h}h${m}m`
}
function timeToSeconds(hhmmss: string): number {
  const [h, m, s] = (hhmmss ?? '00:00:00').split(':').map(Number)
  return h * 3600 + m * 60 + (s ?? 0)
}
function delta(current: number, previous: number) {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

type CompareMode = 'aa' | 'mm'

interface KPICardProps {
  label: string
  value: string
  deltaPct?: number | null
  previousValue?: string
  compareMode: CompareMode
  forecast?: string
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

function DeltaBadge({ pct, mode }: { pct: number; mode: CompareMode }) {
  const isPositive = pct > 0
  const isNegative = pct < 0
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 px-1.5 py-0.5 text-[11px] font-medium border-0',
        isPositive && 'bg-emerald-500/10 text-emerald-400',
        isNegative && 'bg-rose-500/10 text-rose-400',
        !isPositive && !isNegative && 'bg-muted text-muted-foreground',
      )}
    >
      {isPositive
        ? <TrendingUp className="size-3" />
        : isNegative
          ? <TrendingDown className="size-3" />
          : <Minus className="size-3" />
      }
      {Math.abs(pct).toFixed(1)}% {mode === 'aa' ? 'a/a' : 'm/m'}
    </Badge>
  )
}

function KPICard({ label, value, deltaPct, previousValue, compareMode, forecast, dragHandleProps }: KPICardProps) {
  return (
    <Card className="flex flex-col gap-0 py-0 overflow-hidden group">
      <CardHeader className="px-5 pt-4 pb-3 space-y-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            {label}
          </p>
          {dragHandleProps && (
            <div
              {...dragHandleProps}
              className="opacity-0 group-hover:opacity-30 hover:!opacity-80 cursor-grab active:cursor-grabbing p-0.5 rounded transition-opacity shrink-0"
              title="Arrastar para reordenar"
            >
              <GripVertical className="size-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 flex flex-col gap-3">
        <p className="text-3xl font-bold tabular-nums tracking-tight leading-none">
          {value}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          {deltaPct != null && (
            <DeltaBadge pct={deltaPct} mode={compareMode} />
          )}
          {previousValue && (
            <span className="text-xs text-muted-foreground">
              Ant.: <span className="text-foreground/70 font-medium">{previousValue}</span>
            </span>
          )}
        </div>

        {forecast && (
          <>
            <Separator className="opacity-50" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Prev. mês</span>
              <span className="text-sm font-semibold tabular-nums">{forecast}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Sortable wrapper ─────────────────────────────────────────────────────────

function SortableKPICard({ id, ...props }: { id: string } & Omit<KPICardProps, 'dragHandleProps'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(isDragging && 'opacity-60 scale-[1.02] shadow-xl')}
    >
      <KPICard {...props} dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>} />
    </div>
  )
}

// ─── Container principal ──────────────────────────────────────────────────────

const DEFAULT_ORDER = [
  'Taxa de Ocupação', 'RevPAR', 'Ticket Médio', 'TRevPAR',
  'Locações', 'Faturamento', 'Giro', 'Tempo Médio',
]

function loadOrder(): string[] {
  try {
    const stored = localStorage.getItem('kpi-cards-order')
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      if (Array.isArray(parsed) && DEFAULT_ORDER.every((l) => parsed.includes(l))) return parsed
    }
  } catch {}
  return DEFAULT_ORDER
}

interface DashboardKPICardsProps {
  company: CompanyKPIResponse | null
}

export function DashboardKPICards({ company }: DashboardKPICardsProps) {
  const [compareMode, setCompareMode] = useState<CompareMode>('aa')
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER)

  useEffect(() => { setOrder(loadOrder()) }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as string)
      const newIdx = prev.indexOf(over.id as string)
      const next = arrayMove(prev, oldIdx, newIdx)
      try { localStorage.setItem('kpi-cards-order', JSON.stringify(next)) } catch {}
      return next
    })
  }

  if (!company) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Comparar com</p>
          <ToggleGroup type="single" value={compareMode} onValueChange={(v) => v && setCompareMode(v as CompareMode)} variant="outline" size="sm">
            <ToggleGroupItem value="aa">a/a</ToggleGroupItem>
            <ToggleGroupItem value="mm">m/m</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEFAULT_ORDER.map((label) => (
            <Card key={label} className="py-0 overflow-hidden">
              <CardHeader className="px-5 pt-5 pb-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
              </CardHeader>
              <CardContent className="px-5 pb-5 flex flex-col gap-3">
                <p className="text-3xl font-bold text-muted-foreground">—</p>
                <p className="text-xs text-muted-foreground">Dados indisponíveis</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const r    = company.TotalResult
  const bn   = company.BigNumbers[0]
  const cur  = bn?.currentDate
  const prev = bn?.previousDate
  const prevM = bn?.prevMonthDate
  const fc   = bn?.monthlyForecast

  const cmpOccRate = compareMode === 'aa' ? prev?.totalAllOccupancyRatePreviousData      : prevM?.totalAllOccupancyRatePrevMonth
  const cmpRentals = compareMode === 'aa' ? prev?.totalAllRentalsApartmentsPreviousData  : prevM?.totalAllRentalsApartmentsPrevMonth
  const cmpValue   = compareMode === 'aa' ? prev?.totalAllValuePreviousData              : prevM?.totalAllValuePrevMonth
  const cmpTicket  = compareMode === 'aa' ? prev?.totalAllTicketAveragePreviousData      : prevM?.totalAllTicketAveragePrevMonth
  const cmpRevpar  = compareMode === 'aa' ? prev?.totalAllRevparPreviousData             : prevM?.totalAllRevparPrevMonth
  const cmpTrevpar = compareMode === 'aa' ? prev?.totalAllTrevparPreviousData            : prevM?.totalAllTrevparPrevMonth
  const cmpGiro    = compareMode === 'aa' ? prev?.totalAllGiroPreviousData               : prevM?.totalAllGiroPrevMonth
  const cmpOccTime = compareMode === 'aa' ? prev?.totalAverageOccupationTimePreviousData : prevM?.totalAverageOccupationTimePrevMonth

  const cardsMap: Record<string, KPICardProps> = {
    'Taxa de Ocupação': {
      label: 'Taxa de Ocupação', compareMode,
      value:         formatPercent(r.totalOccupancyRate),
      deltaPct:      cmpOccRate != null ? delta(r.totalOccupancyRate, cmpOccRate) : null,
      previousValue: cmpOccRate != null ? formatPercent(cmpOccRate) : undefined,
      forecast:      fc ? formatPercent(fc.totalAllOccupancyRateForecast) : undefined,
    },
    'RevPAR': {
      label: 'RevPAR', compareMode,
      value:         formatCurrency(r.totalRevpar),
      deltaPct:      cmpRevpar != null ? delta(r.totalRevpar, cmpRevpar) : null,
      previousValue: cmpRevpar != null ? formatCurrency(cmpRevpar) : undefined,
      forecast:      fc ? formatCurrency(fc.totalAllRevparForecast) : undefined,
    },
    'Ticket Médio': {
      label: 'Ticket Médio', compareMode,
      value:         formatCurrency(r.totalAllTicketAverage),
      deltaPct:      cmpTicket != null ? delta(cur.totalAllTicketAverage, cmpTicket) : null,
      previousValue: cmpTicket != null ? formatCurrency(cmpTicket) : undefined,
      forecast:      fc ? formatCurrency(fc.totalAllTicketAverageForecast) : undefined,
    },
    'TRevPAR': {
      label: 'TRevPAR', compareMode,
      value:         formatCurrency(r.totalTrevpar),
      deltaPct:      cmpTrevpar != null ? delta(cur.totalAllTrevpar, cmpTrevpar) : null,
      previousValue: cmpTrevpar != null ? formatCurrency(cmpTrevpar) : undefined,
      forecast:      fc ? formatCurrency(fc.totalAllTrevparForecast) : undefined,
    },
    'Locações': {
      label: 'Locações', compareMode,
      value:         formatNumber(r.totalAllRentalsApartments),
      deltaPct:      cmpRentals != null ? delta(cur.totalAllRentalsApartments, cmpRentals) : null,
      previousValue: cmpRentals != null ? formatNumber(cmpRentals) : undefined,
      forecast:      fc ? formatNumber(fc.totalAllRentalsApartmentsForecast) : undefined,
    },
    'Faturamento': {
      label: 'Faturamento', compareMode,
      value:         formatCurrency(r.totalAllValue),
      deltaPct:      cmpValue != null ? delta(cur.totalAllValue, cmpValue) : null,
      previousValue: cmpValue != null ? formatCurrency(cmpValue) : undefined,
      forecast:      fc ? formatCurrency(fc.totalAllValueForecast) : undefined,
    },
    'Giro': {
      label: 'Giro', compareMode,
      value:         r.totalGiro.toFixed(2),
      deltaPct:      cmpGiro != null ? delta(cur.totalAllGiro, cmpGiro) : null,
      previousValue: cmpGiro != null ? cmpGiro.toFixed(2) : undefined,
      forecast:      fc ? fc.totalAllGiroForecast.toFixed(2) : undefined,
    },
    'Tempo Médio': {
      label: 'Tempo Médio', compareMode,
      value:         formatTime(r.totalAverageOccupationTime),
      deltaPct:      cmpOccTime != null ? delta(timeToSeconds(cur.totalAverageOccupationTime), timeToSeconds(cmpOccTime)) : null,
      previousValue: cmpOccTime != null ? formatTime(cmpOccTime) : undefined,
      forecast:      fc ? formatTime(fc.totalAverageOccupationTimeForecast) : undefined,
    },
  }

  const sortedCards = order.map((label) => cardsMap[label]).filter(Boolean)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Comparar com</p>
        <ToggleGroup
          type="single"
          value={compareMode}
          onValueChange={(v) => v && setCompareMode(v as CompareMode)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="aa">a/a</ToggleGroupItem>
          <ToggleGroupItem value="mm">m/m</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sortedCards.map((card) => (
              <SortableKPICard key={card.label} id={card.label} {...card} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
