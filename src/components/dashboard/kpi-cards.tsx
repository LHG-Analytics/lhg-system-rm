'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { CompanyKPIResponse } from '@/lib/kpis/types'

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
  const parts = hhmmss.split(':')
  return `${parts[0]}h${parts[1]}m`
}

function timeToSeconds(hhmmss: string): number {
  const [h, m, s] = (hhmmss ?? '00:00:00').split(':').map(Number)
  return h * 3600 + m * 60 + (s ?? 0)
}

function delta(current: number, previous: number) {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

type CompareMode = 'aa' | 'mm'

interface KPICardProps {
  label: string
  value: string
  deltaPct?: number | null
  previousValue?: string   // valor absoluto do período anterior
  compareMode: CompareMode
  forecast?: string
}

function KPICard({ label, value, deltaPct, previousValue, compareMode, forecast }: KPICardProps) {
  const isPositive = deltaPct != null && deltaPct > 0
  const isNegative = deltaPct != null && deltaPct < 0

  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>

      {deltaPct != null && (
        <p className={cn(
          'text-xs tabular-nums',
          isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : 'text-muted-foreground'
        )}>
          {isPositive ? '▲' : isNegative ? '▼' : ''}
          {' '}{Math.abs(deltaPct).toFixed(1)}%{' '}
          <span className="text-muted-foreground">vs {compareMode === 'aa' ? 'a/a' : 'm/m'}</span>
        </p>
      )}

      {previousValue && (
        <p className="text-xs text-muted-foreground">
          Ant.: <span className="font-medium text-foreground/80">{previousValue}</span>
        </p>
      )}

      {forecast && (
        <p className="text-xs text-muted-foreground">
          Prev. mês: <span className="font-medium text-foreground">{forecast}</span>
        </p>
      )}
    </div>
  )
}

interface DashboardKPICardsProps {
  company: CompanyKPIResponse | null
}

export function DashboardKPICards({ company }: DashboardKPICardsProps) {
  const [compareMode, setCompareMode] = useState<CompareMode>('aa')

  if (!company) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {['Ocupação', 'RevPAR', 'Ticket Médio', 'TRevPAR'].map((label) => (
          <div key={label} className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-2 text-2xl font-bold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-1">Dados indisponíveis</p>
          </div>
        ))}
      </div>
    )
  }

  const r    = company.TotalResult
  const bn   = company.BigNumbers[0]
  const cur  = bn?.currentDate
  const prev = bn?.previousDate
  const prevM = bn?.prevMonthDate
  const fc   = bn?.monthlyForecast

  // Seleciona valores de comparação conforme o modo
  const cmpOccRate = compareMode === 'aa' ? prev?.totalAllOccupancyRatePreviousData      : prevM?.totalAllOccupancyRatePrevMonth
  const cmpRentals = compareMode === 'aa' ? prev?.totalAllRentalsApartmentsPreviousData  : prevM?.totalAllRentalsApartmentsPrevMonth
  const cmpValue   = compareMode === 'aa' ? prev?.totalAllValuePreviousData              : prevM?.totalAllValuePrevMonth
  const cmpTicket  = compareMode === 'aa' ? prev?.totalAllTicketAveragePreviousData      : prevM?.totalAllTicketAveragePrevMonth
  const cmpTrevpar = compareMode === 'aa' ? prev?.totalAllTrevparPreviousData            : prevM?.totalAllTrevparPrevMonth
  const cmpGiro    = compareMode === 'aa' ? prev?.totalAllGiroPreviousData               : prevM?.totalAllGiroPrevMonth
  const cmpOccTime = compareMode === 'aa' ? prev?.totalAverageOccupationTimePreviousData : prevM?.totalAverageOccupationTimePrevMonth

  const cards: KPICardProps[] = [
    {
      label:         'Taxa de Ocupação',
      value:         formatPercent(r.totalOccupancyRate),
      deltaPct:      cmpOccRate != null ? delta(r.totalOccupancyRate, cmpOccRate) : null,
      previousValue: cmpOccRate != null ? formatPercent(cmpOccRate) : undefined,
      compareMode,
      forecast:      fc ? formatPercent(fc.totalAllOccupancyRateForecast) : undefined,
    },
    {
      label:         'RevPAR',
      value:         formatCurrency(r.totalRevpar),
      deltaPct:      cmpValue != null ? delta(cur.totalAllValue, cmpValue) : null,
      previousValue: cmpValue != null ? formatCurrency(cmpValue) : undefined,
      compareMode,
      forecast:      fc ? formatCurrency(fc.totalAllRevparForecast) : undefined,
    },
    {
      label:         'Ticket Médio',
      value:         formatCurrency(r.totalAllTicketAverage),
      deltaPct:      cmpTicket != null ? delta(cur.totalAllTicketAverage, cmpTicket) : null,
      previousValue: cmpTicket != null ? formatCurrency(cmpTicket) : undefined,
      compareMode,
      forecast:      fc ? formatCurrency(fc.totalAllTicketAverageForecast) : undefined,
    },
    {
      label:         'TRevPAR',
      value:         formatCurrency(r.totalTrevpar),
      deltaPct:      cmpTrevpar != null ? delta(cur.totalAllTrevpar, cmpTrevpar) : null,
      previousValue: cmpTrevpar != null ? formatCurrency(cmpTrevpar) : undefined,
      compareMode,
      forecast:      fc ? formatCurrency(fc.totalAllTrevparForecast) : undefined,
    },
    {
      label:         'Locações',
      value:         formatNumber(r.totalAllRentalsApartments),
      deltaPct:      cmpRentals != null ? delta(cur.totalAllRentalsApartments, cmpRentals) : null,
      previousValue: cmpRentals != null ? formatNumber(cmpRentals) : undefined,
      compareMode,
      forecast:      fc ? formatNumber(fc.totalAllRentalsApartmentsForecast) : undefined,
    },
    {
      label:         'Faturamento',
      value:         formatCurrency(r.totalAllValue),
      deltaPct:      cmpValue != null ? delta(cur.totalAllValue, cmpValue) : null,
      previousValue: cmpValue != null ? formatCurrency(cmpValue) : undefined,
      compareMode,
      forecast:      fc ? formatCurrency(fc.totalAllValueForecast) : undefined,
    },
    {
      label:         'Giro',
      value:         r.totalGiro.toFixed(2),
      deltaPct:      cmpGiro != null ? delta(cur.totalAllGiro, cmpGiro) : null,
      previousValue: cmpGiro != null ? cmpGiro.toFixed(2) : undefined,
      compareMode,
      forecast:      fc ? fc.totalAllGiroForecast.toFixed(2) : undefined,
    },
    {
      label:         'Tempo Médio',
      value:         formatTime(r.totalAverageOccupationTime),
      deltaPct:      cmpOccTime != null ? delta(timeToSeconds(cur.totalAverageOccupationTime), timeToSeconds(cmpOccTime)) : null,
      previousValue: cmpOccTime != null ? formatTime(cmpOccTime) : undefined,
      compareMode,
      forecast:      fc ? formatTime(fc.totalAverageOccupationTimeForecast) : undefined,
    },
  ]

  return (
    <div className="space-y-2">
      {/* Toggle a/a vs m/m */}
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-lg border p-0.5 text-xs">
          {(['aa', 'mm'] as CompareMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setCompareMode(mode)}
              className={cn(
                'px-3 py-1 rounded-md transition-colors',
                compareMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {mode === 'aa' ? 'a/a' : 'm/m'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <KPICard key={card.label} {...card} />
        ))}
      </div>
    </div>
  )
}
