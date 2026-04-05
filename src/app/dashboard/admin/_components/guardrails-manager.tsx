'use client'

import { useState, useCallback } from 'react'
import { Plus, Trash2, Shield, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Badge } from '@/components/ui/badge'

interface Guardrail {
  id: string
  categoria: string
  periodo: string
  preco_minimo: number
  preco_maximo: number
}

interface GuardrailsManagerProps {
  unitSlug: string
  unitName: string
  initialGuardrails: Guardrail[]
}

const PERIODOS = ['3h', '6h', '12h', 'pernoite']

export function GuardrailsManager({ unitSlug, unitName, initialGuardrails }: GuardrailsManagerProps) {
  const [guardrails, setGuardrails] = useState<Guardrail[]>(initialGuardrails)
  const [categoria, setCategoria] = useState('')
  const [periodo, setPeriodo] = useState('3h')
  const [precoMin, setPrecoMin] = useState('')
  const [precoMax, setPrecoMax] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const min = parseFloat(precoMin.replace(',', '.'))
    const max = parseFloat(precoMax.replace(',', '.'))
    if (isNaN(min) || isNaN(max)) { setError('Valores inválidos'); return }
    if (min >= max) { setError('Preço mínimo deve ser menor que o máximo'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug, categoria, periodo, preco_minimo: min, preco_maximo: max }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setGuardrails((prev) => {
        const idx = prev.findIndex((g) => g.categoria === categoria && g.periodo === periodo)
        return idx >= 0
          ? prev.map((g, i) => i === idx ? data : g)
          : [data, ...prev]
      })
      setCategoria('')
      setPrecoMin('')
      setPrecoMax('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [unitSlug, categoria, periodo, precoMin, precoMax])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/guardrails?id=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setGuardrails((prev) => prev.filter((g) => g.id !== confirmDelete))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete])

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          Guardrails de Preço — {unitName}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Limites de preço que o agente RM não pode ultrapassar ao gerar propostas. Categoria deve ser o nome exato usado no ERP (ex: "Luxo", "Standard").
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Adicionar ou atualizar limite</h3>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <Label className="text-xs">Categoria (nome exato do ERP)</Label>
              <Input
                placeholder="Ex: Luxo, Standard…"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                required
                disabled={saving}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={setPeriodo} disabled={saving}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Preço mínimo (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={precoMin}
                onChange={(e) => setPrecoMin(e.target.value)}
                required
                disabled={saving}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Preço máximo (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={precoMax}
                onChange={(e) => setPrecoMax(e.target.value)}
                required
                disabled={saving}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" className="gap-1.5" disabled={saving || !categoria}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Salvar guardrail
            </Button>
          </div>
        </form>
      </div>

      {/* Lista */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {guardrails.length} guardrail{guardrails.length !== 1 ? 's' : ''} configurado{guardrails.length !== 1 ? 's' : ''}
        </p>

        {guardrails.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-8 text-center">
            <Shield className="size-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum guardrail configurado.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">O agente poderá propor qualquer preço dentro do limite de ±30%.</p>
          </div>
        ) : (
          guardrails.map((g) => (
            <div key={g.id} className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{g.categoria}</span>
                  <Badge variant="outline" className="text-[10px]">{g.periodo}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mín: <span className="font-medium text-foreground/80">R$ {g.preco_minimo.toFixed(2)}</span>
                  {' '}&nbsp;·&nbsp;{' '}
                  Máx: <span className="font-medium text-foreground/80">R$ {g.preco_maximo.toFixed(2)}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDelete(g.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover guardrail?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente poderá propor qualquer preço para essa combinação dentro do limite de ±30%.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
