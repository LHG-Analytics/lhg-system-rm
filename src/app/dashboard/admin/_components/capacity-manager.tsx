'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Building2, Loader2, BedDouble, Percent } from 'lucide-react'
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

interface CapacityRow {
  id: string
  categoria: string
  n_suites: number
  custo_variavel_locacao: number
  notes: string | null
}

interface ChannelCostRow {
  id: string
  canal: string
  comissao_pct: number
  taxa_fixa: number
  notes: string | null
}

interface Unit {
  id: string
  name: string
  slug: string
}

interface CapacityManagerProps {
  unitSlug: string
  unitName: string
  categorias: string[]
  initialCapacity: CapacityRow[]
  initialChannelCosts: ChannelCostRow[]
  units: Unit[]
}

const CANAL_OPTIONS = [
  { value: 'balcao_site',     label: 'Balcão / Site Imediato' },
  { value: 'site_programada', label: 'Site Programada (Reserva Antecipada)' },
  { value: 'guia_moteis',     label: 'Guia de Motéis' },
  { value: 'booking',         label: 'Booking.com' },
  { value: 'expedia',         label: 'Expedia' },
  { value: 'outros',          label: 'Outros' },
]

const CANAL_LABEL: Record<string, string> = Object.fromEntries(
  CANAL_OPTIONS.map((c) => [c.value, c.label])
)

export function CapacityManager({
  unitSlug,
  unitName,
  categorias,
  initialCapacity,
  initialChannelCosts,
  units,
}: CapacityManagerProps) {
  const router = useRouter()
  const [capacity, setCapacity] = useState<CapacityRow[]>(initialCapacity)
  const [channelCosts, setChannelCosts] = useState<ChannelCostRow[]>(initialChannelCosts)

  // ── Form state: capacity ────────────────────────────────────────────────
  const [capCategoria, setCapCategoria] = useState('')
  const [capNSuites, setCapNSuites] = useState('')
  const [capCusto, setCapCusto] = useState('')
  const [capNotes, setCapNotes] = useState('')
  const [savingCap, setSavingCap] = useState(false)

  // ── Form state: channel costs ───────────────────────────────────────────
  const [ccCanal, setCcCanal] = useState('balcao_site')
  const [ccComissao, setCcComissao] = useState('')
  const [ccTaxaFixa, setCcTaxaFixa] = useState('')
  const [ccNotes, setCcNotes] = useState('')
  const [savingCc, setSavingCc] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'capacity' | 'channel'; id: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleUnitChange = (newSlug: string) => {
    if (newSlug !== unitSlug) {
      router.push(`/dashboard/admin?unit=${newSlug}&tab=capacidade`)
    }
  }

  // ── Handlers: capacity ──────────────────────────────────────────────────
  const handleAddCapacity = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSavingCap(true)
    try {
      const payload = {
        unitSlug,
        categoria: capCategoria.trim(),
        n_suites: parseInt(capNSuites, 10),
        custo_variavel_locacao: parseFloat(capCusto || '0'),
        notes: capNotes.trim() || undefined,
      }
      const res = await fetch('/api/admin/unit-capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Erro ao salvar capacidade')
      }
      const saved = (await res.json()) as CapacityRow
      setCapacity((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved].sort((a, b) => a.categoria.localeCompare(b.categoria))
      })
      setCapCategoria('')
      setCapNSuites('')
      setCapCusto('')
      setCapNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setSavingCap(false)
    }
  }, [unitSlug, capCategoria, capNSuites, capCusto, capNotes])

  const handleDeleteCapacity = useCallback(async (id: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/unit-capacity?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setCapacity((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [])

  // ── Handlers: channel costs ─────────────────────────────────────────────
  const handleAddChannelCost = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSavingCc(true)
    try {
      const payload = {
        unitSlug,
        canal: ccCanal,
        comissao_pct: parseFloat(ccComissao || '0'),
        taxa_fixa: parseFloat(ccTaxaFixa || '0'),
        notes: ccNotes.trim() || undefined,
      }
      const res = await fetch('/api/admin/unit-channel-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Erro ao salvar comissão')
      }
      const saved = (await res.json()) as ChannelCostRow
      setChannelCosts((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved].sort((a, b) => a.canal.localeCompare(b.canal))
      })
      setCcComissao('')
      setCcTaxaFixa('')
      setCcNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setSavingCc(false)
    }
  }, [unitSlug, ccCanal, ccComissao, ccTaxaFixa, ccNotes])

  const handleDeleteChannelCost = useCallback(async (id: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/unit-channel-costs?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setChannelCosts((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [])

  const totalSuites = capacity.reduce((acc, r) => acc + r.n_suites, 0)

  return (
    <div className="flex flex-col gap-8">
      {/* Seletor de unidade */}
      {units.length > 1 && (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <Select value={unitSlug} onValueChange={handleUnitChange}>
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.slug}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ─── Seção 1: Capacidade por categoria ─────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BedDouble className="size-4" />
              Capacidade instalada — {unitName}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              N° de suítes e custo variável médio por locação (lavanderia, energia, A&B básico).
            </p>
          </div>
          {totalSuites > 0 && (
            <span className="text-xs text-muted-foreground">
              Total: <strong className="text-foreground">{totalSuites} suítes</strong>
            </span>
          )}
        </div>

        <form onSubmit={handleAddCapacity} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_2fr_auto] gap-2 items-end">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Categoria</Label>
            {categorias.length > 0 ? (
              <Select value={capCategoria} onValueChange={setCapCategoria}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Ex: Standard"
                value={capCategoria}
                onChange={(e) => setCapCategoria(e.target.value)}
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">N° suítes</Label>
            <Input
              type="number"
              min="1"
              placeholder="8"
              value={capNSuites}
              onChange={(e) => setCapNSuites(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Custo var. (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="18.00"
              value={capCusto}
              onChange={(e) => setCapCusto(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              placeholder="Ex: 2 com hidro"
              value={capNotes}
              onChange={(e) => setCapNotes(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={savingCap || !capCategoria || !capNSuites} size="sm">
            {savingCap ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </form>

        {capacity.length > 0 && (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Categoria</th>
                  <th className="text-right px-3 py-2 font-medium">N° suítes</th>
                  <th className="text-right px-3 py-2 font-medium">Custo var.</th>
                  <th className="text-left px-3 py-2 font-medium">Notas</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {capacity.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{r.categoria}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.n_suites}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      R$ {r.custo_variavel_locacao.toFixed(2).replace('.', ',')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.notes ?? '—'}</td>
                    <td className="px-2 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete({ kind: 'capacity', id: r.id })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Seção 2: Comissões por canal ──────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Percent className="size-4" />
            Comissões por canal — {unitName}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            % de comissão e taxa fixa por reserva. Usado para cálculo de margem líquida.
          </p>
        </div>

        <form onSubmit={handleAddChannelCost} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_2fr_auto] gap-2 items-end">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Canal</Label>
            <Select value={ccCanal} onValueChange={setCcCanal}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANAL_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Comissão (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="12"
              value={ccComissao}
              onChange={(e) => setCcComissao(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Taxa fixa (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={ccTaxaFixa}
              onChange={(e) => setCcTaxaFixa(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              placeholder="Ex: comissão Booking"
              value={ccNotes}
              onChange={(e) => setCcNotes(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={savingCc || !ccComissao} size="sm">
            {savingCc ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </form>

        {channelCosts.length > 0 && (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Canal</th>
                  <th className="text-right px-3 py-2 font-medium">Comissão</th>
                  <th className="text-right px-3 py-2 font-medium">Taxa fixa</th>
                  <th className="text-left px-3 py-2 font-medium">Notas</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {channelCosts.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{CANAL_LABEL[r.canal] ?? r.canal}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.comissao_pct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      R$ {r.taxa_fixa.toFixed(2).replace('.', ',')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.notes ?? '—'}</td>
                    <td className="px-2 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete({ kind: 'channel', id: r.id })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O agente RM perderá acesso a esses dados imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => {
                if (!confirmDelete) return
                if (confirmDelete.kind === 'capacity') handleDeleteCapacity(confirmDelete.id)
                else handleDeleteChannelCost(confirmDelete.id)
              }}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
