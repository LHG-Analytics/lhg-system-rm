'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['intelligence']
}

const VERDICT_STYLE = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  failure: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  neutral: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
} as const

const VERDICT_LABEL = {
  success: '✓ Positivo',
  failure: '✕ Negativo',
  neutral: '— Neutro',
  unknown: '? Sem dados',
} as const

export function IntelligenceSection({ data }: Props) {
  const [open, setOpen] = useState(true)
  const insights = data.historicalInsights ?? []

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑩ O que o agente aprendeu no período</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {data.weekHighlight && (
            <div className="text-sm bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Destaque do período</p>
              <p>{data.weekHighlight}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Novas lições" value={data.newLessonsCount} />
            <Stat label="Elasticidades calculadas" value={data.elasticityUpdatedCount} />
            <Stat label="Anomalias detectadas" value={data.anomaliesDetected.length} accent="amber" />
            <Stat label="Anomalias resolvidas" value={data.anomaliesResolved.length} accent="emerald" />
          </div>

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

          {insights.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Aprendizado das tabelas históricas
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Comparação dos primeiros 30 dias de cada tabela importada para medir o impacto real das mudanças de preço.
              </p>
              <div className="space-y-3">
                {insights.map((insight, i) => {
                  const fromLabel = format(new Date(insight.fromDate + 'T12:00:00Z'), "MMM'/'yy", { locale: ptBR })
                  const toLabel = format(new Date(insight.toDate + 'T12:00:00Z'), "MMM'/'yy", { locale: ptBR })
                  return (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium">
                          Tabela {fromLabel} → {toLabel}
                        </span>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', VERDICT_STYLE[insight.verdict])}>
                          {VERDICT_LABEL[insight.verdict]}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-3 mb-2">
                        <span className="text-xs text-muted-foreground">
                          {insight.changesCount} preço(s) alterado(s) — média {insight.avgChangePct > 0 ? '+' : ''}{insight.avgChangePct.toFixed(1)}%
                        </span>
                        {insight.deltaRevpar !== null && (
                          <span className={cn('text-xs font-medium', insight.deltaRevpar > 0 ? 'text-emerald-600' : 'text-destructive')}>
                            RevPAR {insight.deltaRevpar > 0 ? '+' : ''}{insight.deltaRevpar.toFixed(1)}%
                          </span>
                        )}
                        {insight.deltaGiro !== null && (
                          <span className={cn('text-xs font-medium', insight.deltaGiro > 0 ? 'text-emerald-600' : insight.deltaGiro < -5 ? 'text-destructive' : 'text-muted-foreground')}>
                            Giro {insight.deltaGiro > 0 ? '+' : ''}{insight.deltaGiro.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      {insight.kpiBefore && insight.kpiAfter && (
                        <div className="grid grid-cols-2 gap-2 mb-2 text-xs text-muted-foreground">
                          <div>Antes: RevPAR R$ {insight.kpiBefore.revpar.toFixed(2)} · Giro {insight.kpiBefore.giro.toFixed(2)}</div>
                          <div>Depois: RevPAR R$ {insight.kpiAfter.revpar.toFixed(2)} · Giro {insight.kpiAfter.giro.toFixed(2)}</div>
                        </div>
                      )}

                      {insight.topChanges.length > 0 && (
                        <div className="space-y-0.5">
                          {insight.topChanges.slice(0, 4).map((c, j) => (
                            <div key={j} className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="truncate">{c.categoria} · {c.periodo} · {c.diaTipo}</span>
                              <span className="shrink-0">→</span>
                              <span className={cn('shrink-0 font-medium', c.variacaoPct > 0 ? 'text-emerald-600' : 'text-destructive')}>
                                {c.variacaoPct > 0 ? '+' : ''}{c.variacaoPct.toFixed(1)}%
                                {' '}(R${c.precoAnterior.toFixed(0)}→R${c.precoNovo.toFixed(0)})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'amber' | 'emerald' }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-xl font-semibold',
        accent === 'amber' && value > 0 ? 'text-amber-600' :
        accent === 'emerald' && value > 0 ? 'text-emerald-600' : ''
      )}>
        {value}
      </p>
    </div>
  )
}
