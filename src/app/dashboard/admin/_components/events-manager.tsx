'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Building2, CalendarDays, Loader2, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import type { UnitEvent, EventType } from '@/app/api/admin/unit-events/route'

interface Unit { id: string; name: string; slug: string }

interface Props {
  unitSlug: string
  unitName: string
  units: Unit[]
  initialEvents: UnitEvent[]
}

const EVENT_TYPE_CONFIG = {
  positivo: { label: 'Positivo', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', dot: '🟢' },
  negativo: { label: 'Negativo', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20', dot: '🔴' },
  neutro:   { label: 'Neutro',   color: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20', dot: '⚪' },
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function toInputDate(dateStr: string) {
  return dateStr.slice(0, 10)
}

export function EventsManager({ unitSlug, unitName, units, initialEvents }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [events, setEvents] = useState<UnitEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    event_date: '',
    event_end_date: '',
    event_type: 'negativo' as EventType,
    impact_description: '',
  })

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<UnitEvent>>({})

  const activeSlug = unitSlug

  async function loadEvents(slug: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/unit-events?unitSlug=${slug}`)
      if (res.ok) setEvents(await res.json())
    } finally {
      setLoading(false)
    }
  }

  function handleUnitChange(slug: string) {
    startTransition(() => {
      router.push(`?unit=${slug}&tab=eventos`)
    })
    loadEvents(slug)
  }

  async function handleCreate() {
    if (!form.title || !form.event_date || !form.event_type) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/unit-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug: activeSlug,
          title: form.title.trim(),
          event_date: form.event_date,
          event_end_date: form.event_end_date || null,
          event_type: form.event_type,
          impact_description: form.impact_description.trim() || null,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setEvents((prev) => [created, ...prev])
        setForm({ title: '', event_date: '', event_end_date: '', event_type: 'negativo', impact_description: '' })
        setShowForm(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/unit-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      })
      if (res.ok) {
        const updated = await res.json()
        setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)))
        setEditingId(null)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/unit-events?id=${id}`, { method: 'DELETE' })
    if (res.ok) setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  function startEdit(ev: UnitEvent) {
    setEditingId(ev.id)
    setEditForm({
      title: ev.title,
      event_date: ev.event_date,
      event_end_date: ev.event_end_date,
      event_type: ev.event_type,
      impact_description: ev.impact_description,
    })
  }

  return (
    <div className="space-y-6">
      {/* Seletor de unidade */}
      {units.length > 1 && (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <Select value={activeSlug} onValueChange={handleUnitChange}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.slug} value={u.slug} className="text-xs">{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Header + botão novo evento */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Calendário de Eventualidades</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Registre eventos que afetaram a demanda — o agente usa essas informações ao analisar períodos.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-3.5" />
          Novo evento
        </Button>
      </div>

      {/* Formulário de criação */}
      {showForm && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <p className="text-xs font-medium">Novo evento — {unitName}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Título *</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Ex: Carnaval 2026, Problema de manutenção..."
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data início *</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.event_date}
                onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data fim (opcional)</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.event_end_date}
                onChange={(e) => setForm((f) => ({ ...f, event_end_date: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Impacto *</Label>
              <Select value={form.event_type} onValueChange={(v) => setForm((f) => ({ ...f, event_type: v as EventType }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="positivo" className="text-xs">🟢 Positivo (aumentou demanda)</SelectItem>
                  <SelectItem value="negativo" className="text-xs">🔴 Negativo (reduziu demanda)</SelectItem>
                  <SelectItem value="neutro"   className="text-xs">⚪ Neutro (contexto)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Descrição do impacto (opcional)</Label>
              <Textarea
                className="text-xs min-h-[60px] resize-none"
                placeholder="Ex: Feriado prolongado gerou pico de reservas no Guia e Booking..."
                value={form.impact_description}
                onChange={(e) => setForm((f) => ({ ...f, impact_description: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleCreate}
              disabled={saving || !form.title || !form.event_date}
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* Lista de eventos */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center border rounded-lg bg-muted/20">
          <CalendarDays className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
          <p className="text-xs text-muted-foreground/70">Registre carnavais, feriados, problemas operacionais e outros eventos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const cfg = EVENT_TYPE_CONFIG[ev.event_type]
            const isEditing = editingId === ev.id

            return (
              <div key={ev.id} className="border rounded-lg p-3 space-y-2">
                {isEditing ? (
                  /* Modo edição */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Título</Label>
                        <Input
                          className="h-7 text-xs"
                          value={editForm.title ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Data início</Label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={editForm.event_date ? toInputDate(editForm.event_date) : ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, event_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Data fim</Label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={editForm.event_end_date ? toInputDate(editForm.event_end_date) : ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, event_end_date: e.target.value || null }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Impacto</Label>
                        <Select
                          value={editForm.event_type ?? ev.event_type}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, event_type: v as EventType }))}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="positivo" className="text-xs">🟢 Positivo</SelectItem>
                            <SelectItem value="negativo" className="text-xs">🔴 Negativo</SelectItem>
                            <SelectItem value="neutro"   className="text-xs">⚪ Neutro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Descrição</Label>
                        <Textarea
                          className="text-xs min-h-[50px] resize-none"
                          value={editForm.impact_description ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, impact_description: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm" variant="ghost" className="h-6 text-xs gap-1"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-3" /> Cancelar
                      </Button>
                      <Button
                        size="sm" className="h-6 text-xs gap-1"
                        onClick={() => handleSaveEdit(ev.id)}
                        disabled={saving}
                      >
                        {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Modo visualização */
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{ev.title}</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.color}`}>
                          {cfg.dot} {cfg.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(ev.event_date)}
                        {ev.event_end_date && ev.event_end_date !== ev.event_date
                          ? ` → ${formatDate(ev.event_end_date)}`
                          : ''}
                      </p>
                      {ev.impact_description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ev.impact_description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon" variant="ghost" className="size-6"
                        onClick={() => startEdit(ev)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="size-6 text-destructive hover:text-destructive">
                            <Trash2 className="size-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir evento?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{ev.title}" será removido permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(ev.id)} className="bg-destructive hover:bg-destructive/90">
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
