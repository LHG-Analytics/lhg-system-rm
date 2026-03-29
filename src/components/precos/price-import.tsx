'use client'

import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2, FileText, X, CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import type { ParsedPriceRow, ParseResponse } from '@/app/api/agente/import-prices/route'

// ─── DatePicker helper ────────────────────────────────────────────────────────

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

interface DatePickerProps {
  value: string | null
  onChange: (v: string | null) => void
  min?: string
  max?: string
  placeholder?: string
  clearable?: boolean
}

function DatePicker({ value, onChange, min, max, placeholder = 'Selecionar', clearable }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = value ? isoToDate(value) : undefined
  const fromDate = min ? isoToDate(min) : undefined
  const toDate   = max ? isoToDate(max) : undefined

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
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) { onChange(dateToIso(date)); setOpen(false) }
          }}
          disabled={(date) => {
            if (fromDate && date < fromDate) return true
            if (toDate   && date > toDate)   return true
            return false
          }}
          initialFocus
        />
        {clearable && value && (
          <div className="border-t p-2">
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Limpar (atualmente ativa)
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

const CANAL_LABELS: Record<string, string> = {
  balcao_site: 'Balcão / Site Imediato',
  site_programada: 'Site Programada',
  guia_moteis: 'Guia de Motéis',
}

const DIA_LABELS: Record<string, string> = {
  semana: 'Semana',
  fds_feriado: 'FDS / Feriado',
  todos: 'Todos',
}

interface PriceImportProps {
  unitSlug: string
  unitName: string
}

export function PriceImport({ unitSlug, unitName }: PriceImportProps) {
  const today = new Date().toISOString().slice(0, 10)

  const [phase, setPhase] = useState<'idle' | 'parsing' | 'preview' | 'saving' | 'done' | 'error'>('idle')
  const [csvContent, setCsvContent] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParseResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [validFrom, setValidFrom] = useState<string>(today)
  const [validUntil, setValidUntil] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvContent(text)
    }
    reader.readAsText(file, 'utf-8')
  }

  async function handleParse() {
    if (!csvContent) return
    setPhase('parsing')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/agente/import-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'parse', csvContent, unitSlug }),
      })

      if (!res.ok) {
        const { error } = await res.json() as { error: string }
        throw new Error(error ?? `Erro ${res.status}`)
      }

      const data = await res.json() as ParseResponse
      if (!data.rows || data.rows.length === 0) {
        throw new Error('Nenhum preço dos canais MVP foi encontrado no arquivo. Verifique se o CSV contém as colunas de Balcão/Site, Reserva Antecipada ou Guia de Motéis.')
      }

      setPreview(data)
      setPhase('preview')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro desconhecido')
      setPhase('error')
    }
  }

  async function handleConfirm() {
    if (!preview || !csvContent) return
    setPhase('saving')

    try {
      const res = await fetch('/api/agente/import-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          csvContent,
          unitSlug,
          parsedData: preview.rows,
          validFrom,
          validUntil,
        }),
      })

      if (!res.ok) {
        const { error } = await res.json() as { error: string }
        throw new Error(error ?? `Erro ${res.status}`)
      }

      setPhase('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar')
      setPhase('error')
    }
  }

  function handleReset() {
    setPhase('idle')
    setCsvContent(null)
    setFileName(null)
    setPreview(null)
    setErrorMsg(null)
    setValidFrom(today)
    setValidUntil(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Sucesso ────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle className="size-12 text-green-500" />
          <div className="text-center">
            <p className="font-semibold text-lg">Tabela importada com sucesso</p>
            <p className="text-sm text-muted-foreground mt-1">
              {preview?.rows.length} preços salvos para {unitName}. O Agente RM já tem acesso à nova tabela.
            </p>
          </div>
          <Button variant="outline" onClick={handleReset}>Importar outra tabela</Button>
        </CardContent>
      </Card>
    )
  }

  // ── Erro ───────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <AlertCircle className="size-12 text-destructive" />
          <div className="text-center">
            <p className="font-semibold text-lg">Falha na importação</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">{errorMsg}</p>
          </div>
          <Button variant="outline" onClick={handleReset}>Tentar novamente</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Importar tabela de preços</CardTitle>
          <CardDescription>
            Exporte sua planilha do Google Sheets como CSV e faça o upload abaixo.
            O Agente RM irá identificar automaticamente as categorias, períodos e canais.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Drop zone */}
          <div
            className="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 px-6 py-10 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            {fileName ? (
              <>
                <FileText className="size-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Clique para trocar o arquivo</p>
                </div>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Arquivos CSV exportados do Google Sheets</p>
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleFileChange}
            />
          </div>

          {/* Vigência — aparece logo após selecionar o arquivo */}
          {csvContent && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
                <CalendarIcon className="size-3.5" />
                <span className="font-medium text-foreground">Vigência da tabela:</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">De</span>
                  <DatePicker
                    value={validFrom}
                    onChange={(v) => v && setValidFrom(v)}
                    max={validUntil ?? undefined}
                  />
                </div>
                <span className="text-xs text-muted-foreground/40">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Até</span>
                  <DatePicker
                    value={validUntil}
                    onChange={setValidUntil}
                    min={validFrom}
                    placeholder="atualmente ativa"
                    clearable
                  />
                  {!validUntil && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">atualmente ativa</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleParse}
              disabled={!csvContent || phase === 'parsing'}
              className="flex-1"
            >
              {phase === 'parsing' ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Analisando com IA...
                </>
              ) : (
                'Analisar planilha'
              )}
            </Button>
            {csvContent && (
              <Button variant="ghost" size="icon" onClick={handleReset}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {(phase === 'preview' || phase === 'saving') && preview && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Prévia — confirme antes de salvar</CardTitle>
                <CardDescription className="mt-1">
                  {preview.rows.length} preços extraídos · canais:{' '}
                  {preview.canais_encontrados.map((c) => CANAL_LABELS[c] ?? c).join(', ')}
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" onClick={handleReset} disabled={phase === 'saving'}>Cancelar</Button>
                <Button onClick={handleConfirm} disabled={phase === 'saving'}>
                  {phase === 'saving' ? (
                    <><Loader2 className="size-4 animate-spin mr-2" />Salvando...</>
                  ) : (
                    'Confirmar importação'
                  )}
                </Button>
              </div>
            </div>
            {preview.observacoes && (
              <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3">
                {preview.observacoes}
              </p>
            )}
            {/* Vigência confirmada (read-only no preview) */}
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <CalendarIcon className="size-3" />
              Vigência: <strong>{validFrom.split('-').reverse().join('/')}</strong>
              {' → '}
              {validUntil ? <strong>{validUntil.split('-').reverse().join('/')}</strong> : <span className="text-emerald-600 dark:text-emerald-400">atualmente ativa</span>}
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Dia</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {CANAL_LABELS[row.canal] ?? row.canal}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{row.categoria}</TableCell>
                      <TableCell>{row.periodo}</TableCell>
                      <TableCell className="text-muted-foreground">{DIA_LABELS[row.dia_tipo] ?? row.dia_tipo}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.preco)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
