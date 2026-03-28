'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HeatmapCell, HeatmapMetric, HeatmapCategory } from '@/app/api/heatmap/route'

// ─── Constantes ───────────────────────────────────────────────────────────────

const DAYS = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado', 'Domingo']
const DAY_LABELS: Record<string, string> = {
  Segunda: 'Seg', Terca: 'Ter', Quarta: 'Qua', Quinta: 'Qui',
  Sexta: 'Sex', Sabado: 'Sáb', Domingo: 'Dom',
}
const HOURS = Array.from({ length: 24 }, (_, i) => i)

// ─── Utilitários ──────────────────────────────────────────────────────────────

function buildMatrix(rows: HeatmapCell[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(`${row.day_name}-${row.hour_of_day}`, row.value)
  }
  return map
}

function getColor(value: number | undefined, metric: HeatmapMetric): string {
  if (value === undefined) return 'bg-muted/30'

  if (metric === 'giro') {
    if (value < 0.5) return 'bg-muted/40'
    if (value < 1.5) return 'bg-yellow-900/30'
    if (value < 2.5) return 'bg-yellow-600/50'
    if (value < 3.5) return 'bg-green-600/50'
    return 'bg-green-500/80'
  } else {
    if (value < 10) return 'bg-muted/40'
    if (value < 30) return 'bg-blue-900/30'
    if (value < 50) return 'bg-blue-700/40'
    if (value < 70) return 'bg-blue-500/60'
    return 'bg-blue-400/80'
  }
}

function formatValue(value: number | undefined, metric: HeatmapMetric): string {
  if (value === undefined) return '–'
  return metric === 'giro' ? value.toFixed(2) : `${value.toFixed(0)}%`
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface HeatmapProps {
  unitSlug: string
}

export function OccupancyHeatmap({ unitSlug }: HeatmapProps) {
  const [metric, setMetric]         = useState<HeatmapMetric>('giro')
  const [categoryId, setCategoryId] = useState<string | null>(null) // null = Total Geral
  const [rows, setRows]             = useState<HeatmapCell[]>([])
  const [categories, setCategories] = useState<HeatmapCategory[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const fetchData = useCallback(async (m: HeatmapMetric, catId: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ unitSlug, metric: m })
      if (catId) params.set('categoryId', catId)

      const res = await fetch(`/api/heatmap?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Erro ${res.status}`)
      }
      const data = await res.json()
      setRows(data.rows ?? [])
      if (data.categories?.length) setCategories(data.categories)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar heatmap')
    } finally {
      setLoading(false)
    }
  }, [unitSlug])

  useEffect(() => { fetchData(metric, categoryId) }, [metric, categoryId, fetchData])

  const matrix = buildMatrix(rows)
  const allValues = rows.map((r) => r.value).filter((v) => v > 0)
  const maxVal = allValues.length ? Math.max(...allValues) : 1

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-sm">Mapa de calor — últimos 7 dias</h3>
          <p className="text-xs text-muted-foreground">Dia da semana × hora do check-in</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro de categoria */}
          {categories.length > 0 && (
            <select
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
              className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Total Geral</option>
              {categories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.nome}
                </option>
              ))}
            </select>
          )}

          {/* Toggle métrica */}
          <div className="flex gap-1 rounded-lg border p-0.5 text-xs">
            <button
              onClick={() => setMetric('giro')}
              className={cn(
                'px-3 py-1 rounded-md transition-colors',
                metric === 'giro'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Giro
            </button>
            <button
              onClick={() => setMetric('ocupacao')}
              className={cn(
                'px-3 py-1 rounded-md transition-colors',
                metric === 'ocupacao'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Ocupação
            </button>
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Baixo</span>
        {metric === 'giro' ? (
          <>
            <div className="h-3 w-8 rounded-sm bg-muted/40" />
            <div className="h-3 w-8 rounded-sm bg-yellow-900/30" />
            <div className="h-3 w-8 rounded-sm bg-yellow-600/50" />
            <div className="h-3 w-8 rounded-sm bg-green-600/50" />
            <div className="h-3 w-8 rounded-sm bg-green-500/80" />
          </>
        ) : (
          <>
            <div className="h-3 w-8 rounded-sm bg-muted/40" />
            <div className="h-3 w-8 rounded-sm bg-blue-900/30" />
            <div className="h-3 w-8 rounded-sm bg-blue-700/40" />
            <div className="h-3 w-8 rounded-sm bg-blue-500/60" />
            <div className="h-3 w-8 rounded-sm bg-blue-400/80" />
          </>
        )}
        <span>Alto</span>
        {!loading && !error && (
          <span className="ml-auto">
            Máx: {formatValue(maxVal, metric)}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="flex">
              <div className="w-10 shrink-0" />
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[10px] text-muted-foreground pb-1"
                  style={{ minWidth: 0 }}
                >
                  {h % 3 === 0 ? `${h}h` : ''}
                </div>
              ))}
            </div>

            {DAYS.map((day) => (
              <div key={day} className="flex items-center gap-0.5 mb-0.5">
                <div className="w-10 shrink-0 text-[11px] text-muted-foreground text-right pr-1">
                  {DAY_LABELS[day]}
                </div>
                {HOURS.map((h) => {
                  const val = matrix.get(`${day}-${h}`)
                  const label = val !== undefined
                    ? (metric === 'giro' ? val.toFixed(1) : `${val.toFixed(0)}%`)
                    : '–'
                  return (
                    <div
                      key={h}
                      title={`${DAY_LABELS[day]} ${h}h — ${formatValue(val, metric)}`}
                      className={cn(
                        'flex-1 rounded-sm h-6 cursor-default transition-opacity hover:opacity-80 flex items-center justify-center',
                        getColor(val, metric)
                      )}
                      style={{ minWidth: 0 }}
                    >
                      <span className={cn(
                        'text-[8px] leading-none font-medium select-none tabular-nums',
                        val === undefined ? 'text-muted-foreground/40' : 'text-foreground/80'
                      )}>
                        {label}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Sem dados de locações nos últimos 7 dias.
        </div>
      )}
    </div>
  )
}
