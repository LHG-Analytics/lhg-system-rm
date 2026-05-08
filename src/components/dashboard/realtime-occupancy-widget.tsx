'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface OccupancyRow {
  categoria: string
  total: number
  bloqueadas: number
  disponiveis: number
  ocupadas: number
  livres: number
  pct_ocupacao: number
  motivos_bloqueio?: string[]
}

interface Props {
  unitSlug: string
}

const REFRESH_INTERVAL_MS = 90_000 // 90 segundos

function pctColor(pct: number) {
  if (pct >= 85) return 'bg-destructive'
  if (pct >= 60) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function pctTextColor(pct: number) {
  if (pct >= 85) return 'text-destructive'
  if (pct >= 60) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}

export function RealtimeOccupancyWidget({ unitSlug }: Props) {
  const [rows, setRows]         = useState<OccupancyRow[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('occupancy-collapsed') === '1'
  })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchData() {
    try {
      const res = await fetch(`/api/dashboard/realtime-occupancy?unitSlug=${unitSlug}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      setRows(data.rows ?? [])
      setFetchedAt(data.fetchedAt ?? null)
    } catch {
      // silently fail — widget is non-critical
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitSlug])

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('occupancy-collapsed', next ? '1' : '0')
  }

  if (!loading && rows.length === 0) return null

  const totalOcupadas    = rows.reduce((s, r) => s + r.ocupadas,    0)
  const totalDisponiveis = rows.reduce((s, r) => s + r.disponiveis, 0)
  const totalLivres      = rows.reduce((s, r) => s + r.livres,      0)
  const pctGeral = totalDisponiveis > 0 ? Math.round((totalOcupadas / totalDisponiveis) * 100) : 0

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* Header clicável */}
      <button
        onClick={toggleCollapse}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <span className="text-sm font-medium">Ocupação agora</span>
          {collapsed && fetchedAt && (
            <span className={cn('text-xs font-semibold ml-1', pctTextColor(pctGeral))}>
              {pctGeral}% · {totalOcupadas}/{totalDisponiveis} suítes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="text-[11px] text-muted-foreground">
              {formatTime(fetchedAt)}
            </span>
          )}
          {collapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <RefreshCw className="size-3 animate-spin" />
              Consultando ERP...
            </div>
          ) : (
            <>
              {/* Resumo geral */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground pb-1 border-b">
                <span className={cn('font-semibold text-sm', pctTextColor(pctGeral))}>
                  {pctGeral}% ocupado
                </span>
                <span>{totalOcupadas} ocupadas · {totalLivres} livres · {totalDisponiveis} disponíveis</span>
              </div>

              {/* Linhas por categoria */}
              <div className="space-y-2.5">
                {rows.map((r) => {
                  const pct = r.disponiveis > 0 ? Math.round(r.pct_ocupacao) : 0
                  return (
                    <div key={r.categoria} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium truncate max-w-[55%]">{r.categoria}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground">
                            {r.ocupadas}/{r.disponiveis}
                            {r.bloqueadas > 0 && (
                              r.motivos_bloqueio && r.motivos_bloqueio.length > 0 ? (
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button className="ml-1 text-amber-500 dark:text-amber-400 underline decoration-dotted cursor-help focus:outline-none">
                                        ({r.bloqueadas} bloq.)
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-[220px]">
                                      <p className="font-semibold mb-1">Motivos do bloqueio:</p>
                                      <ul className="space-y-0.5">
                                        {r.motivos_bloqueio.map((m, i) => (
                                          <li key={i} className="text-xs">• {m}</li>
                                        ))}
                                      </ul>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="text-muted-foreground/60"> ({r.bloqueadas} bloq.)</span>
                              )
                            )}
                          </span>
                          <span className={cn('font-semibold w-10 text-right', pctTextColor(pct))}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', pctColor(pct))}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-[10px] text-muted-foreground pt-1">
                Atualiza automaticamente a cada 90s · Fonte: ERP Automo
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
