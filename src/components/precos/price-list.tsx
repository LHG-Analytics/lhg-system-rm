'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CheckCircle2, Clock, Trash2, Pencil, ChevronDown, ChevronUp,
  CalendarIcon, Loader2, AlertCircle, X, Check, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ParsedPriceRow, ParsedDiscountRow } from '@/app/api/agente/import-prices/route'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PriceImport {
  id: string
  imported_at: string
  canals: string[]
  is_active: boolean
  valid_from: string
  valid_until: string | null
  parsed_data: ParsedPriceRow[]
  discount_data: ParsedDiscountRow[] | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CANAL_LABELS: Record<string, string> = {
  balcao_site:     'Balcão / Site Imediato',
  site_programada: 'Site Programada',
  guia_moteis:     'Guia de Motéis',
}
const DIA_LABELS: Record<string, string> = {
  semana:     'Semana',
  fds_feriado:'FDS / Feriado',
  todos:      'Todos',
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function isCurrentlyActive(imp: PriceImport): boolean {
  const today = new Date().toISOString().slice(0, 10)
  if (imp.valid_from > today) return false
  if (imp.valid_until && imp.valid_until < today) return false
  return true
}

// ─── Inline date editor ───────────────────────────────────────────────────────

interface InlineDateEditProps {
  importId: string
  validFrom: string
  validUntil: string | null
  onSaved: () => void
}

function InlineDateEdit({ importId, validFrom, validUntil, onSaved }: InlineDateEditProps) {
  const [from, setFrom]   = useState(validFrom)
  const [until, setUntil] = useState(validUntil ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr]     = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/agente/import-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: importId,
          validFrom: from,
          validUntil: until || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `Erro ${res.status}`)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3 mt-2">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">De</span>
        <input
          type="date"
          value={from}
          max={until || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Até (vazio = ativa)</span>
        <input
          type="date"
          value={until}
          min={from}
          onChange={(e) => setUntil(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving} className="h-7 px-3 text-xs">
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onSaved} className="h-7 px-2 text-xs">
          <X className="size-3" />
        </Button>
      </div>
      {err && <p className="w-full text-xs text-destructive">{err}</p>}
    </div>
  )
}

// ─── Item de tabela ───────────────────────────────────────────────────────────

interface ImportItemProps {
  imp: PriceImport
  onDeleted: () => void
  onUpdated: () => void
  importType?: 'prices' | 'discounts'
}

function ImportItem({ imp, onDeleted, onUpdated, importType = 'prices' }: ImportItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  const active = isCurrentlyActive(imp)
  const rows = imp.parsed_data ?? []
  const isDiscounts = importType === 'discounts'

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/agente/import-prices?id=${imp.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('[price-list] delete error', res.status, data)
        return
      }
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'
    )}>
      {/* Header do item */}
      <div className="flex items-start gap-3 p-4">
        {/* Ícone de status */}
        <div className="mt-0.5 shrink-0">
          {active
            ? <CheckCircle2 className="size-5 text-emerald-500" />
            : <Clock className="size-5 text-muted-foreground" />
          }
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {active
              ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px]">Em uso</Badge>
              : <Badge variant="secondary" className="text-[11px]">Inativa</Badge>
            }
            <span className="text-xs text-muted-foreground">
              Importada em {fmtDateTime(imp.imported_at)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <CalendarIcon className="size-3 text-muted-foreground" />
            <span className="text-sm font-medium">{fmtDate(imp.valid_from)}</span>
            <span className="text-muted-foreground text-xs">→</span>
            {imp.valid_until
              ? <span className="text-sm font-medium">{fmtDate(imp.valid_until)}</span>
              : <span className="text-sm font-medium text-emerald-500">atualmente ativa</span>
            }
          </div>

          <div className="flex gap-1.5 mt-2 flex-wrap">
            {imp.canals.map((c) => (
              <Badge key={c} variant="outline" className="text-[11px]">
                {CANAL_LABELS[c] ?? c}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground self-center">
              · {isDiscounts
                  ? `${imp.discount_data?.length ?? 0} descontos`
                  : `${rows.length} preços`}
            </span>
          </div>

          {/* Editor de vigência inline */}
          {editing && (
            <InlineDateEdit
              importId={imp.id}
              validFrom={imp.valid_from}
              validUntil={imp.valid_until}
              onSaved={() => { setEditing(false); onUpdated() }}
            />
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Editar vigência"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="size-3.5" />
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive">
                <Trash2 className="size-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isDiscounts ? 'Excluir tabela de descontos?' : 'Excluir tabela de preços?'}</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita. A tabela com vigência{' '}
                  <strong>{fmtDate(imp.valid_from)}</strong>{' → '}
                  {imp.valid_until ? <strong>{fmtDate(imp.valid_until)}</strong> : 'atualmente ativa'}{' '}
                  será excluída permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={expanded ? 'Recolher' : isDiscounts ? 'Ver descontos' : 'Ver preços'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Tabela expandível de preços */}
      {expanded && rows.length > 0 && (
        <>
          <Separator />
          <div className="p-4 pt-3">
            <div className="rounded-md border overflow-auto max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Canal</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs">Período</TableHead>
                    <TableHead className="text-xs">Dia</TableHead>
                    <TableHead className="text-xs text-right">Preço</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant="secondary" className="text-[11px]">
                          {CANAL_LABELS[row.canal] ?? row.canal}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.categoria}</TableCell>
                      <TableCell className="text-sm">{row.periodo}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{DIA_LABELS[row.dia_tipo] ?? row.dia_tipo}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.preco)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* Descontos do Guia de Motéis */}
      {expanded && imp.discount_data && imp.discount_data.length > 0 && (
        <>
          <Separator />
          <div className="p-4 pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Tag className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Descontos Guia de Motéis</span>
            </div>
            <div className="rounded-md border overflow-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs">Período</TableHead>
                    <TableHead className="text-xs">Dia</TableHead>
                    <TableHead className="text-xs">Horário</TableHead>
                    <TableHead className="text-xs text-right">Desconto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imp.discount_data.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium">{row.categoria}</TableCell>
                      <TableCell className="text-sm">{row.periodo}</TableCell>
                      <TableCell className="text-sm capitalize">{row.dia_semana ?? row.dia_tipo ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.faixa_horaria ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                        {row.tipo_desconto === 'percentual' ? `${row.valor}%` : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.valor)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Lista principal com Realtime ─────────────────────────────────────────────

interface PriceListProps {
  unitSlug: string
  unitId: string
  importType?: 'prices' | 'discounts'
}

export function PriceList({ unitSlug, unitId, importType = 'prices' }: PriceListProps) {
  const [imports, setImports] = useState<PriceImport[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const supabase = createClient()

  const fetchImports = useCallback(async () => {
    const res = await fetch(`/api/agente/import-prices?unitSlug=${unitSlug}&importType=${importType}`)
    if (!res.ok) {
      setError('Erro ao carregar tabelas de preços')
      setLoading(false)
      return
    }
    const data = await res.json() as PriceImport[]
    setImports(data)
    setLoading(false)
    setError(null)
  }, [unitSlug])

  useEffect(() => {
    fetchImports()

    // Realtime: escuta INSERT, UPDATE e DELETE na tabela price_imports para esta unidade
    const channel = supabase
      .channel(`price_imports:${unitId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'price_imports',
          filter: `unit_id=eq.${unitId}`,
        },
        () => { fetchImports() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [unitId, fetchImports, supabase])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex items-center gap-2 py-6 text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span className="text-sm">{error}</span>
        </CardContent>
      </Card>
    )
  }

  const isDiscountsView = importType === 'discounts'

  if (imports.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Clock className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {isDiscountsView
              ? 'Nenhuma tabela de descontos importada ainda.'
              : 'Nenhuma tabela de preços importada ainda.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const activeCount = imports.filter(isCurrentlyActive).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {isDiscountsView ? 'Tabelas de descontos' : 'Tabelas importadas'}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {activeCount > 0 ? `${activeCount} em uso` : 'nenhuma ativa'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {imports.map((imp) => (
          <ImportItem
            key={imp.id}
            imp={imp}
            onDeleted={fetchImports}
            onUpdated={fetchImports}
            importType={importType}
          />
        ))}
      </CardContent>
    </Card>
  )
}
