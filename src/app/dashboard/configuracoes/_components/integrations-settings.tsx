'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, XCircle, Clock, Zap, Globe, Database, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntegrationStatus } from '@/app/api/admin/integrations/route'

const CATEGORY_LABELS: Record<string, string> = {
  ia:       'Inteligência Artificial',
  canais:   'Canais de Venda',
  dados:    'Dados e ERP',
  eventos:  'Eventos e Clima',
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  ia:      Zap,
  canais:  Globe,
  dados:   Database,
  eventos: Calendar,
}

function StatusBadge({ status }: { status: IntegrationStatus['status'] }) {
  if (status === 'connected') return (
    <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
      <CheckCircle2 className="size-2.5" /> Conectada
    </Badge>
  )
  if (status === 'not_configured') return (
    <Badge variant="outline" className="text-[10px] gap-1 bg-amber-500/10 text-amber-500 border-amber-500/20">
      <XCircle className="size-2.5" /> Não configurada
    </Badge>
  )
  return (
    <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
      <Clock className="size-2.5" /> Em breve
    </Badge>
  )
}

export function IntegrationsSettings() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/integrations')
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-sm">Verificando integrações…</span>
    </div>
  )

  const byCategory = integrations.reduce<Record<string, IntegrationStatus[]>>((acc, i) => {
    acc[i.category] = [...(acc[i.category] ?? []), i]
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(byCategory).map(([cat, items]) => {
        const Icon = CATEGORY_ICONS[cat] ?? Globe
        return (
          <div key={cat} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="size-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'rounded-xl border bg-card px-4 py-3 flex items-start justify-between gap-3',
                  item.status === 'coming_soon' && 'opacity-60'
                )}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                  {item.status === 'not_configured' && item.envVar && (
                    <p className="text-[11px] text-amber-500 mt-1">
                      Adicione a variável de ambiente <span className="font-mono bg-amber-500/10 px-1 rounded">{item.envVar}</span> na Vercel.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
