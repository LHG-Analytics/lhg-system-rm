'use client'

import { useState, Fragment } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'
import { useCurrency } from '@/components/currency-context'

interface Props {
  data: WeeklyReportData['demand']
}

// Pico/Diurno sempre antes de Fora de pico/Noturno — mesma ordem do widget do dashboard.
function turnoOrder(label: string): number {
  const l = label.toLowerCase()
  if (l.includes('pico') && !l.includes('fora')) return 0
  if (l.includes('diurno')) return 0
  return 1
}

export function DemandSection({ data }: Props) {
  const [open, setOpen] = useState(true)
  const { formatMoney: fm } = useCurrency()

  const turnoCategoryTable = data.turnoCategoryTable ?? []
  const hasData = data.channelMix.length > 0 || data.periodMix.length > 0 || turnoCategoryTable.length > 0

  if (!hasData) return null

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑥ Padrões de demanda</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5">
          {data.channelMix.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Mix por canal</p>
              <p className="text-xs text-muted-foreground mb-2">Canais de reserva digital — % sobre receita total da unidade.</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Canal</th>
                    <th className="text-right pb-1 font-medium">Atend.</th>
                    <th className="text-right pb-1 font-medium">Receita</th>
                    <th className="text-right pb-1 font-medium">Ticket</th>
                    <th className="text-right pb-1 font-medium">% Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channelMix
                    .sort((a, b) => b.receita - a.receita)
                    .map((c, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 font-medium">{c.label}</td>
                        <td className="text-right">{c.reservas}</td>
                        <td className="text-right">{fm(c.receita)}</td>
                        <td className="text-right">{c.reservas > 0 ? fm(c.receita / c.reservas, 2) : '—'}</td>
                        <td className="text-right">{c.representatividade.toFixed(1)}%</td>
                      </tr>
                    ))}
                </tbody>
                {(() => {
                  const totRes = data.channelMix.reduce((s, c) => s + c.reservas, 0)
                  const totRec = data.channelMix.reduce((s, c) => s + c.receita, 0)
                  const totPct = data.channelMix.reduce((s, c) => s + c.representatividade, 0)
                  return (
                    <tfoot>
                      <tr className="border-t font-semibold text-xs">
                        <td className="pt-1.5">Total</td>
                        <td className="text-right pt-1.5">{totRes}</td>
                        <td className="text-right pt-1.5">{fm(totRec)}</td>
                        <td className="text-right pt-1.5">{totRes > 0 ? fm(totRec / totRes, 2) : '—'}</td>
                        <td className="text-right pt-1.5">{totPct.toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          )}

          {data.periodMix.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Mix por período</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Período</th>
                    <th className="text-right pb-1 font-medium">Locações</th>
                    <th className="text-right pb-1 font-medium">Receita</th>
                    <th className="text-right pb-1 font-medium">Ticket</th>
                    <th className="text-right pb-1 font-medium">% Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periodMix.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 font-medium">{p.periodo}</td>
                      <td className="text-right">{p.locacoes}</td>
                      <td className="text-right">{fm(p.receita)}</td>
                      <td className="text-right">{fm(p.ticket, 2)}</td>
                      <td className="text-right">{p.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
                {(() => {
                  const totLoc = data.periodMix.reduce((s, p) => s + p.locacoes, 0)
                  const totRec = data.periodMix.reduce((s, p) => s + p.receita, 0)
                  const totPct = data.periodMix.reduce((s, p) => s + p.pct, 0)
                  return (
                    <tfoot>
                      <tr className="border-t font-semibold text-xs">
                        <td className="pt-1.5">Total</td>
                        <td className="text-right pt-1.5">{totLoc}</td>
                        <td className="text-right pt-1.5">{fm(totRec)}</td>
                        <td className="text-right pt-1.5">{totLoc > 0 ? fm(totRec / totLoc, 2) : '—'}</td>
                        <td className="text-right pt-1.5">{totPct.toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          )}

          {turnoCategoryTable.length > 0 && (() => {
            // Pivot: categoria nas linhas, turno agrupado nas colunas (Loc./Giro/Receita
            // por turno) — a listagem flat anterior (2 linhas por categoria, turno repetido)
            // dificultava comparar Diurno vs Noturno de uma mesma categoria.
            const turnos = [...new Set(turnoCategoryTable.map((r) => r.turno))]
              .sort((a, b) => turnoOrder(a) - turnoOrder(b))

            const byCategoria = new Map<string, Map<string, { locacoes: number; giro: number; receita: number; capacidade: number }>>()
            for (const r of turnoCategoryTable) {
              if (!byCategoria.has(r.categoria)) byCategoria.set(r.categoria, new Map())
              byCategoria.get(r.categoria)!.set(r.turno, { locacoes: r.locacoes, giro: r.giro, receita: r.receita, capacidade: r.capacidade ?? 0 })
            }

            const categorias = [...byCategoria.keys()].sort((a, b) => {
              const totalA = [...byCategoria.get(a)!.values()].reduce((s, v) => s + v.receita, 0)
              const totalB = [...byCategoria.get(b)!.values()].reduce((s, v) => s + v.receita, 0)
              return totalB - totalA
            })

            // Giro total do turno = soma das locações ÷ soma das capacidades (suítes-dia) de
            // todas as categorias — nunca a média/soma dos giros já arredondados por categoria,
            // que distorceria o resultado (cada categoria tem capacidade diferente).
            const totalByTurno = new Map(turnos.map((t) => {
              const agg = categorias.reduce((acc, cat) => {
                const cell = byCategoria.get(cat)?.get(t)
                return {
                  locacoes: acc.locacoes + (cell?.locacoes ?? 0),
                  receita: acc.receita + (cell?.receita ?? 0),
                  capacidade: acc.capacidade + (cell?.capacidade ?? 0),
                }
              }, { locacoes: 0, receita: 0, capacidade: 0 })
              const giro = agg.capacidade > 0 ? agg.locacoes / agg.capacidade : null
              return [t, { ...agg, giro }] as const
            }))

            return (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Giro e receita por turno × categoria</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th rowSpan={2} className="text-left pb-1 font-medium align-bottom">Categoria</th>
                        {turnos.map((t) => (
                          <th key={t} colSpan={3} className="text-center pb-1 font-medium border-l">{t}</th>
                        ))}
                      </tr>
                      <tr className="text-[11px] text-muted-foreground border-b">
                        {turnos.map((t) => (
                          <Fragment key={t}>
                            <th className="text-right pb-1 font-normal border-l">Loc.</th>
                            <th className="text-right pb-1 font-normal">Giro</th>
                            <th className="text-right pb-1 font-normal">Receita</th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {categorias.map((cat) => (
                        <tr key={cat} className="border-b last:border-0">
                          <td className="py-1.5 font-medium whitespace-nowrap">{cat}</td>
                          {turnos.map((t) => {
                            const cell = byCategoria.get(cat)?.get(t)
                            return (
                              <Fragment key={t}>
                                <td className="text-right border-l">{cell ? cell.locacoes : '—'}</td>
                                <td className="text-right">{cell ? cell.giro.toFixed(2) : '—'}</td>
                                <td className="text-right">{cell ? fm(cell.receita) : '—'}</td>
                              </Fragment>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-semibold text-xs">
                        <td className="pt-1.5">Total</td>
                        {turnos.map((t) => {
                          const tot = totalByTurno.get(t)!
                          return (
                            <Fragment key={t}>
                              <td className="text-right pt-1.5 border-l">{tot.locacoes}</td>
                              <td className="text-right pt-1.5">{tot.giro !== null ? tot.giro.toFixed(2) : '—'}</td>
                              <td className="text-right pt-1.5">{fm(tot.receita)}</td>
                            </Fragment>
                          )
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
