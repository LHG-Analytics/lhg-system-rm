'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings2, Loader2, Building2, Save, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
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
import type { AgentConfig } from '@/app/api/admin/agent-config/route'

interface AmenityCategory {
  name: string
  amenities: string
  expanded: boolean
}

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
  /** Quando true, oculta o header interno (título + seletor de unidade) */
  compact?: boolean
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
  { value: 'balanceado', label: 'Balanceado',   description: 'Otimiza todos os KPIs em conjunto: RevPAR, Giro, TRevPAR, Ocupação, Ticket e TMO (recomendado)' },
  { value: 'agressivo',  label: 'Agressivo',    description: 'Maximiza RevPAR e TRevPAR com variações mais ousadas — aceita risco maior para ganho maior' },
  { value: 'revpar',     label: 'RevPAR',       description: 'Prioriza receita por apartamento disponível como critério principal' },
  { value: 'giro',       label: 'Giro',         description: 'Prioriza o número de locações por suíte — mais rotatividade, mais receita total' },
  { value: 'ocupacao',   label: 'Ocupação',     description: 'Maximiza taxa de ocupação, aceitando ticket menor se necessário' },
  { value: 'ticket',     label: 'Ticket médio', description: 'Foca em receita por locação individual, aceitando menor volume' },
  { value: 'trevpar',    label: 'TRevPAR',      description: 'Receita total por apartamento (inclui serviços além da locação)' },
  { value: 'tmo',        label: 'TMO',          description: 'Tempo médio de ocupação — útil para otimizar giro em horários de pico' },
] as const

function configToCategories(amenities: Record<string, string[]> | undefined): AmenityCategory[] {
  if (!amenities) return []
  return Object.entries(amenities).map(([name, list]) => ({
    name,
    amenities: list.join('\n'),
    expanded: true,
  }))
}

function categoriesToRecord(cats: AmenityCategory[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const c of cats) {
    if (!c.name.trim()) continue
    result[c.name.trim()] = c.amenities.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  return result
}

export function AgentConfigManager({ unitSlug, unitName, units, initialConfig, compact = false }: AgentConfigManagerProps) {
  const router = useRouter()
  const [config, setConfig] = useState<AgentConfig | null>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [amenityCategories, setAmenityCategories] = useState<AmenityCategory[]>(() =>
    configToCategories(initialConfig?.suite_amenities)
  )
  const [savingAmenities, setSavingAmenities] = useState(false)
  const [savedAmenities, setSavedAmenities] = useState(false)

  // Auto-fetch config quando não recebida via props (ex: usado em Sheet no agente)
  useEffect(() => {
    if (config !== null) return
    fetch(`/api/admin/agent-config?unitSlug=${unitSlug}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return
        setConfig(data as AgentConfig)
        setAmenityCategories(configToCategories((data as AgentConfig).suite_amenities))
      })
      .catch(() => {})
  }, [unitSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAmenities = useCallback(async () => {
    if (!config) return
    setSavingAmenities(true)
    try {
      const suite_amenities = categoriesToRecord(amenityCategories)
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: config.unit_id, suite_amenities }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setConfig(data as AgentConfig)
      setSavedAmenities(true)
      setTimeout(() => setSavedAmenities(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSavingAmenities(false)
    }
  }, [config, amenityCategories])

  const selectedStrategy = STRATEGY_OPTIONS.find((s) => s.value === (config?.pricing_strategy ?? 'moderado'))

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: config.unit_id,
          pricing_strategy: config.pricing_strategy,
          max_variation_pct: config.max_variation_pct,
          focus_metric: config.focus_metric,
          city: config.city,
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
  }, [config])

  return (
    <div className="flex flex-col gap-6">
      {!compact && (
        <div className="flex flex-col gap-3">
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
      )}

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
            <div className="flex flex-col gap-2">
              {STRATEGY_OPTIONS.map((opt) => {
                const active = config.pricing_strategy === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setConfig((prev) => prev ? { ...prev, pricing_strategy: opt.value } : prev)}
                    className={cn(
                      'rounded-lg border px-4 py-3 text-left transition-colors flex items-start gap-3',
                      active ? opt.bg : 'border-border hover:bg-accent'
                    )}
                  >
                    <div className={cn(
                      'mt-0.5 size-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                      active ? `border-current ${opt.color}` : 'border-muted-foreground/40'
                    )}>
                      {active && <div className="size-2 rounded-full bg-current" />}
                    </div>
                    <div className="min-w-0">
                      <span className={cn('text-sm font-semibold', active ? opt.color : 'text-foreground')}>
                        {opt.label}
                      </span>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{opt.description}</p>
                    </div>
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
                type="range" min={5} max={30} step={5}
                value={config.max_variation_pct}
                onChange={(e) => setConfig((prev) => prev ? { ...prev, max_variation_pct: Number(e.target.value) } : prev)}
                className="flex-1 accent-primary"
              />
              <span className="text-lg font-semibold tabular-nums w-14 text-right">±{config.max_variation_pct}%</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground/60 px-0.5">
              {[5, 10, 15, 20, 25, 30].map((v) => <span key={v}>{v}%</span>)}
            </div>
          </div>

          {/* Métrica de foco */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div>
              <Label className="text-sm font-semibold">Métrica de foco</Label>
              <p className="text-xs text-muted-foreground mt-0.5">KPI que o agente prioriza ao avaliar oportunidades.</p>
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

          {/* Comodidades das suítes */}
          <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="text-sm font-semibold">Comodidades das suítes</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Uma comodidade por linha. Usadas pelo agente para comparar com concorrentes.
                </p>
              </div>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 shrink-0 text-xs"
                onClick={() => setAmenityCategories((prev) => [...prev, { name: '', amenities: '', expanded: true }])}
              >
                <Plus className="size-3.5" /> Categoria
              </Button>
            </div>

            {amenityCategories.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma categoria cadastrada.</p>
            )}

            <div className="flex flex-col gap-3">
              {amenityCategories.map((cat, idx) => (
                <div key={idx} className="rounded-lg border bg-background">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Input
                      value={cat.name}
                      onChange={(e) => setAmenityCategories((prev) => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                      placeholder="Nome da categoria (ex: CLUB)"
                      className="h-7 text-xs font-semibold flex-1 uppercase"
                    />
                    <button
                      onClick={() => setAmenityCategories((prev) => prev.map((c, i) => i === idx ? { ...c, expanded: !c.expanded } : c))}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {cat.expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    <button
                      onClick={() => setAmenityCategories((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {cat.expanded && (
                    <div className="px-3 pb-3">
                      <textarea
                        value={cat.amenities}
                        onChange={(e) => setAmenityCategories((prev) => prev.map((c, i) => i === idx ? { ...c, amenities: e.target.value } : c))}
                        placeholder={'Piscina aquecida\nHidromassagem\nSauna a vapor\n...'}
                        rows={6}
                        className="w-full resize-none rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {cat.amenities.split('\n').filter((s) => s.trim()).length} comodidades
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {amenityCategories.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSaveAmenities} disabled={savingAmenities}>
                  {savingAmenities ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  {savedAmenities ? 'Salvo!' : 'Salvar comodidades'}
                </Button>
              </div>
            )}
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
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {saved ? 'Salvo!' : 'Salvar'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
