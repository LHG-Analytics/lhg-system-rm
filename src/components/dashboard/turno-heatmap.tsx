'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TurnoHeatmapCell, TurnoBand } from '@/app/api/heatmap/turno/route'
import { useCurrency } from '@/components/currency-context'

const DAYS = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado', 'Domingo']
const DAY_LABELS: Record<string, string> = {
  Segunda: 'Segunda-feira', Terca: 'Terça-feira', Quarta: 'Quarta-feira', Quinta: 'Quinta-feira',
  Sexta: 'Sexta-feira', Sabado: 'Sábado', Domingo: 'Domingo',
}

type TurnoMetric = 'giro' | 'receita'

function getColor(ratio: number): string {
  if (ratio < 0.15) return 'bg-muted/40'
  if (ratio < 0.35) return 'bg-emerald-900/30'
  if (ratio < 0.60) return 'bg-emerald-600/50'
  if (ratio < 0.80) return 'bg-emerald-500/60'
  return 'bg-emerald-400/80'
}

interface Props {
  unitSlug:        string
  startDate:       string
  endDate:         string
  statusOverride?: string
}

export function TurnoHeatmap({ unitSlug, startDate, endDate, statusOverride }: Props) {
  const searchParams = useSearchParams()
  const { formatMoney: fm } = useCurrency()
  const rentalStatus = statusOverride ?? searchParams.get('status') ?? 'FINALIZADA'

  const [metric,  setMetric]  = useState<TurnoMetric>('giro')
  const [rows,    setRows]    = useState<TurnoHeatmapCell[]>([])
  const [turnos,  setTurnos]  = useState<TurnoBand[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const responseCache = useRef(new Map<string, { rows: TurnoHeatmapCell[]; turnos: TurnoBand[] }>())

  const fetchData = useCallback(async () => {
    const cacheKey = `${unitSlug}-${startDate}-${endDate}-${rentalStatus}`
    const cached = responseCache.current.get(cacheKey)
    if (cached) {
      setRows(cached.rows)
      setTurnos(cached.turnos)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ unitSlug, startDate, endDate, status: rentalStatus })
      const res = await fetch(`/api/heatmap/turno?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Erro ${res.status}`)
      }
      const data = await res.json()
      const fetchedRows: TurnoHeatmapCell[] = data.rows ?? []
      const fetchedTurnos: TurnoBand[] = data.turnos ?? []
      responseCache.current.set(cacheKey, { rows: fetchedRows, turnos: fetchedTurnos })
      setRows(fetchedRows)
      setTurnos(fetchedTurnos)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar heatmap de turno')
    } finally {
      setLoading(false)
    }
  }, [unitSlug, startDate, endDate, rentalStatus])

  useEffect(() => { fetchData() }, [fetchData])

  const matrix = new Map<string, TurnoHeatmapCell>()
  for (const r of rows) matrix.set(`${r.day_name}-${r.turno}`, r)

  const values = rows.map((r) => (metric === 'giro' ? r.giroPct : r.receita))
  const maxVal = values.length ? Math.max(...values) : 1

  function cellLabel(cell: TurnoHeatmapCell | undefined): string {
    if (!cell) return '–'
    return metric === 'giro' ? `${cell.giroPct.toFixed(1)}%` : fm(cell.receita)
  }

  const turnoLabels = turnos.map((t) => t.label)

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-sm">Giro e receita por turno</h3>
          <p className="text-xs text-muted-foreground">
            {metric === 'giro'
              ? 'Participação % de cada turno no giro total do período (soma = 100%)'
              : 'Receita bruta por turno × dia da semana'}
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border p-0.5 text-xs shrink-0">
          {(['giro', 'receita'] as TurnoMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                'px-3 py-1 rounded-md transition-colors whitespace-nowrap',
                metric === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m === 'giro' ? 'Giro (%)' : 'Receita'}
            </button>
          ))}
        </div>
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

      {!loading && !error && turnoLabels.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[360px]">
            <div className="flex">
              <div className="w-28 shrink-0" />
              {turnoLabels.map((label) => (
                <div key={label} className="flex-1 text-center text-xs font-medium text-muted-foreground pb-1">
                  {label}
                </div>
              ))}
            </div>

            {DAYS.map((day) => (
              <div key={day} className="flex items-center gap-1 mb-1">
                <div className="w-28 shrink-0 text-xs text-muted-foreground text-right pr-2">
                  {DAY_LABELS[day]}
                </div>
                {turnoLabels.map((label) => {
                  const cell = matrix.get(`${day}-${label}`)
                  const val = cell ? (metric === 'giro' ? cell.giroPct : cell.receita) : undefined
                  const ratio = val !== undefined && maxVal > 0 ? val / maxVal : 0
                  return (
                    <div
                      key={label}
                      title={`${DAY_LABELS[day]} · ${label} — ${cellLabel(cell)}`}
                      className={cn(
                        'flex-1 rounded-sm h-9 cursor-default transition-opacity hover:opacity-80 flex items-center justify-center',
                        getColor(ratio)
                      )}
                    >
                      <span className="text-xs font-medium select-none tabular-nums text-foreground/90">
                        {cellLabel(cell)}
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
          Sem dados de locações no período selecionado.
        </div>
      )}
    </div>
  )
}
