'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Upload, Loader2, FileText, X, CalendarIcon, CheckCircle2,
  AlertCircle, Clock, RefreshCw, Plus, Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'

// ─── DatePicker (reutilizado do price-import original) ────────────────────────

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

interface ImportJob {
  id: string
  file_name: string
  valid_from: string
  valid_until: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  error_msg: string | null
  result_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

interface PriceImportQueueProps {
  unitSlug: string
  unitName: string
}

const STATUS_ICON = {
  pending:    <Clock className="size-3.5 text-muted-foreground" />,
  processing: <Loader2 className="size-3.5 animate-spin text-blue-500" />,
  done:       <CheckCircle2 className="size-3.5 text-emerald-500" />,
  failed:     <AlertCircle className="size-3.5 text-destructive" />,
}
const STATUS_LABEL = { pending: 'Na fila', processing: 'Analisando…', done: 'Importado', failed: 'Falhou' }

export function PriceImportQueue({ unitSlug, unitName }: PriceImportQueueProps) {
  const today = new Date().toISOString().slice(0, 10)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Arquivos pendentes de enfileiramento (ainda não enviados)
  const [queue, setQueue] = useState<QueuedFile[]>([])
  // Jobs já enviados ao servidor
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Polling ativo quando há jobs pending/processing
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingRef = useRef(false)

  // Carrega histórico de jobs ao montar
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/agente/import-queue?unitSlug=${unitSlug}`)
      if (res.ok) setJobs(await res.json() as ImportJob[])
    } catch { /* silencioso */ }
  }, [unitSlug])

  useEffect(() => {
    loadJobs()
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [loadJobs])

  // Processa próximo job via PATCH
  const processNext = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      const res = await fetch('/api/agente/import-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug }),
      })
      const data = await res.json() as { done?: boolean; jobId?: string; error?: string }
      await loadJobs()
      if (data.done) {
        // Sem mais jobs — para o polling
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      }
    } catch { /* tenta novamente no próximo tick */ } finally {
      processingRef.current = false
    }
  }, [unitSlug, loadJobs])

  // Inicia polling quando há jobs ativos
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'processing')
    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(processNext, 8000)
      processNext() // processa imediatamente
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [jobs, processNext])

  // ─── Adicionar arquivos à fila local ───────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        let text = ev.target?.result as string
        // Fallback de encoding para Latin-1 se UTF-8 produzir caracteres corrompidos
        if ((text.match(/\uFFFD/g)?.length ?? 0) > 3) {
          const readerLatin = new FileReader()
          readerLatin.onload = (ev2) => {
            const latinText = ev2.target?.result as string
            addToQueue(file.name, latinText)
          }
          readerLatin.readAsText(file, 'windows-1252')
          return
        }
        addToQueue(file.name, text)
      }
      reader.readAsText(file, 'utf-8')
    })

    // Limpa o input para permitir re-seleção do mesmo arquivo
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addToQueue(fileName: string, csvContent: string) {
    setQueue((prev) => [...prev, {
      id: crypto.randomUUID(),
      fileName,
      csvContent,
      validFrom: today,
      validUntil: null,
    }])
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((f) => f.id !== id))
  }

  function updateQueueItem(id: string, field: 'validFrom' | 'validUntil', value: string | null) {
    setQueue((prev) => prev.map((f) => f.id === id ? { ...f, [field]: value } : f))
  }

  // ─── Enviar fila ao servidor ───────────────────────────────────────────────

  async function handleSubmit() {
    if (!queue.length) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/agente/import-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug,
          files: queue.map((f) => ({
            fileName: f.fileName,
            csvContent: f.csvContent,
            validFrom: f.validFrom,
            validUntil: f.validUntil,
          })),
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

  const hasActiveJobs = jobs.some((j) => j.status === 'pending' || j.status === 'processing')

  return (
    <div className="flex flex-col gap-4">
      {/* Área de seleção */}
      <Card>
        <CardHeader>
          <CardTitle>Importar tabelas de preços</CardTitle>
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

          {/* Drop zone */}
          <div
            className="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 px-6 py-8 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-7 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Múltiplos arquivos CSV exportados do Google Sheets
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="sr-only"
              onChange={handleFileChange}
            />
          </div>

          {/* Lista de arquivos na fila local */}
          {queue.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {queue.length} arquivo{queue.length !== 1 ? 's' : ''} selecionado{queue.length !== 1 ? 's' : ''} — configure a vigência de cada um:
              </p>
              {queue.map((f) => (
                <div key={f.id} className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center gap-3">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.fileName}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">De</span>
                        <DatePicker
                          value={f.validFrom}
                          onChange={(v) => v && updateQueueItem(f.id, 'validFrom', v)}
                          max={f.validUntil ?? undefined}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground/40">→</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Até</span>
                        <DatePicker
                          value={f.validUntil}
                          onChange={(v) => updateQueueItem(f.id, 'validUntil', v)}
                          min={f.validFrom}
                          placeholder="atualmente ativa"
                          clearable
                        />
                        {!f.validUntil && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">atualmente ativa</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeFromQueue(f.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}

              <div className="flex gap-2 mt-1">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="gap-1.5"
                >
                  {submitting
                    ? <><Loader2 className="size-4 animate-spin" /> Enfileirando…</>
                    : <><Plus className="size-4" /> Enfileirar {queue.length} arquivo{queue.length !== 1 ? 's' : ''}</>
                  }
                </Button>
                <Button variant="ghost" onClick={() => setQueue([])} disabled={submitting}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fila de jobs no servidor */}
      {jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Histórico de importações — {unitName}</CardTitle>
                {hasActiveJobs && (
                  <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    Analisando em segundo plano… você pode navegar livremente.
                  </p>
                )}
              </div>
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
                  <Badge
                    variant={job.status === 'done' ? 'default' : job.status === 'failed' ? 'destructive' : 'secondary'}
                    className="text-[10px] shrink-0"
                  >
                    {STATUS_LABEL[job.status]}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
