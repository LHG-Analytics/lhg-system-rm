'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, TrendingUp, TrendingDown, Check, MessageSquarePlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Anomaly {
  id:              string
  detected_at:     string
  metric:          'revpar' | 'giro' | 'ocupacao' | 'ticket'
  scope:           Record<string, unknown>
  current_value:   number
  baseline_mean:   number
  baseline_stddev: number
  z_score:         number
  direction:       'positive_outlier' | 'negative_outlier'
  status:          'open' | 'acknowledged' | 'resolved'
  conv_id:         string | null
  notes:           string | null
}

interface Props {
  unitSlug: string
}

const METRIC_LABEL: Record<Anomaly['metric'], string> = {
  revpar:   'RevPAR',
  giro:     'Giro',
  ocupacao: 'Ocupação',
  ticket:   'Ticket Médio',
}

function fmtMetricValue(metric: Anomaly['metric'], value: number): string {
  if (metric === 'ocupacao') return `${value.toFixed(1)}%`
  if (metric === 'giro') return value.toFixed(2)
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60)        return 'agora'
  if (seconds < 3600)      return `${Math.floor(seconds / 60)}min`
  if (seconds < 86400)     return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function AnomaliesWidget({ unitSlug }: Props) {
  const router = useRouter()
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  const loadAnomalies = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/anomalies?unitSlug=${unitSlug}`)
      if (res.ok) {
        const data = (await res.json()) as Anomaly[]
        setAnomalies(data.filter((a) => a.status === 'open'))
      }
    } finally {
      setLoading(false)
    }
  }, [unitSlug])

  useEffect(() => { loadAnomalies() }, [loadAnomalies])

  const handleResolve = async (id: string) => {
    setUpdating(id)
    try {
      const res = await fetch('/api/admin/anomalies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'resolved' }),
      })
      if (res.ok) setAnomalies((prev) => prev.filter((a) => a.id !== id))
    } finally {
      setUpdating(null)
    }
  }

  const handleInvestigate = (anomaly: Anomaly) => {
    if (anomaly.conv_id) {
      router.push(`/dashboard/agente?unit=${unitSlug}&conv=${anomaly.conv_id}`)
    } else {
      const metric = METRIC_LABEL[anomaly.metric]
      const direction = anomaly.direction === 'negative_outlier' ? 'queda' : 'alta'
      const initialMessage = encodeURIComponent(
        `Detectei uma ${direction} anômala em ${metric} (z-score ${anomaly.z_score.toFixed(1)}). Valor atual: ${fmtMetricValue(anomaly.metric, anomaly.current_value)} vs baseline ${fmtMetricValue(anomaly.metric, anomaly.baseline_mean)}. Pode investigar?`
      )
      router.push(`/dashboard/agente?unit=${unitSlug}&q=${initialMessage}`)
    }
  }

  if (loading) return null
  if (!anomalies.length) return null

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-sm font-semibold">Anomalias detectadas</h3>
          <Badge variant="outline" className="text-[10px]">{anomalies.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Outliers vs baseline 90 dias (|z| &gt; 2). Cron diário detecta automaticamente.
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {anomalies.map((a) => {
          const Icon = a.direction === 'negative_outlier' ? TrendingDown : TrendingUp
          const colorClass = a.direction === 'negative_outlier'
            ? 'text-red-600 dark:text-red-400'
            : 'text-emerald-600 dark:text-emerald-400'

          return (
            <div key={a.id} className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
              <Icon className={cn('size-4 shrink-0 mt-0.5', colorClass)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium">{METRIC_LABEL[a.metric]}</span>
                  <Badge variant="outline" className="text-[10px] tabular-nums">
                    z = {a.z_score.toFixed(1)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(a.detected_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Atual <strong className={colorClass}>{fmtMetricValue(a.metric, a.current_value)}</strong>
                  {' '}vs baseline {fmtMetricValue(a.metric, a.baseline_mean)} ± {fmtMetricValue(a.metric, a.baseline_stddev)}
                </p>
                <div className="flex gap-1 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2"
                    onClick={() => handleInvestigate(a)}
                  >
                    <MessageSquarePlus className="size-3 mr-1" />
                    Investigar com agente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2"
                    disabled={updating === a.id}
                    onClick={() => handleResolve(a.id)}
                  >
                    {updating === a.id
                      ? <Loader2 className="size-3 animate-spin" />
                      : <><Check className="size-3 mr-1" />Resolver</>}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
