'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['demand']
}

export function DemandSection({ data }: Props) {
  const [open, setOpen] = useState(true)

  const hasData = data.channelMix.length > 0 || data.periodMix.length > 0

  if (!hasData) return null

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑦ Padrões de demanda</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5">
          {data.channelMix.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Mix por canal</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Canal</th>
                    <th className="text-right pb-1 font-medium">Reservas</th>
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
                        <td className="text-right">{c.receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</td>
                        <td className="text-right">{c.reservas > 0 ? (c.receita / c.reservas).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }) : '—'}</td>
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
                        <td className="text-right pt-1.5">{totRec.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</td>
                        <td className="text-right pt-1.5">{totRes > 0 ? (totRec / totRes).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }) : '—'}</td>
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
                      <td className="text-right">{p.receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</td>
                      <td className="text-right">{p.ticket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })}</td>
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
                        <td className="text-right pt-1.5">{totRec.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</td>
                        <td className="text-right pt-1.5">{totLoc > 0 ? (totRec / totLoc).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }) : '—'}</td>
                        <td className="text-right pt-1.5">{totPct.toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
