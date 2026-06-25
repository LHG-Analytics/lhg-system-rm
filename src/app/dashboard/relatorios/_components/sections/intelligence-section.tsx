'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['intelligence']
}

type Verdict = 'success' | 'failure' | 'neutral' | 'unknown'

type HistoricalInsight = NonNullable<WeeklyReportData['intelligence']['historicalInsights']>[number]

const VERDICT_CONFIG: Record<Verdict, { bar: string; badge: string; label: string }> = {
  success: {
    bar:   'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    label: '✓ Positivo',
  },
  failure: {
    bar:   'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    label: '✕ Negativo',
  },
  neutral: {
    bar:   'bg-amber-400',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    label: '— Neutro',
  },
  unknown: {
    bar:   'bg-muted-foreground',
    badge: 'bg-muted text-muted-foreground',
    label: '? Sem dados',
  },
}

function generateInsight(insight: HistoricalInsight): string {
  const dir = insight.avgChangePct > 0 ? 'Aumentos' : 'Reduções'
  const dr = insight.deltaRevpar
  const dg = insight.deltaGiro

  if (insight.verdict === 'success') {
    if (dr !== null && dr > 0 && dg !== null && dg > 0)
      return `${dir} de preço geraram crescimento simultâneo de RevPAR e volume — estratégia bem-sucedida.`
    if (dr !== null && dr > 0)
      return `${dir} de preço melhoraram a receita por suíte disponível.`
    if (dg !== null && dg > 0)
      return `${dir} de preço aumentaram o volume de locações.`
    return `${dir} de preço geraram resultado positivo no período.`
  }

  if (insight.verdict === 'failure') {
    if (insight.avgChangePct < 0 && dr !== null && dr < -2)
      return `Reduções de preço não geraram volume suficiente para compensar — RevPAR caiu ${Math.abs(dr).toFixed(1)}%.`
    if (insight.avgChangePct > 0 && dg !== null && dg < -5)
      return `Aumentos de preço reduziram muito o volume — a elasticidade foi mais alta do que o esperado.`
    return `${dir} de preço geraram resultado negativo no período.`
  }

  // neutral
  if (insight.avgChangePct < 0 && dg !== null && dg > 0 && dr !== null && dr < 0)
    return `Reduções geraram mais volume mas RevPAR recuou — trocar preço por giro neste nível não compensa.`
  if (insight.avgChangePct > 0 && dr !== null && dr >= 0)
    return `Aumentos de preço mantiveram RevPAR estável — volume se ajustou sem impacto relevante.`
  return `Mudanças de preço com impacto equilibrado em relação à tabela anterior.`
}

export function IntelligenceSection({ data }: Props) {
  const [open, setOpen]         = useState(true)
  const [expanded, setExpanded] = useState<number[]>([])
  const { symbol } = useCurrency()
  const insights = data.historicalInsights ?? []

  function toggleDetail(i: number) {
    setExpanded(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  const hasMeta =
    data.newLessonsCount > 0 ||
    data.elasticityUpdatedCount > 0 ||
    data.anomaliesDetected.length > 0 ||
    data.anomaliesResolved.length > 0

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-sm">⑩ O que o agente aprendeu no período</h3>
          {insights.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {insights.length} {insights.length > 1 ? 'transições' : 'transição'} analisada{insights.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">

          {/* Aprendizado histórico — bloco principal */}
          {insights.length === 0 ? (
            <div className="rounded-lg bg-muted/40 border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">📚</span>
              <div>
                <p className="font-medium text-foreground mb-1">Aprendizado histórico ainda não disponível</p>
                <p>É necessário ter pelo menos 2 tabelas de preços importadas. O sistema compara os primeiros 30 dias de cada tabela para medir o impacto real das mudanças. Importe tabelas históricas em <a href="/dashboard/precos" className="underline underline-offset-2 hover:text-foreground transition-colors">Preços</a>.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight, i) => {
                const cfg = VERDICT_CONFIG[insight.verdict]
                const fromLabel = format(new Date(insight.fromDate + 'T12:00:00Z'), "MMM'/'yy", { locale: ptBR })
                const toLabel   = format(new Date(insight.toDate   + 'T12:00:00Z'), "MMM'/'yy", { locale: ptBR })
                const isExpanded = expanded.includes(i)
                const insightText = generateInsight(insight)

                return (
                  <div key={i} className="rounded-lg border bg-card overflow-hidden">
                    {/* Barra colorida de veredicto */}
                    <div className={cn('h-1 w-full', cfg.bar)} />

                    <div className="p-4 space-y-3">
                      {/* Header: período + badge + contagem */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">Tabela {fromLabel} → {toLabel}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {insight.changesCount} preços alterados · média {insight.avgChangePct > 0 ? '+' : ''}{insight.avgChangePct.toFixed(1)}%
                          </p>
                        </div>
                        <span className={cn('text-xs font-medium px-2 py-1 rounded-full shrink-0', cfg.badge)}>
                          {cfg.label}
                        </span>
                      </div>

                      {/* Métricas RevPAR e Giro — comparativo antes/depois */}
                      {insight.kpiBefore && insight.kpiAfter && (
                        <div className="grid grid-cols-2 gap-2">
                          <MetricCard
                            label="RevPAR"
                            before={insight.kpiBefore.revpar}
                            after={insight.kpiAfter.revpar}
                            delta={insight.deltaRevpar}
                            prefix={symbol}
                            decimals={0}
                          />
                          <MetricCard
                            label="Giro"
                            before={insight.kpiBefore.giro}
                            after={insight.kpiAfter.giro}
                            delta={insight.deltaGiro}
                            decimals={2}
                          />
                        </div>
                      )}

                      {/* Frase de insight — interpreta os dados */}
                      <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
                        {insightText}
                      </p>

                      {/* Detalhe colapsável — lista de preços individuais */}
                      {insight.topChanges.length > 0 && (
                        <div>
                          <button
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => toggleDetail(i)}
                          >
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {isExpanded ? 'Ocultar' : 'Ver'} maiores variações ({insight.topChanges.length})
                          </button>

                          {isExpanded && (
                            <div className="mt-2 space-y-1">
                              {insight.topChanges.map((c, j) => (
                                <div key={j} className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0">
                                  <span className="text-muted-foreground">
                                    {c.categoria} · {c.periodo} · {c.diaTipo}
                                  </span>
                                  <span className={cn('font-medium tabular-nums', c.variacaoPct > 0 ? 'text-emerald-600' : 'text-destructive')}>
                                    {c.variacaoPct > 0 ? '+' : ''}{c.variacaoPct.toFixed(1)}%
                                    <span className="text-muted-foreground font-normal ml-1">
                                      {symbol}{c.precoAnterior.toFixed(0)} → {symbol}{c.precoNovo.toFixed(0)}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Contadores secundários */}
          {hasMeta && (
            <div className="flex flex-wrap gap-2">
              {data.newLessonsCount > 0 && (
                <span className="text-xs bg-muted px-3 py-1 rounded-full">
                  📖 {data.newLessonsCount} lição{data.newLessonsCount > 1 ? 'ões' : ''} registrada{data.newLessonsCount > 1 ? 's' : ''}
                </span>
              )}
              {data.elasticityUpdatedCount > 0 && (
                <span className="text-xs bg-muted px-3 py-1 rounded-full">
                  📐 {data.elasticityUpdatedCount} elasticidade{data.elasticityUpdatedCount > 1 ? 's' : ''} calculada{data.elasticityUpdatedCount > 1 ? 's' : ''}
                </span>
              )}
              {data.anomaliesDetected.length > 0 && (
                <span className="text-xs bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-3 py-1 rounded-full">
                  ⚠️ {data.anomaliesDetected.length} anomalia{data.anomaliesDetected.length > 1 ? 's' : ''} detectada{data.anomaliesDetected.length > 1 ? 's' : ''}
                </span>
              )}
              {data.anomaliesResolved.length > 0 && (
                <span className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-3 py-1 rounded-full">
                  ✓ {data.anomaliesResolved.length} anomalia{data.anomaliesResolved.length > 1 ? 's' : ''} resolvida{data.anomaliesResolved.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {/* Anomalias abertas */}
          {data.anomaliesDetected.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Anomalias abertas</p>
              <div className="space-y-1">
                {data.anomaliesDetected.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-medium">{a.metric}</span>
                    <span className={cn('text-xs', a.direction === 'negative_outlier' ? 'text-destructive' : 'text-emerald-600')}>
                      {a.direction === 'negative_outlier' ? '↓' : '↑'} z={a.zScore.toFixed(1)}σ
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{a.scope}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface MetricCardProps {
  label: string
  before: number
  after: number
  delta: number | null
  prefix?: string
  decimals?: number
}

function MetricCard({ label, before, after, delta, prefix = '', decimals = 2 }: MetricCardProps) {
  const fmt = (v: number) => `${prefix ? prefix + ' ' : ''}${v.toFixed(decimals)}`
  const positive = delta !== null && delta > 0
  const negative = delta !== null && delta < -1

  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground">{fmt(before)}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className="text-sm font-semibold">{fmt(after)}</span>
        {delta !== null && (
          <span className={cn('text-xs font-medium',
            positive ? 'text-emerald-600' : negative ? 'text-destructive' : 'text-muted-foreground',
          )}>
            ({delta > 0 ? '+' : ''}{delta.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}
