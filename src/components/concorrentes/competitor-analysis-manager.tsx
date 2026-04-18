'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Globe, Plus, Trash2, RefreshCw, CheckCircle2,
  AlertCircle, Zap, Link2, Loader2, Building2, Sparkles, Tag,
} from 'lucide-react'
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
import type { AgentConfig, CompetitorUrl, CompetitorUrlEntry } from '@/app/api/admin/agent-config/route'
import type { CompetitorSnapshot } from '@/app/api/agente/competitor-analysis/route'

interface Unit {
  id: string
  name: string
  slug: string
}

interface MappedPrice {
  categoria_concorrente: string
  periodo: string
  dia_tipo: 'semana' | 'fds_feriado' | 'todos'
  preco: number
  categoria_nossa?: string | null
}

interface CompetitorAnalysisManagerProps {
  unitSlug: string
  unitName: string
  units: Unit[]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

function isGuiaSite(url: string): boolean {
  return /guiademoteis\.com\.br|moteisprime\.com|guia/i.test(url)
}

function suggestNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1] ?? ''
    if (last.startsWith('suite-')) {
      return last.replace(/^suite-/, '').split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
    // Página do motel: usa a cidade do path
    const city = parts[0] ?? ''
    const brand = u.hostname.replace(/^www\./, '').split('.')[0]
    const brandLabel = brand.charAt(0).toUpperCase() + brand.slice(1)
    return city ? `${brandLabel} ${city}` : brandLabel
  } catch { return '' }
}

function normalizeCompetitor(c: CompetitorUrl): CompetitorUrl {
  if (c.urls && c.urls.length > 0) return c
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const legacyUrl = (c as { url?: string }).url
  if (legacyUrl) return { name: c.name, urls: [{ url: legacyUrl }], mode: c.mode }
  return { name: c.name, urls: [], mode: c.mode }
}

export function CompetitorAnalysisManager({ unitSlug, unitName, units }: CompetitorAnalysisManagerProps) {
  const router = useRouter()
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Carrega config ao montar
  useEffect(() => {
    fetch(`/api/admin/agent-config?unitSlug=${unitSlug}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => data && setConfig(data as AgentConfig))
      .catch(() => {})
  }, [unitSlug])

  const [snapshots, setSnapshots] = useState<CompetitorSnapshot[]>([])
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newMode, setNewMode] = useState<'cheerio' | 'playwright' | 'guia'>('cheerio')
  const [addingCompetitor, setAddingCompetitor] = useState(false)
  const [analyzingUrls, setAnalyzingUrls] = useState<Set<string>>(new Set())
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [expandedPricesUrl, setExpandedPricesUrl] = useState<string | null>(null)
  const [addingUrlTo, setAddingUrlTo] = useState<string | null>(null)
  const [extraUrl, setExtraUrl] = useState('')
  const [extraLabel, setExtraLabel] = useState('')

  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  // Carrega snapshots ao montar + retoma polling para runs em processamento
  useEffect(() => {
    fetch(`/api/agente/competitor-analysis?unitSlug=${unitSlug}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: CompetitorSnapshot[]) => {
        setSnapshots(data)
        data.forEach((snap) => {
          if (snap.status === 'processing' && snap.apify_run_id) {
            setAnalyzingUrls((prev) => new Set([...prev, snap.competitor_url]))
            startPolling(snap.competitor_url, snap.apify_run_id!, snap.competitor_name)
          }
        })
      })
      .catch(() => {})
    return () => { pollingRef.current.forEach((t) => clearInterval(t)) }
  }, [unitSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const competitorUrls: CompetitorUrl[] = (
    (config?.competitor_urls as unknown as CompetitorUrl[]) ?? []
  ).map(normalizeCompetitor)

  const saveCompetitors = useCallback(async (updated: CompetitorUrl[]) => {
    if (!config) return false
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: config.unit_id, competitor_urls: updated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setConfig(data as AgentConfig)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
      return false
    }
  }, [config])

  const startPolling = useCallback((url: string, runId: string, name: string) => {
    if (pollingRef.current.has(url)) clearInterval(pollingRef.current.get(url)!)

    const params = new URLSearchParams({ runId, unitSlug, competitorUrl: url, competitorName: name })
    const maxAttempts = 30
    let attempts = 0

    const timer = setInterval(async () => {
      attempts++
      try {
        const res = await fetch(`/api/agente/competitor-analysis?${params}`)
        const data = await res.json() as { status?: string; error?: string; id?: string } & Partial<CompetitorSnapshot>
        if (data.status === 'processing') return

        clearInterval(timer)
        pollingRef.current.delete(url)
        setAnalyzingUrls((prev) => { const n = new Set(prev); n.delete(url); return n })

        if (data.id) {
          setSnapshots((prev) => {
            const idx = prev.findIndex((s) => s.competitor_url === url)
            const snap = data as CompetitorSnapshot
            if (idx >= 0) { const next = [...prev]; next[idx] = snap; return next }
            return [snap, ...prev]
          })
        } else {
          setAnalyzeError(data.error ?? 'Análise Playwright falhou.')
        }
      } catch { /* erro de rede — tenta novamente */ }

      if (attempts >= maxAttempts) {
        clearInterval(timer)
        pollingRef.current.delete(url)
        setAnalyzingUrls((prev) => { const n = new Set(prev); n.delete(url); return n })
        setAnalyzeError('Tempo limite atingido. O Playwright não retornou resultado.')
      }
    }, 4000)

    pollingRef.current.set(url, timer)
  }, [unitSlug])

  const analyzeUrl = useCallback(async (
    competitorName: string,
    entry: CompetitorUrlEntry,
    mode: 'cheerio' | 'playwright' | 'guia',
  ) => {
    const url = entry.url.trim()
    if (!url) return
    setAnalyzingUrls((prev) => new Set([...prev, url]))
    setAnalyzeError(null)
    try {
      const res = await fetch('/api/agente/competitor-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug, competitorName, competitorUrl: url, mode }),
      })
      const data = await res.json() as { status?: string; runId?: string; error?: string } & Partial<CompetitorSnapshot>
      if (!res.ok) throw new Error(data.error ?? 'Erro ao analisar')

      if (data.status === 'processing' && data.runId) {
        startPolling(url, data.runId, competitorName)
        return
      }
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.competitor_url === url)
        const snap = data as CompetitorSnapshot
        if (idx >= 0) { const next = [...prev]; next[idx] = snap; return next }
        return [snap, ...prev]
      })
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      if (!pollingRef.current.has(url)) {
        setAnalyzingUrls((prev) => { const n = new Set(prev); n.delete(url); return n })
      }
    }
  }, [unitSlug, startPolling])

  const handleAddCompetitor = useCallback(async () => {
    const name = newName.trim()
    const url  = newUrl.trim()
    if (!name || !url || !config) return
    const entry: CompetitorUrlEntry = { url, ...(newLabel.trim() ? { label: newLabel.trim() } : {}) }
    const newEntry: CompetitorUrl = { name, urls: [entry], mode: newMode }
    const updated = [...competitorUrls, newEntry]

    setAddingCompetitor(true)
    const ok = await saveCompetitors(updated)
    setAddingCompetitor(false)
    if (!ok) return

    setNewName(''); setNewUrl(''); setNewLabel(''); setNewMode('cheerio')
    analyzeUrl(name, entry, newMode)
  }, [config, competitorUrls, newName, newUrl, newLabel, newMode, saveCompetitors, analyzeUrl])

  const handleAddExtraUrl = useCallback(async (competitorName: string) => {
    const url = extraUrl.trim()
    if (!url || !config) return
    const entry: CompetitorUrlEntry = { url, ...(extraLabel.trim() ? { label: extraLabel.trim() } : {}) }
    const updated = competitorUrls.map((c) =>
      c.name === competitorName
        ? { ...c, urls: [...(c.urls ?? []), entry] }
        : c
    )
    const ok = await saveCompetitors(updated)
    if (!ok) return
    setExtraUrl(''); setExtraLabel(''); setAddingUrlTo(null)
    const competitor = competitorUrls.find((c) => c.name === competitorName)
    analyzeUrl(competitorName, entry, (competitor?.mode as 'cheerio' | 'playwright' | 'guia') ?? 'cheerio')
  }, [config, competitorUrls, extraUrl, extraLabel, saveCompetitors, analyzeUrl])

  const handleRemoveUrl = useCallback(async (competitorName: string, url: string) => {
    if (!config) return
    const updated = competitorUrls
      .map((c) =>
        c.name === competitorName
          ? { ...c, urls: c.urls.filter((u) => u.url !== url) }
          : c
      )
      .filter((c) => c.urls.length > 0)
    await saveCompetitors(updated)
  }, [config, competitorUrls, saveCompetitors])

  return (
    <div className="flex flex-col gap-6">
      {/* Header + seletor de unidade */}
      <div className="flex flex-col gap-3">
        {units.length > 1 && (
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <Select
              value={unitSlug}
              onValueChange={(slug) => router.push(`/dashboard/concorrentes?unit=${slug}`)}
            >
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
            <Globe className="size-4 text-primary" />
            Análise de concorrentes — {unitName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cada concorrente pode ter múltiplas URLs. A análise extrai preços via IA e roda em segundo plano.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!config ? (
        <p className="text-sm text-muted-foreground">Carregando configuração…</p>
      ) : (
        <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
          {analyzeError && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="size-3.5 shrink-0" />
              {analyzeError}
            </div>
          )}

          {/* Lista de concorrentes agrupados */}
          {competitorUrls.length > 0 && (
            <div className="flex flex-col gap-3">
              {competitorUrls.map((c) => (
                <div key={c.name} className="rounded-lg border bg-muted/20 p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold flex-1">{c.name}</p>
                    {c.mode === 'guia' && (
                      <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <Sparkles className="size-2.5" /> Guia GM
                      </span>
                    )}
                    {c.mode === 'playwright' && (
                      <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-500 border border-violet-500/20">
                        <Zap className="size-2.5" /> Interativo
                      </span>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2"
                      onClick={() => setAddingUrlTo(addingUrlTo === c.name ? null : c.name)}
                    >
                      <Link2 className="size-3" /> + URL
                    </Button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {c.urls.map((entry) => {
                      const snap = snapshots.find((s) => s.competitor_url === entry.url)
                      const isAnalyzing = analyzingUrls.has(entry.url)
                      const isProcessing = snap?.status === 'processing'
                      return (
                        <div key={entry.url} className="flex flex-col gap-1">
                          <div className="rounded-md border bg-background px-2.5 py-2 flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              {entry.label && (
                                <p className="text-[11px] font-medium text-foreground">{entry.label}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground truncate">{entry.url}</p>
                              {(snap && snap.status !== 'processing') && (
                                <button
                                  onClick={() => setExpandedPricesUrl(expandedPricesUrl === entry.url ? null : entry.url)}
                                  className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 hover:text-foreground transition-colors"
                                >
                                  <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                                  {(snap.mapped_prices as unknown as MappedPrice[]).length} preços · {timeAgo(snap.scraped_at)}
                                  <span className="text-primary underline-offset-2 underline">
                                    {expandedPricesUrl === entry.url ? 'ocultar' : 'ver'}
                                  </span>
                                </button>
                              )}
                              {(isAnalyzing || isProcessing) && !snap?.id && (
                                <p className="text-[11px] text-violet-500 mt-0.5 flex items-center gap-1">
                                  <Loader2 className="size-3 animate-spin" />
                                  {isProcessing ? 'Retomando análise…' : 'Analisando em segundo plano…'}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm" variant="outline" className="h-6 gap-1 text-[11px] px-2"
                                onClick={() => analyzeUrl(c.name, entry, c.mode ?? 'cheerio')}
                                disabled={isAnalyzing}
                              >
                                {isAnalyzing
                                  ? <Loader2 className="size-3 animate-spin" />
                                  : <RefreshCw className="size-3" />
                                }
                                {isAnalyzing
                                  ? (pollingRef.current.has(entry.url) ? 'Playwright…' : 'Analisando…')
                                  : snap ? 'Reanalisar' : 'Analisar'
                                }
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveUrl(c.name, entry.url)}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                          </div>

                          {snap && expandedPricesUrl === entry.url && (() => {
                            const prices = snap.mapped_prices as unknown as MappedPrice[]
                            if (prices.length === 0) return (
                              <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">Nenhum preço extraído.</p>
                            )

                            // Mapa de comodidades por suíte: "Suite X: a, b, c" → {suiteName: [a, b, c]}
                            const amenityMap: Record<string, string[]> = {}
                            for (const a of (snap.amenities ?? [])) {
                              const colonIdx = a.indexOf(': ')
                              if (colonIdx > 0) amenityMap[a.slice(0, colonIdx)] = a.slice(colonIdx + 2).split(', ').filter(Boolean)
                            }

                            // Agrupa preços por suíte → período → {semana, fds, todos}
                            type PCell = { semana?: number; fds?: number; todos?: number }
                            const groups: Record<string, Record<string, PCell>> = {}
                            for (const p of prices) {
                              if (!groups[p.categoria_concorrente]) groups[p.categoria_concorrente] = {}
                              if (!groups[p.categoria_concorrente][p.periodo]) groups[p.categoria_concorrente][p.periodo] = {}
                              if (p.dia_tipo === 'semana') groups[p.categoria_concorrente][p.periodo].semana = p.preco
                              else if (p.dia_tipo === 'fds_feriado') groups[p.categoria_concorrente][p.periodo].fds = p.preco
                              else groups[p.categoria_concorrente][p.periodo].todos = p.preco
                            }

                            const fmt = (n?: number) => n !== undefined ? `R$\u00a0${n.toFixed(0)}` : '—'

                            // Ordena períodos: crescente por horas, pernoite sempre por último
                            const sortPeriods = (keys: string[]) =>
                              [...keys].sort((a, b) => {
                                if (a === 'pernoite') return 1
                                if (b === 'pernoite') return -1
                                return parseInt(a) - parseInt(b)
                              })

                            return (
                              <div className="rounded-md border overflow-hidden">
                                {Object.entries(groups).map(([suiteName, periods], idx, arr) => {
                                  const amenities = amenityMap[suiteName] ?? []
                                  const periodKeys = sortPeriods(Object.keys(periods))
                                  const hasDist = periodKeys.some(k => periods[k].semana !== undefined || periods[k].fds !== undefined)
                                  return (
                                    <div key={suiteName} className={cn(idx < arr.length - 1 && 'border-b-2 border-border')}>
                                      {/* Header da suíte + comodidades */}
                                      <div className="px-3 pt-3 pb-2 bg-muted/40 flex flex-col gap-1.5">
                                        <span className="text-xs font-bold tracking-wide">{suiteName}</span>
                                        {amenities.length > 0 && (
                                          <div className="flex flex-wrap gap-1">
                                            {amenities.map((a) => (
                                              <span key={a} className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-foreground/60">{a}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      {/* Tabela pivotada: período × Dom–Qui / Sex–Sáb */}
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b bg-muted/10">
                                            <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Período</th>
                                            {hasDist ? (
                                              <>
                                                <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Dom–Qui</th>
                                                <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Sex–Sáb</th>
                                              </>
                                            ) : (
                                              <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Preço</th>
                                            )}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {periodKeys.map((period) => {
                                            const cell = periods[period]
                                            return (
                                              <tr key={period} className="border-b last:border-0 hover:bg-muted/10">
                                                <td className="px-3 py-1.5 font-medium">{period}</td>
                                                {hasDist ? (
                                                  <>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(cell.semana ?? cell.todos)}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(cell.fds ?? cell.todos)}</td>
                                                  </>
                                                ) : (
                                                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmt(cell.todos)}</td>
                                                )}
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>

                  {addingUrlTo === c.name && (
                    <div className="flex flex-col gap-1.5 pt-1 border-t">
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="URL da página (obrigatório)"
                          value={extraUrl}
                          onChange={(e) => setExtraUrl(e.target.value)}
                          className="h-7 text-xs"
                        />
                        <Input
                          placeholder="Rótulo (ex: Standard, Master)"
                          value={extraLabel}
                          onChange={(e) => setExtraLabel(e.target.value)}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline" className="h-7 gap-1 text-xs"
                          onClick={() => handleAddExtraUrl(c.name)}
                          disabled={!extraUrl.trim()}
                        >
                          <Plus className="size-3" /> Adicionar e Analisar
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                          onClick={() => { setAddingUrlTo(null); setExtraUrl(''); setExtraLabel('') }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Formulário de novo concorrente */}
          <div className="flex flex-col gap-2 pt-1">
            <Label className="text-xs font-medium text-muted-foreground">Adicionar concorrente</Label>
            <Input
              placeholder="Nome (ex: Motel Prime)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="URL da página de preços"
              value={newUrl}
              onChange={(e) => {
                const url = e.target.value
                setNewUrl(url)
                if (isGuiaSite(url)) {
                  setNewMode('guia')
                  if (!newName.trim()) {
                    const suggested = suggestNameFromUrl(url)
                    if (suggested) setNewName(suggested)
                  }
                }
              }}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Rótulo da URL (ex: Standard, Master) — opcional"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-8 text-xs"
            />

            <div className="flex flex-col gap-1">
              <div className="flex rounded-lg border overflow-hidden text-xs w-fit">
                <button
                  onClick={() => setNewMode('cheerio')}
                  className={cn('px-3 py-1.5 transition-colors', newMode === 'cheerio' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  Padrão
                </button>
                <button
                  onClick={() => setNewMode('guia')}
                  className={cn('px-3 py-1.5 transition-colors flex items-center gap-1', newMode === 'guia' ? 'bg-emerald-600 text-white' : 'hover:bg-accent')}
                >
                  <Sparkles className="size-3" /> Guia GM
                </button>
                <button
                  onClick={() => setNewMode('playwright')}
                  className={cn('px-3 py-1.5 transition-colors flex items-center gap-1', newMode === 'playwright' ? 'bg-violet-500 text-white' : 'hover:bg-accent')}
                >
                  <Zap className="size-3" /> Interativo
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {newMode === 'guia'
                  ? 'API estruturada do Guia de Motéis — gratuito, instantâneo, retorna comodidades.'
                  : newMode === 'playwright'
                    ? 'Renderiza JS + calendário para capturar semana e FDS (~45s). Requer Apify.'
                    : 'Via Jina.ai — gratuito, rápido (~5s). Use para sites com preços no HTML.'}
              </p>
            </div>

            <Button
              size="sm" variant="outline" className="gap-1.5 self-start"
              onClick={handleAddCompetitor}
              disabled={!newName.trim() || !newUrl.trim() || addingCompetitor}
            >
              {addingCompetitor ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {addingCompetitor ? 'Salvando…' : 'Adicionar e Analisar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
