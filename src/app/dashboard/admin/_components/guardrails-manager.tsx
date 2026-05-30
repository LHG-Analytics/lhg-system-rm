'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Shield, Loader2, Building2, Clock, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'

interface Guardrail {
  id: string
  categoria: string
  periodo: string
  dia_semana: string
  hora_inicio: string | null
  hora_fim: string | null
  preco_minimo: number
  preco_maximo: number
}

interface Unit {
  id: string
  name: string
  slug: string
}

interface GuardrailsManagerProps {
  unitSlug: string
  unitName: string
  categorias: string[]
  periodos: string[]
  initialGuardrails: Guardrail[]
  units: Unit[]
}

const PERIODOS_FALLBACK = ['3h', '6h', '12h', 'pernoite']

const DIAS_SEMANA = [
  { value: 'segunda', short: 'Seg', label: 'Segunda' },
  { value: 'terca',   short: 'Ter', label: 'Terça'   },
  { value: 'quarta',  short: 'Qua', label: 'Quarta'  },
  { value: 'quinta',  short: 'Qui', label: 'Quinta'  },
  { value: 'sexta',   short: 'Sex', label: 'Sexta'   },
  { value: 'sabado',  short: 'Sáb', label: 'Sábado'  },
  { value: 'domingo', short: 'Dom', label: 'Domingo' },
]

const DIA_LABEL: Record<string, string> = {
  todos:       'Todos os dias',
  segunda:     'Segunda',
  terca:       'Terça',
  quarta:      'Quarta',
  quinta:      'Quinta',
  sexta:       'Sexta',
  sabado:      'Sábado',
  domingo:     'Domingo',
  // legados migrados
  semana:      'Semana',
  fds_feriado: 'FDS/Feriado',
}

function deduplicateCategorias(cats: string[]): string[] {
  const seen = new Map<string, string>()
  for (const c of cats) {
    const key = c.trim().toLowerCase()
    if (!seen.has(key)) seen.set(key, c.trim())
  }
  return [...seen.values()].sort()
}

export function GuardrailsManager({ unitSlug, unitName, categorias, periodos, initialGuardrails, units }: GuardrailsManagerProps) {
  const router = useRouter()
  const periodoOptions = periodos.length > 0 ? periodos : PERIODOS_FALLBACK
  const uniqueCategorias = deduplicateCategorias(categorias)

  const [guardrails, setGuardrails] = useState<Guardrail[]>(initialGuardrails)
  const [categoria, setCategoria]     = useState('')
  const [periodo, setPeriodo]         = useState(periodoOptions[0] ?? '3h')
  const [diasSelecionados, setDiasSelecionados] = useState<string[]>([])
  const [showTime, setShowTime]       = useState(false)
  const [horaInicio, setHoraInicio]   = useState('')
  const [horaFim, setHoraFim]         = useState('')
  const [precoMin, setPrecoMin]       = useState('')
  const [precoMax, setPrecoMax]       = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)

  const toggleDay = useCallback((day: string) => {
    setDiasSelecionados((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }, [])

  const toggleAllDays = useCallback(() => {
    setDiasSelecionados((prev) =>
      prev.length === DIAS_SEMANA.length ? [] : DIAS_SEMANA.map((d) => d.value)
    )
  }, [])

  const handleAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (diasSelecionados.length === 0) { setError('Selecione ao menos um dia da semana'); return }
    const min = parseFloat(precoMin.replace(',', '.'))
    const max = parseFloat(precoMax.replace(',', '.'))
    if (isNaN(min) || isNaN(max)) { setError('Valores de preço inválidos'); return }
    if (min >= max) { setError('Preço mínimo deve ser menor que o máximo'); return }
    if (showTime && horaInicio && horaFim && horaInicio >= horaFim) {
      setError('Horário de início deve ser anterior ao de fim'); return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug,
          categoria,
          periodo,
          dias: diasSelecionados,
          hora_inicio: showTime && horaInicio ? horaInicio : undefined,
          hora_fim:    showTime && horaFim    ? horaFim    : undefined,
          preco_minimo: min,
          preco_maximo: max,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')

      // API retorna array — upsert no estado
      const newRows = Array.isArray(data) ? data as Guardrail[] : [data as Guardrail]
      setGuardrails((prev) => {
        let updated = [...prev]
        for (const row of newRows) {
          const idx = updated.findIndex((g) => g.id === row.id)
          if (idx >= 0) updated[idx] = row
          else updated = [row, ...updated]
        }
        return updated
      })

      // Reset form
      setDiasSelecionados([])
      setPrecoMin('')
      setPrecoMax('')
      setHoraInicio('')
      setHoraFim('')
      setShowTime(false)
      setCategoria('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [unitSlug, categoria, periodo, diasSelecionados, showTime, horaInicio, horaFim, precoMin, precoMax])

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

  const allSelected = diasSelecionados.length === DIAS_SEMANA.length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* Seletor de unidade */}
        {units.length > 1 && (
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <Select value={unitSlug} onValueChange={(slug) => router.push(`/dashboard/admin?unit=${slug}`)}>
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
            <Shield className="size-4 text-primary" />
            Guardrails de Preço — {unitName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Limites de preço que o agente RM não pode ultrapassar ao gerar propostas.
            {categorias.length === 0 && ' Importe uma tabela de preços para ver as categorias disponíveis.'}
          </p>
        </div>
      </div>

      {/* Formulário */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Adicionar ou atualizar limite</h3>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <form onSubmit={handleAdd} className="flex flex-col gap-4">
          {/* Categoria + Período */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Categoria</Label>
              {uniqueCategorias.length > 0 ? (
                <Select value={categoria} onValueChange={setCategoria} disabled={saving}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecionar categoria…" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueCategorias.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Ex: Luxo, Standard…"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  required
                  disabled={saving}
                  className="h-9 text-sm"
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={setPeriodo} disabled={saving}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodoOptions.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dias da semana — multi-seleção */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Dias da semana</Label>
              <button
                type="button"
                onClick={toggleAllDays}
                disabled={saving}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {DIAS_SEMANA.map((d) => {
                const selected = diasSelecionados.includes(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    disabled={saving}
                    className={cn(
                      'min-w-[40px] px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all',
                      selected
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/60 hover:text-foreground'
                    )}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
            {diasSelecionados.length === 0 && (
              <p className="text-[11px] text-muted-foreground/60">Selecione ao menos um dia</p>
            )}
          </div>

          {/* Faixa horária opcional */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => { setShowTime(!showTime); if (showTime) { setHoraInicio(''); setHoraFim('') } }}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-fit transition-colors"
            >
              {showTime
                ? <><X className="size-3" /> Remover horário</>
                : <><Clock className="size-3" /> Adicionar faixa horária (opcional)</>
              }
            </button>
            {showTime && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Das</Label>
                  <Input
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    disabled={saving}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Até</Label>
                  <Input
                    type="time"
                    value={horaFim}
                    onChange={(e) => setHoraFim(e.target.value)}
                    disabled={saving}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Preços */}
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

          <div className="flex items-center justify-between">
            {diasSelecionados.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Serão criados {diasSelecionados.length} guardrails (um por dia)
              </p>
            )}
            <div className="ml-auto">
              <Button type="submit" size="sm" className="gap-1.5" disabled={saving || !categoria || diasSelecionados.length === 0}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Salvar guardrail{diasSelecionados.length > 1 ? `s (${diasSelecionados.length})` : ''}
              </Button>
            </div>
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
                  <Badge variant="secondary" className="text-[10px]">
                    {DIA_LABEL[g.dia_semana] ?? g.dia_semana}
                  </Badge>
                  {(g.hora_inicio || g.hora_fim) && (
                    <Badge variant="outline" className="text-[10px] gap-0.5 text-muted-foreground">
                      <Clock className="size-2.5" />
                      {g.hora_inicio ?? '00:00'}–{g.hora_fim ?? '23:59'}
                    </Badge>
                  )}
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
              O agente poderá propor qualquer preço para essa combinação dentro do limite configurado.
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
