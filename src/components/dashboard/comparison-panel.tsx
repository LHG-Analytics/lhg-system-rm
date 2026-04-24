'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { DashboardKPICards } from '@/components/dashboard/kpi-cards'
import { DashboardCharts } from '@/components/dashboard/charts'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
import { ComparisonFilter, type ComparisonFilters } from '@/components/dashboard/comparison-filter'
import { fmtDisplay } from '@/lib/date-range'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { HeatmapDateType } from '@/app/api/heatmap/route'
import { cn } from '@/lib/utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  label:      string
  accent:     'blue' | 'purple'
  unitSlug:   string
  initial:    ComparisonFilters
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ComparisonPanel({ label, accent, unitSlug, initial }: Props) {
  const [filters, setFilters] = useState<ComparisonFilters>(initial)
  const [company, setCompany] = useState<CompanyKPIResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetchKPIs = useCallback(async (f: ComparisonFilters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        unitSlug,
        preset:    f.preset,
        start:     f.startDate,
        end:       f.endDate,
        startHour: String(f.startHour),
        endHour:   String(f.endHour),
        dateType:  f.dateType,
        status:    f.status,
      })
      const res = await fetch(`/api/dashboard/kpis?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Erro ${res.status}`)
      }
      const data = await res.json()
      setCompany(data.company ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar KPIs')
    } finally {
      setLoading(false)
    }
  }, [unitSlug])

  // Busca inicial ao montar
  useEffect(() => { fetchKPIs(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(newFilters: ComparisonFilters) {
    setFilters(newFilters)
    fetchKPIs(newFilters)
  }

  const rangeLabel = `${fmtDisplay(filters.startDate)} → ${fmtDisplay(filters.endDate)}`

  return (
    <div className="flex flex-col gap-5">
      {/* Rótulo do painel */}
      <div className={cn(
        'self-start px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border',
        accent === 'blue'   && 'bg-blue-500/10   text-blue-400   border-blue-500/20',
        accent === 'purple' && 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      )}>
        <div className={cn(
          'size-1.5 rounded-full',
          accent === 'blue'   && 'bg-blue-400',
          accent === 'purple' && 'bg-purple-400',
        )} />
        {label}
      </div>

      {/* Filtros autônomos */}
      <ComparisonFilter initial={filters} onSearch={handleSearch} loading={loading} />

      {/* Estado: carregando */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Estado: erro */}
      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Conteúdo do dashboard */}
      {!loading && !error && (
        <div className="flex flex-col gap-6">
          <DashboardKPICards company={company} />
          <DashboardCharts   company={company} />
          <OccupancyHeatmap
            unitSlug={unitSlug}
            startDate={filters.startDate}
            endDate={filters.endDate}
            rangeLabel={rangeLabel}
            statusOverride={filters.status}
            dateTypeOverride={filters.dateType as HeatmapDateType}
          />
        </div>
      )}
    </div>
  )
}
