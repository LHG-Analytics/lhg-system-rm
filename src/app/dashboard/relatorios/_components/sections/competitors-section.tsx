'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronUp, Globe, AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['competitors']
}

type GapEntry = WeeklyReportData['competitors']['gaps'][0]

const gapColor = (pct: number) =>
  pct > 5 ? 'text-amber-600' : pct < -5 ? 'text-blue-600' : 'text-emerald-600'

const posLabel = { underprice: 'Abaixo', aligned: 'Alinhado', overprice: 'Acima' }
const posColor = {
  underprice: 'text-blue-600 bg-blue-50 dark:bg-blue-950/20',
  aligned:    'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20',
  overprice:  'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
}

function GapCell({ g }: { g: GapEntry | undefined }) {
  const { symbol } = useCurrency()
  if (!g) return <td className="text-right text-muted-foreground/40 text-xs" colSpan={3}>—</td>
  return (
    <>
      <td className="text-right text-xs tabular-nums">{symbol} {g.precoNosso.toFixed(0)}</td>
      <td className="text-right text-xs tabular-nums text-muted-foreground">{symbol} {g.medianaConc.toFixed(0)}</td>
      <td className={cn('text-right text-xs font-semibold tabular-nums', gapColor(g.gapPct))}>
        {g.gapPct > 0 ? '+' : ''}{g.gapPct.toFixed(1)}%
      </td>
    </>
  )
}

// Ordenação de períodos
const PERIOD_ORDER = ['3h', '3 horas', '6h', '6 horas', '12h', '12 horas', 'Day Use', 'Diária', 'Pernoite', 'pernoite']
const sortPeriods = (a: string, b: string) => {
  const ia = PERIOD_ORDER.findIndex(p => p.toLowerCase() === a.toLowerCase())
  const ib = PERIOD_ORDER.findIndex(p => p.toLowerCase() === b.toLowerCase())
  if (ia >= 0 && ib >= 0) return ia - ib
  return a.localeCompare(b)
}

export function CompetitorsSection({ data }: Props) {
  const [open, setOpen] = useState(true)
  const [showApprox, setShowApprox] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('competitors-show-approx') === 'true') setShowApprox(true)
  }, [])

  const handleToggleApprox = () => {
    const next = !showApprox
    setShowApprox(next)
    localStorage.setItem('competitors-show-approx', String(next))
  }

  // Lista de concorrentes únicos (excluindo fallback 'mercado')
  const competitorNames = useMemo(() => {
    const names = new Set<string>()
    for (const g of data.gaps) {
      if (g.competitorName && g.competitorName !== 'mercado') names.add(g.competitorName)
    }
    return [...names].sort()
  }, [data.gaps])

  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null)

  // Concorrente efetivo — inicializa com o primeiro da lista
  const effectiveCompetitor = selectedCompetitor ?? competitorNames[0] ?? null

  if (data.gaps.length === 0) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between">
          <h3 className="font-medium text-sm">⑦ Inteligência competitiva</h3>
        </div>
        <div className="px-5 pb-5 flex items-start gap-3 text-sm text-muted-foreground">
          <Globe className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" />
          <span>
            Nenhum dado de concorrentes disponível para este período.{' '}
            <a href="/dashboard/concorrentes" className="underline underline-offset-2 hover:text-foreground transition-colors">
              Execute uma análise na página de Concorrentes
            </a>{' '}
            para ver os gaps de preço aqui nos próximos relatórios.
          </span>
        </div>
      </div>
    )
  }

  // Gaps do concorrente selecionado (antes do filtro de aproximados)
  const gapsByCompetitor = effectiveCompetitor
    ? data.gaps.filter(g => g.competitorName === effectiveCompetitor)
    : data.gaps

  // Verifica se há gaps aproximados para exibir o toggle
  const hasApproxGaps = gapsByCompetitor.some(g => g.periodoAproximado)

  // Aplica filtro de aproximados
  const filteredGaps = showApprox
    ? gapsByCompetitor
    : gapsByCompetitor.filter(g => !g.periodoAproximado)

  // Posição dominante do concorrente selecionado
  const posCounts = { underprice: 0, aligned: 0, overprice: 0 }
  for (const g of filteredGaps) {
    if (g.position in posCounts) posCounts[g.position as keyof typeof posCounts]++
  }
  const dominant = (Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'aligned') as keyof typeof posLabel

  // Agrupa por categoria nossa → período → dia_tipo
  type ByPeriod = Record<string, Record<string, GapEntry>>
  type ByCategoria = Record<string, ByPeriod>

  const grouped: ByCategoria = {}
  for (const g of filteredGaps) {
    if (!grouped[g.categoria]) grouped[g.categoria] = {}
    if (!grouped[g.categoria][g.periodo]) grouped[g.categoria][g.periodo] = {}
    grouped[g.categoria][g.periodo][g.diaTipo] = g
  }

  const categorias = Object.keys(grouped).sort()
  const hasMercadoFallback = filteredGaps.some(g => g.categoriaConc === 'mercado')

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-sm">⑦ Inteligência competitiva</h3>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', posColor[dominant])}>
            {posLabel[dominant]}
          </span>
          {effectiveCompetitor && competitorNames.length === 1 && (
            <span className="text-xs text-muted-foreground">vs {effectiveCompetitor}</span>
          )}
          {hasMercadoFallback && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              match parcial
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5">
          <p className="text-xs text-muted-foreground">
            Preço nosso vs mediana do concorrente selecionado (snapshots dos últimos 14 dias). Gap negativo = abaixo do mercado; positivo = acima.
          </p>

          {/* Seletor de concorrentes — aparece apenas com 2+ concorrentes */}
          {competitorNames.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">Comparando com:</span>
              {competitorNames.map(name => (
                <button
                  key={name}
                  onClick={() => setSelectedCompetitor(name)}
                  className={cn(
                    'text-xs px-3 py-1 rounded-full border transition-colors',
                    effectiveCompetitor === name
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/60'
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Toggle de períodos equivalentes — só aparece quando há gaps aproximados */}
          {hasApproxGaps && (
            <button
              onClick={handleToggleApprox}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors',
                showApprox
                  ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-800'
                  : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/60'
              )}
            >
              <span className="font-medium tabular-nums">≈</span>
              Incluir períodos equivalentes
              <span className="text-muted-foreground/60">(ex: 2h ≈ 3h)</span>
            </button>
          )}

          {categorias.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Nenhuma comparação disponível para este concorrente.
            </p>
          )}

          {categorias.map(cat => {
            const periodos = Object.keys(grouped[cat]).sort(sortPeriods)

            // Pega info da primeira entrada disponível na categoria
            const firstEntry = Object.values(grouped[cat]).flatMap(p => Object.values(p))[0]
            const isMercado = firstEntry?.categoriaConc === 'mercado'
            const concLabel = isMercado
              ? 'sem categoria equivalente — mediana de mercado'
              : firstEntry?.categoriaConc ?? null

            const advantage = firstEntry?.amenityAdvantage ?? []

            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide">{cat}</span>
                  {concLabel && (
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      isMercado
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {isMercado && <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
                      vs {concLabel}
                    </span>
                  )}
                  {advantage.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 flex items-center gap-0.5">
                      <Sparkles className="w-2.5 h-2.5" />
                      {advantage.slice(0, 2).join(', ')}
                      {advantage.length > 2 && ` +${advantage.length - 2}`}
                    </span>
                  )}
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left pb-1 font-medium w-20">Período</th>
                      {/* Semana */}
                      <th className="text-right pb-1 font-medium text-xs" colSpan={3}>
                        <span className="border-b border-dashed pb-0.5">Semana</span>
                      </th>
                      <th className="w-3" />
                      {/* FDS / Feriado */}
                      <th className="text-right pb-1 font-medium text-xs" colSpan={3}>
                        <span className="border-b border-dashed pb-0.5">FDS / Feriado</span>
                      </th>
                    </tr>
                    <tr className="text-[10px] text-muted-foreground/70">
                      <th />
                      <th className="text-right font-normal pb-1">Nosso</th>
                      <th className="text-right font-normal pb-1">Conc.</th>
                      <th className="text-right font-normal pb-1">Gap</th>
                      <th />
                      <th className="text-right font-normal pb-1">Nosso</th>
                      <th className="text-right font-normal pb-1">Conc.</th>
                      <th className="text-right font-normal pb-1">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodos.map(per => {
                      const byDia = grouped[cat][per]
                      const semana = byDia['semana'] ?? byDia['todos']
                      const fds    = byDia['fds_feriado'] ?? byDia['todos']
                      const hasTodos = !byDia['semana'] && !byDia['fds_feriado'] && !!byDia['todos']

                      // Detecta match aproximado e qual período o concorrente usa
                      const isApprox = semana?.periodoAproximado || fds?.periodoAproximado
                      const compPer  = semana?.competitorPeriodo ?? fds?.competitorPeriodo

                      return (
                        <tr key={per} className="border-b last:border-0">
                          <td className="py-1.5 font-medium text-xs">
                            <span>{per}</span>
                            {isApprox && compPer && (
                              <span
                                className="ml-1 text-[10px] text-violet-500 font-normal"
                                title={`Concorrente usa ${compPer} (match aproximado)`}
                              >
                                ≈{compPer}
                              </span>
                            )}
                          </td>
                          {hasTodos ? (
                            <>
                              <GapCell g={byDia['todos']} />
                              <td className="w-3" />
                              <td className="text-right text-muted-foreground/40 text-xs" colSpan={3}>igual semana</td>
                            </>
                          ) : (
                            <>
                              <GapCell g={semana} />
                              <td className="w-3" />
                              <GapCell g={fds} />
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {hasMercadoFallback && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5 mt-1">
              <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
              Categorias marcadas com <span className="font-medium text-amber-600">⚠</span> usam mediana geral de mercado pois não foi possível fazer match por comodidades. Configure as comodidades das suas suítes em Admin → Agente RM → Capacidade para comparações mais precisas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
