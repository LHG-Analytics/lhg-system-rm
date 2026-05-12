'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, XCircle, Minus, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WeeklyReportData } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['pricing']
}

const verdictConfig = {
  success: { icon: CheckCircle, color: 'text-emerald-600', label: 'Acerto' },
  neutral:  { icon: Minus,       color: 'text-muted-foreground', label: 'Neutro' },
  failure:  { icon: XCircle,    color: 'text-destructive', label: 'Falha' },
}

const PERIOD_ORDER = ['3 horas', '3h', '6 horas', '6h', '12 horas', '12h', 'Day Use', 'Diária', 'Pernoite', 'pernoite']
const CANAL_PRIORITY = ['balcao_site', 'guia_moteis', 'site_imediato', 'booking']

// "3 horas" → "3hr" · "12h" → "12hr" · "Day Use" → "Day Use" (unchanged)
function abbrevPeriod(p: string): string {
  return p.replace(/^(\d+)\s+horas?$/i, '$1hr').replace(/^(\d+)h$/, '$1hr')
}

function buildPriceMatrix(rows: { categoria: string; periodo: string; diaTipo: string; canal: string; preco: number }[]) {
  // Collect unique periods, sorted by PERIOD_ORDER
  const periodSet = new Set(rows.map(r => r.periodo))
  const periods = PERIOD_ORDER.filter(p => periodSet.has(p)).concat([...periodSet].filter(p => !PERIOD_ORDER.includes(p)))

  // Columns: period × diaTipo (semana first, then fds_feriado)
  const cols: { periodo: string; diaTipo: string; label: string }[] = []
  for (const p of periods) {
    const hasWeek = rows.some(r => r.periodo === p && r.diaTipo === 'semana')
    const hasFds  = rows.some(r => r.periodo === p && r.diaTipo === 'fds_feriado')
    const hasTodos = rows.some(r => r.periodo === p && r.diaTipo === 'todos')
    if (hasTodos && !hasWeek && !hasFds) {
      cols.push({ periodo: p, diaTipo: 'todos', label: abbrevPeriod(p) })
    } else {
      if (hasWeek) cols.push({ periodo: p, diaTipo: 'semana', label: `${abbrevPeriod(p)} Sem` })
      if (hasFds)  cols.push({ periodo: p, diaTipo: 'fds_feriado', label: `${abbrevPeriod(p)} FDS` })
    }
  }

  // Rows: unique categories
  const cats = [...new Set(rows.map(r => r.categoria))].sort()

  // Matrix: cat → col → price
  const matrix: Record<string, Record<string, number | null>> = {}
  for (const cat of cats) {
    matrix[cat] = {}
    for (const col of cols) {
      const matching = rows.filter(r =>
        r.categoria === cat &&
        r.periodo === col.periodo &&
        (r.diaTipo === col.diaTipo || (col.diaTipo === 'todos' && r.diaTipo === 'todos'))
      )
      let price: number | null = null
      for (const canal of CANAL_PRIORITY) {
        const match = matching.find(r => r.canal === canal)
        if (match) { price = match.preco; break }
      }
      if (price === null && matching.length > 0) price = matching[0].preco
      matrix[cat][`${col.periodo}|${col.diaTipo}`] = price
    }
  }

  return { cols, cats, matrix }
}

export function PricingSection({ data }: Props) {
  const [open, setOpen] = useState(true)
  const { symbol } = useCurrency()

  const hasContent = data.activePriceTable || data.proposalsApprovedThisWeek.length > 0 ||
    data.lessonsCompleted.length > 0 || data.elasticityHighlights.length > 0

  if (!hasContent) return null

  const rows = data.activePriceTable?.rows ?? []
  const { cols, cats, matrix } = rows.length > 0 ? buildPriceMatrix(rows) : { cols: [], cats: [], matrix: {} }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">⑤ Tabela de preços ativa</h3>
          {data.proposalsApprovedThisWeek.length > 0 && (
            <Badge variant="secondary">{data.proposalsApprovedThisWeek.length} proposta(s) aprovada(s)</Badge>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5">
          {/* Tabela pivotada de preços */}
          {data.activePriceTable && cols.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Preços vigentes desde {data.activePriceTable.validFrom}
                <span className="ml-2 normal-case font-normal">(canal: balcão/site)</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left pb-1 font-medium pr-4">Categoria</th>
                      {cols.map(c => (
                        <th key={`${c.periodo}|${c.diaTipo}`} className="text-right pb-1 font-medium px-2 whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cats.map(cat => (
                      <tr key={cat} className="border-b last:border-0">
                        <td className="py-1.5 font-medium pr-4">{cat}</td>
                        {cols.map(c => {
                          const price = matrix[cat]?.[`${c.periodo}|${c.diaTipo}`]
                          return (
                            <td key={`${c.periodo}|${c.diaTipo}`} className="text-right px-2 text-muted-foreground">
                              {price != null ? `${symbol} ${price.toFixed(0)}` : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Propostas aprovadas */}
          {data.proposalsApprovedThisWeek.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Propostas aprovadas neste período</p>
              <div className="space-y-1">
                {data.proposalsApprovedThisWeek.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                    <span>{p.rowsCount} linhas · variação média {p.avgVariacaoPct > 0 ? '+' : ''}{p.avgVariacaoPct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lições */}
          {data.lessonsCompleted.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Lições com checkpoint concluído</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Categoria / Período</th>
                    <th className="text-right pb-1 font-medium">Δ Preço</th>
                    <th className="text-right pb-1 font-medium">Δ RevPAR</th>
                    <th className="text-right pb-1 font-medium">Δ Giro</th>
                    <th className="text-right pb-1 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lessonsCompleted.map((l, i) => {
                    const vc = verdictConfig[l.verdict]
                    const VIcon = vc.icon
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5">{l.categoria} {l.periodo} ({l.diaTipo})</td>
                        <td className="text-right">{l.variacaoPct > 0 ? '+' : ''}{l.variacaoPct.toFixed(1)}%</td>
                        <td className={cn('text-right', l.deltaRevpar >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                          {l.deltaRevpar >= 0 ? '+' : ''}{l.deltaRevpar.toFixed(2)}
                        </td>
                        <td className={cn('text-right', l.deltaGiro >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                          {l.deltaGiro >= 0 ? '+' : ''}{l.deltaGiro.toFixed(2)}
                        </td>
                        <td className="text-right">
                          <span className={cn('flex items-center justify-end gap-1', vc.color)}>
                            <VIcon className="w-3.5 h-3.5" />
                            <span className="text-xs">{vc.label}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Elasticidades */}
          {data.elasticityHighlights.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Elasticidades observadas</p>
              <div className="space-y-1">
                {data.elasticityHighlights.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">{e.categoria} {e.periodo}</span>
                    <span className="text-muted-foreground">({e.diaTipo})</span>
                    <Badge variant={e.confidence === 'high' ? 'default' : 'secondary'} className="text-xs">
                      ε={e.elasticity.toFixed(2)} · {e.confidence}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{e.interpretation}</span>
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
