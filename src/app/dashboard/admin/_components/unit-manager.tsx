'use client'

import { useState, useCallback } from 'react'
import { Plus, Pencil, X, Check, Loader2, Building2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface UnitRow {
  id: string
  name: string
  slug: string
  city: string | null
  state: string | null
  is_active: boolean
  automo_env_key: string | null
  automo_category_ids: number[]
  period_type: 'standard' | 'altana' | null
  logo_path: string | null
  currency_code: string
  created_at: string
}

interface UnitManagerProps {
  initialUnits: UnitRow[]
}

const PERIOD_TYPE_LABELS: Record<string, string> = {
  standard: 'Padrão (3h/6h/12h/Pernoite)',
  altana: 'Altana (1h/2h/4h/12h)',
}

function emptyForm(): Omit<UnitRow, 'id' | 'created_at'> {
  return {
    name: '',
    slug: '',
    city: '',
    state: '',
    is_active: true,
    automo_env_key: '',
    automo_category_ids: [],
    period_type: 'standard',
    logo_path: '',
    currency_code: 'BRL',
  }
}

export function UnitManager({ initialUnits }: UnitManagerProps) {
  const [units, setUnits] = useState<UnitRow[]>(initialUnits)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setForm(emptyForm())
    setShowForm(false)
    setEditingId(null)
    setError(null)
  }, [])

  const startEdit = useCallback((unit: UnitRow) => {
    setEditingId(unit.id)
    setShowForm(false)
    setForm({
      name: unit.name,
      slug: unit.slug,
      city: unit.city ?? '',
      state: unit.state ?? '',
      is_active: unit.is_active,
      automo_env_key: unit.automo_env_key ?? '',
      automo_category_ids: unit.automo_category_ids,
      period_type: unit.period_type ?? 'standard',
      logo_path: unit.logo_path ?? '',
      currency_code: unit.currency_code ?? 'BRL',
    })
    setError(null)
  }, [])

  const parseCategoryIds = (raw: string): number[] =>
    raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))

  async function handleSave() {
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Nome e slug são obrigatórios.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name.trim(),
        slug: form.slug.trim(),
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        is_active: form.is_active,
        automo_env_key: form.automo_env_key?.trim() || null,
        automo_category_ids: form.automo_category_ids,
        period_type: form.period_type,
        logo_path: form.logo_path?.trim() || null,
        currency_code: form.currency_code || 'BRL',
      }
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch('/api/admin/units', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido')
      const saved = json.unit as UnitRow
      setUnits((prev) =>
        editingId
          ? prev.map((u) => (u.id === editingId ? saved : u))
          : [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
      )
      resetForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(unit: UnitRow) {
    try {
      const res = await fetch('/api/admin/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unit.id, is_active: !unit.is_active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUnits((prev) => prev.map((u) => (u.id === unit.id ? json.unit : u)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const currentlyEditing = editingId ? units.find((u) => u.id === editingId) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Unidades cadastradas</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adicionar ou editar unidades sem alterar código.
          </p>
        </div>
        {!showForm && !editingId && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setShowForm(true)}>
            <Plus className="size-3.5" />
            Nova unidade
          </Button>
        )}
      </div>

      {/* Form de criação */}
      {showForm && (
        <UnitForm
          form={form}
          setForm={setForm}
          title="Nova unidade"
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={resetForm}
          parseCategoryIds={parseCategoryIds}
        />
      )}

      {/* Lista de unidades */}
      <div className="space-y-2">
        {units.map((unit) => (
          <div key={unit.id} className="border rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Building2 className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{unit.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{unit.slug}</span>
                  {unit.city && (
                    <span className="text-xs text-muted-foreground">{unit.city}{unit.state ? `, ${unit.state}` : ''}</span>
                  )}
                  <Badge variant={unit.is_active ? 'default' : 'secondary'} className="text-[10px] h-4 px-1.5">
                    {unit.is_active ? 'Ativa' : 'Inativa'}
                  </Badge>
                </div>
                {editingId !== unit.id && (
                  <div className="flex items-center gap-3 mt-0.5">
                    {unit.automo_env_key && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        DATABASE_URL_LOCAL_{unit.automo_env_key}
                      </span>
                    )}
                    {unit.automo_category_ids?.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        IDs: {unit.automo_category_ids.join(', ')}
                      </span>
                    )}
                    {unit.period_type && (
                      <span className="text-[11px] text-muted-foreground">
                        {PERIOD_TYPE_LABELS[unit.period_type] ?? unit.period_type}
                      </span>
                    )}
                    {unit.currency_code && unit.currency_code !== 'BRL' && (
                      <span className="text-[11px] font-mono text-amber-500">{unit.currency_code}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {editingId !== unit.id && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setExpandedId(expandedId === unit.id ? null : unit.id)}
                    >
                      {expandedId === unit.id ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => { setExpandedId(null); startEdit(unit) }}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Inline edit form */}
            {editingId === unit.id && (
              <div className="border-t bg-muted/30 px-3 pb-3 pt-2">
                <UnitForm
                  form={form}
                  setForm={setForm}
                  title={`Editar: ${currentlyEditing?.name}`}
                  saving={saving}
                  error={error}
                  onSave={handleSave}
                  onCancel={resetForm}
                  parseCategoryIds={parseCategoryIds}
                  showActiveToggle
                  isActive={form.is_active}
                  onToggleActive={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                />
              </div>
            )}

            {/* Expanded details */}
            {expandedId === unit.id && editingId !== unit.id && (
              <div className="border-t bg-muted/20 px-3 py-2.5 space-y-1.5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Env key: </span>
                    <span className="font-mono">{unit.automo_env_key ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Period type: </span>
                    <span>{unit.period_type ?? '—'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Category IDs: </span>
                    <span className="font-mono">{unit.automo_category_ids?.join(', ') || '—'}</span>
                  </div>
                  {unit.logo_path && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Logo path: </span>
                      <span className="font-mono">{unit.logo_path}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => toggleActive(unit)}
                  >
                    {unit.is_active ? 'Desativar unidade' : 'Reativar unidade'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sub-componente de formulário ─────────────────────────────────────────────

const CURRENCY_OPTIONS = [
  { value: 'BRL', label: 'BRL — Real brasileiro (R$)' },
  { value: 'USD', label: 'USD — Dólar americano ($)' },
  { value: 'PEN', label: 'PEN — Sol peruano (S/)' },
  { value: 'COP', label: 'COP — Peso colombiano ($)' },
  { value: 'ARS', label: 'ARS — Peso argentino ($)' },
]

interface UnitFormProps {
  form: Omit<UnitRow, 'id' | 'created_at'>
  setForm: React.Dispatch<React.SetStateAction<Omit<UnitRow, 'id' | 'created_at'>>>
  title: string
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  parseCategoryIds: (raw: string) => number[]
  showActiveToggle?: boolean
  isActive?: boolean
  onToggleActive?: () => void
}

function UnitForm({
  form, setForm, title, saving, error, onSave, onCancel,
  parseCategoryIds, showActiveToggle, isActive, onToggleActive,
}: UnitFormProps) {
  const [catRaw, setCatRaw] = useState(form.automo_category_ids?.join(', ') ?? '')

  return (
    <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Button size="icon" variant="ghost" className="size-7" onClick={onCancel}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nome *</Label>
          <Input
            className="h-8 text-xs"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Lush Ipiranga"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Slug *</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="lush-ipiranga"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cidade</Label>
          <Input
            className="h-8 text-xs"
            value={form.city ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            placeholder="São Paulo"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Estado/País</Label>
          <Input
            className="h-8 text-xs"
            value={form.state ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            placeholder="SP"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Automo Env Key</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={form.automo_env_key ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, automo_env_key: e.target.value }))}
            placeholder="IPIRANGA"
          />
          <p className="text-[10px] text-muted-foreground">
            Variável: DATABASE_URL_LOCAL_{form.automo_env_key || 'KEY'}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period Type</Label>
          <Select
            value={form.period_type ?? 'standard'}
            onValueChange={(v) => setForm((f) => ({ ...f, period_type: v as 'standard' | 'altana' }))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard" className="text-xs">Padrão (3h/6h/12h/Pernoite)</SelectItem>
              <SelectItem value="altana" className="text-xs">Altana (1h/2h/4h/12h)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Moeda local</Label>
          <Select
            value={form.currency_code || 'BRL'}
            onValueChange={(v) => setForm((f) => ({ ...f, currency_code: v }))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Category IDs (Automo)</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={catRaw}
            onChange={(e) => {
              setCatRaw(e.target.value)
              setForm((f) => ({ ...f, automo_category_ids: parseCategoryIds(e.target.value) }))
            }}
            placeholder="1, 2, 3, 4, 5"
          />
          <p className="text-[10px] text-muted-foreground">IDs separados por vírgula</p>
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Logo Path (opcional)</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={form.logo_path ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, logo_path: e.target.value }))}
            placeholder="/logos/lush.png"
          />
        </div>
      </div>

      {showActiveToggle && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_active_toggle"
            checked={isActive}
            onChange={onToggleActive}
            className="size-3.5"
          />
          <label htmlFor="is_active_toggle" className="text-xs cursor-pointer">Unidade ativa</label>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" className="text-xs h-7 gap-1.5" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Salvar
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-7" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
