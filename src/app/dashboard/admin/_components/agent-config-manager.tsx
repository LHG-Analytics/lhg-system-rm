'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings2, Loader2, Building2, Save, Globe, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { AgentConfig, CompetitorUrl } from '@/app/api/admin/agent-config/route'
import type { CompetitorSnapshot } from '@/app/api/agente/competitor-analysis/route'

interface Unit {
  id: string
  name: string
  slug: string
}

interface AgentConfigManagerProps {
  unitSlug: string
  unitName: string
  units: Unit[]
  initialConfig: AgentConfig | null
}

const STRATEGY_OPTIONS = [
  {
    value: 'conservador',
    label: 'Conservador',
    description: 'Variações menores, priorizando estabilidade. Indicado para unidades novas ou períodos de baixa demanda.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  {
    value: 'moderado',
    label: 'Moderado',
    description: 'Equilíbrio entre receita e volume. Padrão recomendado para a maioria dos cenários.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  {
    value: 'agressivo',
    label: 'Agressivo',
    description: 'Maximiza receita por locação. Indicado para unidades com alta demanda e baixa elasticidade.',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10 border-orange-500/30',
  },
] as const

const METRIC_OPTIONS = [
  { value: 'balanceado', label: 'Balanceado',  description: 'Otimiza todos os KPIs juntos: RevPAR, Giro, Ocupação e Ticket Médio (recomendado)' },
  { value: 'revpar',     label: 'RevPAR',      description: 'Prioriza receita por apartamento disponível acima dos demais KPIs' },
  { value: 'ocupacao',   label: 'Ocupação',    description: 'Maximiza taxa de ocupação, aceitando ticket menor se necessário' },
  { value: 'ticket',     label: 'Ticket médio', description: 'Foca em receita por locação, aceitando redução de volume' },
] as const

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

export function AgentConfigManager({ unitSlug, unitName, units, initialConfig }: AgentConfigManagerProps) {
  const router = useRouter()
  const [config, setConfig] = useState<AgentConfig | null>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Concorrentes ──────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<CompetitorSnapshot[]>([])
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addingCompetitor, setAddingCompetitor] = useState(false)
  const [analyzingUrl, setAnalyzingUrl] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Carrega snapshots existentes ao montar
  useEffect(() => {
    fetch(`/api/agente/competitor-analysis?unitSlug=${unitSlug}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSnapshots(data as CompetitorSnapshot[]))
      .catch(() => {})
  }, [unitSlug])

  const competitorUrls: CompetitorUrl[] = (config?.competitor_urls as unknown as CompetitorUrl[]) ?? []

  const selectedStrategy = STRATEGY_OPTIONS.find((s) => s.value === (config?.pricing_strategy ?? 'moderado'))

  // ─── Salvar configuração geral ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: config.unit_id,
          pricing_strategy: config.pricing_strategy,
          max_variation_pct: config.max_variation_pct,
          focus_metric: config.focus_metric,
          competitor_urls: competitorUrls,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setConfig(data as AgentConfig)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [config, competitorUrls])

  // ─── Adicionar concorrente ─────────────────────────────────────────────────
  const handleAddCompetitor = useCallback(async () => {
    const name = newName.trim()
    const url  = newUrl.trim()
    if (!name || !url || !config) return
    const updated = [...competitorUrls, { name, url }]
    setAddingCompetitor(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: config.unit_id, competitor_urls: updated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setConfig(data as AgentConfig)
      setNewName('')
      setNewUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setAddingCompetitor(false)
    }
  }, [config, competitorUrls, newName, newUrl])

  // ─── Remover concorrente ──────────────────────────────────────────────────
  const handleRemoveCompetitor = useCallback(async (url: string) => {
    if (!config) return
    const updated = competitorUrls.filter((c) => c.url !== url)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: config.unit_id, competitor_urls: updated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setConfig(data as AgentConfig)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    }
  }, [config, competitorUrls])

  // ─── Analisar concorrente ──────────────────────────────────────────────────
  const handleAnalyze = useCallback(async (competitor: CompetitorUrl) => {
    setAnalyzingUrl(competitor.url)
    setAnalyzeError(null)
    try {
      const res = await fetch('/api/agente/competitor-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug,
          competitorName: competitor.name,
          competitorUrl: competitor.url,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao analisar')
      // Atualiza snapshots com o novo resultado
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.competitor_url === competitor.url)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = data as CompetitorSnapshot
          return next
        }
        return [data as CompetitorSnapshot, ...prev]
      })
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setAnalyzingUrl(null)
    }
  }, [unitSlug])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* Seletor de unidade */}
        {units.length > 1 && (
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <Select value={unitSlug} onValueChange={(slug) => router.push(`/dashboard/admin?tab=config&unit=${slug}`)}>
              <SelectTrigger className="h-8 text-xs w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.slug} value={u.slug}>{u.name}</SelectItem>
                ))}
            </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            Configuração do Agente — {unitName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define o comportamento do agente RM ao gerar propostas de precificação.
          </p>
        </div>
      </div>

      {!config ? (
        <p className="text-sm text-muted-foreground">Configuração não encontrada para esta unidade.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          )}

          {/* Estratégia de precificação */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div>
              <Label className="text-sm font-semibold">Estratégia de precificação</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define a agressividade das propostas de ajuste de preço.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {STRATEGY_OPTIONS.map((opt) => {
                const active = config.pricing_strategy === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setConfig((prev) => prev ? { ...prev, pricing_strategy: opt.value } : prev)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors flex flex-col gap-1',
                      active ? opt.bg : 'border-border hover:bg-accent'
                    )}
                  >
                    <span className={cn('text-sm font-semibold', active ? opt.color : 'text-foreground')}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-snug">{opt.description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Variação máxima */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div>
              <Label className="text-sm font-semibold">Variação máxima por proposta</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Limite máximo de ajuste percentual em qualquer item da proposta (5%–30%).
              </p>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={5}
                max={30}
                step={5}
                value={config.max_variation_pct}
                onChange={(e) => setConfig((prev) => prev ? { ...prev, max_variation_pct: Number(e.target.value) } : prev)}
                className="flex-1 accent-primary"
              />
              <span className="text-lg font-semibold tabular-nums w-14 text-right">
                ±{config.max_variation_pct}%
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground/60 px-0.5">
              {[5, 10, 15, 20, 25, 30].map((v) => (
                <span key={v}>{v}%</span>
              ))}
            </div>
          </div>

          {/* Métrica de foco */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div>
              <Label className="text-sm font-semibold">Métrica de foco</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                KPI que o agente prioriza ao avaliar oportunidades de otimização.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {METRIC_OPTIONS.map((opt) => {
                const active = config.focus_metric === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setConfig((prev) => prev ? { ...prev, focus_metric: opt.value } : prev)}
                    className={cn(
                      'rounded-lg border p-3 text-left flex items-center gap-3 transition-colors',
                      active ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-accent'
                    )}
                  >
                    <div className={cn(
                      'size-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                      active ? 'border-primary' : 'border-muted-foreground/40'
                    )}>
                      {active && <div className="size-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <span className="text-sm font-medium">{opt.label}</span>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Resumo + salvar */}
          {selectedStrategy && (
            <div className="rounded-xl border bg-muted/30 px-4 py-3 flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                O agente usará estratégia <span className="font-semibold text-foreground">{selectedStrategy.label}</span>,
                focando em <span className="font-semibold text-foreground">{METRIC_OPTIONS.find((m) => m.value === config.focus_metric)?.label}</span>,
                com variação máxima de <span className="font-semibold text-foreground">±{config.max_variation_pct}%</span>.
              </p>
              <Button size="sm" className="gap-1.5 shrink-0" onClick={handleSave} disabled={saving}>
                {saving
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Save className="size-3.5" />
                }
                {saved ? 'Salvo!' : 'Salvar'}
              </Button>
            </div>
          )}

          {/* ─── Concorrentes ──────────────────────────────────────────────── */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div>
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Globe className="size-3.5 text-primary" />
                Análise de concorrentes
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cadastre sites de motéis concorrentes. O agente extrai e compara preços automaticamente.
              </p>
            </div>

            {analyzeError && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-3.5 shrink-0" />
                {analyzeError}
              </div>
            )}

            {/* Lista de concorrentes */}
            {competitorUrls.length > 0 && (
              <div className="flex flex-col gap-2">
                {competitorUrls.map((c) => {
                  const snap = snapshots.find((s) => s.competitor_url === c.url)
                  const isAnalyzing = analyzingUrl === c.url
                  return (
                    <div key={c.url} className="rounded-lg border bg-muted/20 px-3 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{c.url}</p>
                        {snap && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <CheckCircle2 className="size-3 text-emerald-500" />
                            {(snap.mapped_prices as unknown as unknown[]).length} preços extraídos · {timeAgo(snap.scraped_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => handleAnalyze(c)}
                          disabled={isAnalyzing}
                        >
                          {isAnalyzing
                            ? <Loader2 className="size-3 animate-spin" />
                            : <RefreshCw className="size-3" />
                          }
                          {isAnalyzing ? 'Analisando…' : snap ? 'Reanalisar' : 'Analisar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveCompetitor(c.url)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Adicionar novo concorrente */}
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nome (ex: Motel Paraíso)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="URL (ex: https://...)"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 self-start"
                onClick={handleAddCompetitor}
                disabled={!newName.trim() || !newUrl.trim() || addingCompetitor}
              >
                {addingCompetitor ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Adicionar concorrente
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
