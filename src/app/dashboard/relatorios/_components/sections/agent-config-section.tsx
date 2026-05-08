'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Shield } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'

interface Props {
  data: WeeklyReportData['agentConfig']
}

const STRATEGY_LABELS: Record<string, string> = {
  conservador: 'Conservador',
  moderado: 'Moderado',
  agressivo: 'Agressivo',
}

const FOCUS_LABELS: Record<string, string> = {
  revpar: 'RevPAR',
  ocupacao: 'Ocupação',
  ticket: 'Ticket',
  trevpar: 'TRevPAR',
  giro: 'Giro',
  balanceado: 'Balanceado',
}

export function AgentConfigSection({ data }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="font-medium text-sm">⑪ Configuração ativa do agente</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Estratégia</p>
              <p className="font-medium">{STRATEGY_LABELS[data.pricingStrategy] ?? data.pricingStrategy}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Foco</p>
              <p className="font-medium">{FOCUS_LABELS[data.focusMetric] ?? data.focusMetric}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Variação máx.</p>
              <p className="font-medium">{data.maxVariationPct}%</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span><span className="font-medium">{data.guardrailsCount}</span> guardrail(s) configurado(s)</span>
          </div>

          {data.suiteCapacity.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Capacidade instalada</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left pb-1 font-medium">Categoria</th>
                    <th className="text-right pb-1 font-medium">Total</th>
                    <th className="text-right pb-1 font-medium">Disponíveis</th>
                    <th className="text-right pb-1 font-medium">Bloqueadas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suiteCapacity.map((s, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5">{s.categoria}</td>
                      <td className="text-right">{s.total}</td>
                      <td className="text-right text-emerald-600">{s.disponiveis}</td>
                      <td className="text-right">
                        {s.bloqueadas > 0 ? (
                          <span className="text-amber-600">{s.bloqueadas}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.sharedContext && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Contexto compartilhado</p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{data.sharedContext}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
