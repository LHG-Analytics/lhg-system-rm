'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Upload, Loader2, FileText, X, CalendarIcon, CheckCircle2,
  AlertCircle, Clock, RefreshCw, Plus, Trash2, RotateCcw, ChevronDown
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'

// ─── DatePicker ───────────────────────────────────────────────────────────────

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function fmtIso(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function DatePicker({ value, onChange, min, max, placeholder = 'Selecionar', clearable }: {
  value: string | null; onChange: (v: string | null) => void
  min?: string; max?: string; placeholder?: string; clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? isoToDate(value) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex items-center gap-1.5 h-7 rounded-md border bg-background px-2 text-xs',
          'text-foreground cursor-pointer transition-colors hover:bg-accent hover:border-accent-foreground/20',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}>
          <CalendarIcon className="size-3 text-muted-foreground shrink-0" />
          <span>{value ? fmtIso(value) : <span className="text-muted-foreground">{placeholder}</span>}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single" selected={selected}
          onSelect={(date) => { if (date) { onChange(dateToIso(date)); setOpen(false) } }}
          disabled={(date) => {
            if (min && date < isoToDate(min)) return true
            if (max && date > isoToDate(max)) return true
            return false
          }}
          initialFocus
        />
        {clearable && value && (
          <div className="border-t p-2">
            <button onClick={() => { onChange(null); setOpen(false) }}
              className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition-colors py-1">
              Limpar (atualmente ativa)
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface QueuedFile {
  id: string
  fileName: string
  csvContent: string
  validFrom: string
  validUntil: string | null
}

interface ParsedPreview {
  rows: Array<{ canal: string; categoria: string; periodo: string; dia_tipo: string; preco: number }>
  discount_rows: Array<{ categoria: string; periodo: string; dia_semana: string; faixa_horaria: string; tipo_desconto: string; valor: number; condicao?: string }>
  canais_encontrados: string[]
}

export interface ImportJob {
  id: string
  file_name: string
  valid_from: string
  valid_until: string | null
  status: 'pending' | 'processing' | 'needs_review' | 'done' | 'failed'
  error_msg: string | null
  result_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  import_type?: 'prices' | 'discounts'
  parsed_preview?: ParsedPreview | null
}

interface PriceImportQueueProps {
  unitSlug: string
  unitName: string
  importType?: 'prices' | 'discounts'
}

const STATUS_ICON = {
  pending:      <Clock className="size-3.5 text-muted-foreground" />,
  processing:   <Loader2 className="size-3.5 animate-spin text-blue-500" />,
  needs_review: <AlertCircle className="size-3.5 text-amber-500" />,
  done:         <CheckCircle2 className="size-3.5 text-emerald-500" />,
  failed:       <AlertCircle className="size-3.5 text-destructive" />,
}
const STATUS_LABEL = {
  pending: 'Na fila', processing: 'Analisando…',
  needs_review: 'Aguardando confirmação', done: 'Importado', failed: 'Falhou',
}

// ─── PriceImportQueue: upload + polling (sem histórico) ───────────────────────

export function PriceImportQueue({ unitSlug, unitName, importType = 'prices' }: PriceImportQueueProps) {
  const today = new Date().toISOString().slice(0, 10)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [expandedPreviews, setExpandedPreviews] = useState<Set<string>>(new Set())

  const [dragging, setDragging] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingRef = useRef(false)

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/agente/import-queue?unitSlug=${unitSlug}&importType=${importType}`)
      if (res.ok) setJobs(await res.json() as ImportJob[])
    } catch { /* silencioso */ }
  }, [unitSlug, importType])

  useEffect(() => {
    loadJobs()
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [loadJobs])

  const processNext = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      const res = await fetch('/api/agente/import-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug }),
      })
      const data = await res.json() as { done?: boolean }
      await loadJobs()
      if (data.done) {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      }
    } catch { /* tenta no próximo tick */ } finally {
      processingRef.current = false
    }
  }, [unitSlug, loadJobs])

  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'processing')
    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(processNext, 8000)
      processNext()
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [jobs, processNext])

  function processFiles(files: File[]) {
    if (!files.length) return
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result as string
        if ((text.match(/\uFFFD/g)?.length ?? 0) > 3) {
          const readerLatin = new FileReader()
          readerLatin.onload = (ev2) => addToQueue(file.name, ev2.target?.result as string)
          readerLatin.readAsText(file, 'windows-1252')
          return
        }
        addToQueue(file.name, text)
      }
      reader.readAsText(file, 'utf-8')
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    processFiles(Array.from(e.target.files ?? []))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith('.csv') || f.type === 'text/csv' || f.type === 'application/vnd.ms-excel'
    )
    processFiles(files)
  }

  function addToQueue(fileName: string, csvContent: string) {
    setQueue((prev) => [...prev, { id: crypto.randomUUID(), fileName, csvContent, validFrom: today, validUntil: null }])
  }

  function removeFromQueue(id: string) { setQueue((prev) => prev.filter((f) => f.id !== id)) }
  function updateQueueItem(id: string, field: 'validFrom' | 'validUntil', value: string | null) {
    setQueue((prev) => prev.map((f) => f.id === id ? { ...f, [field]: value } : f))
  }

  async function handleSubmit() {
    if (!queue.length) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/agente/import-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug,
          importType,
          files: queue.map((f) => ({ fileName: f.fileName, csvContent: f.csvContent, validFrom: f.validFrom, validUntil: f.validUntil })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)
      setQueue([])
      await loadJobs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enfileirar')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm(jobId: string) {
    setConfirming(jobId); setError(null)
    try {
      const res = await fetch('/api/agente/import-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug, action: 'confirm', jobId }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Erro ao confirmar importação')
        return
      }
      await loadJobs()
    } catch { setError('Erro ao confirmar importação') }
    finally { setConfirming(null) }
  }

  async function handleReject(jobId: string) {
    setRejecting(jobId)
    try {
      await fetch('/api/agente/import-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug, action: 'reject', jobId }),
      })
      await loadJobs()
    } finally { setRejecting(null) }
  }

  function togglePreview(jobId: string) {
    setExpandedPreviews((prev) => {
      const next = new Set(prev)
      next.has(jobId) ? next.delete(jobId) : next.add(jobId)
      return next
    })
  }

  // needs_review pausa o polling para evitar loop: PATCH retorna done:true quando há jobs para revisar
  const needsReviewJobs = jobs.filter((j) => j.status === 'needs_review')
  const hasActiveJobs = needsReviewJobs.length === 0 && jobs.some((j) => j.status === 'pending' || j.status === 'processing')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {importType === 'discounts' ? 'Importar tabelas de descontos' : 'Importar tabelas de preços'}
        </CardTitle>
        <CardDescription>
          Selecione um ou mais arquivos CSV. A análise acontece em segundo plano —
          você receberá uma notificação quando cada planilha for importada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" /> {error}
          </div>
        )}

        {hasActiveJobs && (
          <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-500 flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin shrink-0" />
            Analisando planilhas em segundo plano — você pode navegar livremente.
          </div>
        )}

        {/* ── Confirmações pendentes ── */}
        {needsReviewJobs.map((job) => {
          const preview = job.parsed_preview
          const isPrices = (job.import_type ?? 'prices') === 'prices'
          const rowCount = isPrices ? (preview?.rows.length ?? 0) : (preview?.discount_rows.length ?? 0)
          const canais = preview?.canais_encontrados ?? []
          const expanded = expandedPreviews.has(job.id)

          return (
            <div key={job.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden">
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="size-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{job.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Vigência: {fmtIso(job.valid_from)} → {job.valid_until ? fmtIso(job.valid_until) : <span className="text-emerald-600 dark:text-emerald-400">ativa</span>}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">Aguarda confirmação</span>
                </div>

                <div className="flex items-center gap-1.5 text-xs flex-wrap">
                  {rowCount > 0 ? (
                    <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="size-3 text-amber-500 shrink-0" />
                  )}
                  <span className={`font-medium ${rowCount > 0 ? 'text-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
                    {rowCount > 0
                      ? `${rowCount} ${isPrices ? 'preços encontrados' : 'regras de desconto'}`
                      : `Nenhuma ${isPrices ? 'linha de preço' : 'regra de desconto'} extraída — verifique o CSV`}
                  </span>
                  {rowCount > 0 && canais.length > 0 && (
                    <span className="text-muted-foreground"> · {canais.join(' · ')}</span>
                  )}
                  {rowCount > 0 && (
                    <button
                      onClick={() => togglePreview(job.id)}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                    >
                      {expanded ? 'Ocultar detalhes ↑' : 'Ver detalhes ↓'}
                    </button>
                  )}
                </div>

                {expanded && preview && (
                  <div className="mt-1 max-h-64 overflow-y-auto rounded border bg-background text-xs">
                    {isPrices && preview.rows.length > 0 && (
                      <table className="w-full min-w-max">
                        <thead className="sticky top-0 bg-muted text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">Canal</th>
                            <th className="px-2 py-1 text-left font-medium">Categoria</th>
                            <th className="px-2 py-1 text-left font-medium">Período</th>
                            <th className="px-2 py-1 text-left font-medium">Dia</th>
                            <th className="px-2 py-1 text-right font-medium">R$</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1 text-muted-foreground">{r.canal}</td>
                              <td className="px-2 py-1">{r.categoria}</td>
                              <td className="px-2 py-1">{r.periodo}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.dia_tipo}</td>
                              <td className="px-2 py-1 text-right font-medium">{Number(r.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {!isPrices && preview.discount_rows.length > 0 && (
                      <table className="w-full min-w-max">
                        <thead className="sticky top-0 bg-muted text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">Categoria</th>
                            <th className="px-2 py-1 text-left font-medium">Período</th>
                            <th className="px-2 py-1 text-left font-medium">Dia</th>
                            <th className="px-2 py-1 text-left font-medium">Horário</th>
                            <th className="px-2 py-1 text-left font-medium">Desconto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.discount_rows.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1">{r.categoria}</td>
                              <td className="px-2 py-1">{r.periodo}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.dia_semana}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.faixa_horaria}</td>
                              <td className="px-2 py-1 font-medium">
                                {r.tipo_desconto === 'percentual' ? `${r.valor}%` : `R$ ${r.valor}`}
                                {r.condicao && <span className="text-muted-foreground"> · {r.condicao}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={confirming === job.id || rejecting === job.id}
                    onClick={() => handleConfirm(job.id)}
                  >
                    {confirming === job.id
                      ? <><Loader2 className="size-3.5 animate-spin" /> Confirmando…</>
                      : <><CheckCircle2 className="size-3.5" /> Confirmar importação</>
                    }
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                    disabled={confirming === job.id || rejecting === job.id}
                    onClick={() => handleReject(job.id)}
                  >
                    {rejecting === job.id
                      ? <><Loader2 className="size-3.5 animate-spin" /> Rejeitando…</>
                      : <><X className="size-3.5" /> Rejeitar</>
                    }
                  </Button>
                </div>
              </div>
            </div>
          )
        })}

        <div
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className={cn('size-7 transition-colors', dragging ? 'text-primary' : 'text-muted-foreground')} />
          <div>
            <p className="text-sm font-medium">
              {dragging ? 'Solte para adicionar' : 'Arraste ou clique para selecionar'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {importType === 'discounts'
                ? 'CSV com política de descontos do Guia de Motéis'
                : 'Múltiplos arquivos CSV exportados do Google Sheets'}
            </p>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={handleFileChange} />
        </div>

        {queue.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {queue.length} arquivo{queue.length !== 1 ? 's' : ''} selecionado{queue.length !== 1 ? 's' : ''} — configure a vigência:
            </p>
            {queue.map((f) => (
              <div key={f.id} className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center gap-3">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.fileName}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">De</span>
                      <DatePicker value={f.validFrom} onChange={(v) => v && updateQueueItem(f.id, 'validFrom', v)} max={f.validUntil ?? undefined} />
                    </div>
                    <span className="text-xs text-muted-foreground/40">→</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Até</span>
                      <DatePicker value={f.validUntil} onChange={(v) => updateQueueItem(f.id, 'validUntil', v)} min={f.validFrom} placeholder="atualmente ativa" clearable />
                      {!f.validUntil && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">atualmente ativa</span>}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeFromQueue(f.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
                {submitting
                  ? <><Loader2 className="size-4 animate-spin" /> Enfileirando…</>
                  : <><Plus className="size-4" /> Enfileirar {queue.length} arquivo{queue.length !== 1 ? 's' : ''}</>
                }
              </Button>
              <Button variant="ghost" onClick={() => setQueue([])} disabled={submitting}>Cancelar</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── ImportJobHistory: histórico separado com retry ───────────────────────────

interface ImportJobHistoryProps {
  unitSlug: string
  unitName: string
  unitId: string
  importType?: 'prices' | 'discounts'
}

export function ImportJobHistory({ unitSlug, unitName, unitId, importType = 'prices' }: ImportJobHistoryProps) {
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/agente/import-queue?unitSlug=${unitSlug}&importType=${importType}`)
      if (res.ok) setJobs(await res.json() as ImportJob[])
    } catch { /* silencioso */ } finally {
      setLoading(false)
    }
  }, [unitSlug, importType])

  useEffect(() => {
    loadJobs()

    // Realtime: atualiza quando qualquer job muda
    const supabase = createClient()
    const channel = supabase
      .channel(`price_import_jobs:${unitId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_import_jobs', filter: `unit_id=eq.${unitId}` }, () => { loadJobs() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [unitId, loadJobs])

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/agente/import-queue?id=${confirmDelete}`, { method: 'DELETE' })
      if (res.ok) setJobs((prev) => prev.filter((j) => j.id !== confirmDelete))
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  async function handleRetry(jobId: string) {
    setRetrying(jobId)
    try {
      await fetch('/api/agente/import-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug, retryJobId: jobId }),
      })
      await loadJobs()
    } finally {
      setRetrying(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Clock className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhuma importação no histórico.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
    <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir do histórico?</AlertDialogTitle>
          <AlertDialogDescription>
            O registro desta importação será removido permanentemente do histórico. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Histórico de importações — {unitName}</CardTitle>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={loadJobs}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col divide-y">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-3 py-2.5">
              {STATUS_ICON[job.status]}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{job.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  Vigência: {fmtIso(job.valid_from)} → {job.valid_until ? fmtIso(job.valid_until) : <span className="text-emerald-600 dark:text-emerald-400">ativa</span>}
                  {job.finished_at && (
                    <> · {new Date(job.finished_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                </p>
                {job.error_msg && (
                  <p className="text-xs text-destructive mt-0.5 truncate">{job.error_msg}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {job.status === 'failed' && (
                  <Button
                    size="sm" variant="outline"
                    className="h-6 px-2 text-[11px] gap-1"
                    disabled={retrying === job.id}
                    onClick={() => handleRetry(job.id)}
                  >
                    {retrying === job.id
                      ? <Loader2 className="size-3 animate-spin" />
                      : <RotateCcw className="size-3" />
                    }
                    Tentar novamente
                  </Button>
                )}
                <Badge
                  variant={job.status === 'done' ? 'default' : job.status === 'failed' ? 'destructive' : 'secondary'}
                  className="text-[10px]"
                >
                  {STATUS_LABEL[job.status]}
                </Badge>
                {job.status !== 'processing' && (
                  <Button
                    size="icon" variant="ghost"
                    className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDelete(job.id)}
                    title="Excluir do histórico"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
    </>
  )
}
