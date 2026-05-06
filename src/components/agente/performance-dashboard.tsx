'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, Clock, BarChart3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PerformanceData, LessonCheckpoint } from '@/app/api/agente/performance/route'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, decimals = 1) {
  if (v == null) return '—'
  const s = v >= 0 ? '+' : ''
  return `${s}${v.toFixed(decimals)}%`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })
}

function VerdictIcon({ verdict }: { verdict: LessonCheckpoint['verdict'] }) {
  if (verdict === 'success') return <CheckCircle2 className="size-3.5 text-emerald-500" />
  if (verdict === 'failure') return <XCircle className="size-3.5 text-destructive" />
  return <Minus className="size-3.5 text-muted-foreground" />
}

function CheckpointBadge({ cp }: { cp: LessonCheckpoint }) {
  const color =
    cp.verdict === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
    cp.verdict === 'failure' ? 'border-destructive/40 bg-destructive/10 text-destructive' :
    'border-border bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums', color)}>
      <VerdictIcon verdict={cp.verdict} />
      {cp.checkpoint_days}d
      {cp.delta_revpar_pct != null && (
        <span className="opacity-70">{fmtPct(cp.delta_revpar_pct)}</span>
      )}
    </span>
  )
}

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  unitSlug: string
}

export function PerformanceDashboard({ unitSlug }: Props) {
  const [data, setData]     = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!unitSlug) return
    setLoading(true)
    fetch(`/api/agente/performance?unitSlug=${unitSlug}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: PerformanceData) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [unitSlug])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {error ?? 'Sem dados disponíveis'}
      </div>
    )
  }

  const { total_approved, total_rejected, lessons_total, success_count, neutral_count, failure_count,
          success_rate, avg_delta_revpar, avg_delta_giro, proposals, top_categories, worst_categories } = data

  return (
    <div className="space-y-6">

      {/* ── Cards resumo ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Propostas aprovadas"
          value={String(total_approved)}
          sub={`${total_rejected} rejeitadas`}
          icon={<ClipboardCheckIcon />}
        />
        <SummaryCard
          label="Taxa de acerto"
          value={success_rate != null ? `${(success_rate * 100).toFixed(0)}%` : '—'}
          sub={`${success_count} ok · ${neutral_count} neutro · ${failure_count} falha`}
          positive={success_rate != null ? success_rate >= 0.6 : null}
        />
        <SummaryCard
          label="Δ RevPAR médio"
          value={fmtPct(avg_delta_revpar)}
          sub={`${lessons_total} checkpoints`}
          positive={avg_delta_revpar != null ? avg_delta_revpar >= 0 : null}
        />
        <SummaryCard
          label="Δ Giro médio"
          value={fmtPct(avg_delta_giro)}
          sub="volume de locações"
          positive={avg_delta_giro != null ? avg_delta_giro >= 0 : null}
        />
      </div>

      {/* ── Histórico de propostas ────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Propostas aprovadas — últimos 90 dias
        </h3>
        {proposals.length === 0 ? (
          <Empty>Nenhuma proposta aprovada com checkpoint registrado.</Empty>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Data</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Alterações</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Checkpoints</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Melhor resultado</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                      {fmtDate(p.created_at)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{p.n_changes}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.checkpoints.length > 0
                          ? p.checkpoints.map((cp) => <CheckpointBadge key={cp.checkpoint_days} cp={cp} />)
                          : <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="size-3" />Aguardando</span>
                        }
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {p.best_checkpoint ? (
                        <div className="flex items-center gap-1.5">
                          <VerdictIcon verdict={p.best_checkpoint.verdict} />
                          <span className={cn(
                            'font-medium',
                            p.best_checkpoint.verdict === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                            p.best_checkpoint.verdict === 'failure' ? 'text-destructive' : 'text-muted-foreground'
                          )}>
                            {p.best_checkpoint.verdict === 'success' ? 'Sucesso' :
                             p.best_checkpoint.verdict === 'failure' ? 'Falha' : 'Neutro'}
                          </span>
                          {p.best_checkpoint.delta_revpar_pct != null && (
                            <span className="text-muted-foreground">
                              RevPAR {fmtPct(p.best_checkpoint.delta_revpar_pct)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Insights por categoria ────────────────────────────────────── */}
      {(top_categories.length > 0 || worst_categories.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CategoryTable
            title="Melhores categorias"
            icon={<TrendingUp className="size-3.5 text-emerald-500" />}
            rows={top_categories}
            positive
          />
          <CategoryTable
            title="Categorias com queda"
            icon={<TrendingDown className="size-3.5 text-destructive" />}
            rows={worst_categories}
            positive={false}
          />
        </div>
      )}

      {lessons_total === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <BarChart3 className="mx-auto mb-3 size-8 opacity-30" />
          Nenhum checkpoint de lição disponível ainda.
          <br />Os dados aparecerão após 7, 14 e 28 dias das propostas aprovadas.
        </div>
      )}
    </div>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────────

function ClipboardCheckIcon() {
  return (
    <svg className="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 0-1 0 2 2 0 0 0 2-2h2a2 2 0 0 0 2 2m-6 9 2 2 4-4" />
    </svg>
  )
}

function SummaryCard({ label, value, sub, positive, icon }: {
  label: string; value: string; sub: string; positive?: boolean | null; icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className={cn(
        'text-xl font-semibold tabular-nums',
        positive === true ? 'text-emerald-600 dark:text-emerald-400' :
        positive === false ? 'text-destructive' : ''
      )}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}

function CategoryTable({ title, icon, rows, positive }: {
  title: string; icon: React.ReactNode
  rows: PerformanceData['top_categories']; positive: boolean
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{title}
      </h3>
      {rows.length === 0 ? (
        <Empty>Sem dados suficientes.</Empty>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Categoria / Período</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Δ RevPAR</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">S/F</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.categoria}-${r.periodo}-${r.dia_tipo}`} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{r.categoria}</div>
                    <div className="text-[10px] text-muted-foreground">{r.periodo} · {r.dia_tipo}</div>
                  </td>
                  <td className={cn(
                    'px-3 py-2 text-right font-medium tabular-nums',
                    positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                  )}>
                    {fmtPct(r.avg_delta_revpar)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {r.successes}/{r.failures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  )
}
