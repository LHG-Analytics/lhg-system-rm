'use client'

import { useState } from 'react'
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
import { Loader2, Building2, CheckCircle2 } from 'lucide-react'

interface UnitConfig {
  unit_id: string
  city: string
  timezone: string
}

interface UnitSettingsProps {
  units: { id: string; name: string; slug: string; city: string | null }[]
  agentConfigs: { unit_id: string; city: string; timezone: string }[]
  activeUnitSlug: string
}

const TIMEZONES = [
  { value: 'America/Sao_Paulo',    label: 'Brasília (UTC−3)' },
  { value: 'America/Fortaleza',    label: 'Fortaleza (UTC−3)' },
  { value: 'America/Recife',       label: 'Recife (UTC−3)' },
  { value: 'America/Belem',        label: 'Belém (UTC−3)' },
  { value: 'America/Manaus',       label: 'Manaus (UTC−4)' },
  { value: 'America/Cuiaba',       label: 'Cuiabá (UTC−4)' },
  { value: 'America/Porto_Velho',  label: 'Porto Velho (UTC−4)' },
  { value: 'America/Rio_Branco',   label: 'Rio Branco (UTC−5)' },
  { value: 'America/Noronha',      label: 'Fernando de Noronha (UTC−2)' },
]

export function UnitSettings({ units, agentConfigs, activeUnitSlug }: UnitSettingsProps) {
  const [selectedSlug, setSelectedSlug] = useState(activeUnitSlug)
  const activeUnit = units.find((u) => u.slug === selectedSlug) ?? units[0]

  const configForUnit = (unitId: string): UnitConfig => {
    const existing = agentConfigs.find((c) => c.unit_id === unitId)
    return {
      unit_id: unitId,
      city: existing?.city ?? 'Sao Paulo,BR',
      timezone: existing?.timezone ?? 'America/Sao_Paulo',
    }
  }

  const [configs, setConfigs] = useState<Record<string, UnitConfig>>(() => {
    const map: Record<string, UnitConfig> = {}
    for (const u of units) map[u.id] = configForUnit(u.id)
    return map
  })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const current = activeUnit ? configs[activeUnit.id] : null

  function updateCurrent(patch: Partial<UnitConfig>) {
    if (!activeUnit) return
    setConfigs((prev) => ({ ...prev, [activeUnit.id]: { ...prev[activeUnit.id], ...patch } }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeUnit || !current) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: activeUnit.id, city: current.city, timezone: current.timezone }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (!activeUnit || !current) return null

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <Building2 className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Configurações da unidade</p>
          <p className="text-xs text-muted-foreground">Fuso horário e cidade usados pelo agente RM.</p>
        </div>
      </div>

      {units.length > 1 && (
        <Select value={selectedSlug} onValueChange={setSelectedSlug}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u.slug} value={u.slug}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Fuso horário</Label>
            <Select value={current.timezone} onValueChange={(v) => updateCurrent({ timezone: v })} disabled={saving}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Cidade (para clima e eventos)</Label>
            <Input
              placeholder="Ex: Sao Paulo,BR"
              value={current.city}
              onChange={(e) => updateCurrent({ city: e.target.value })}
              disabled={saving}
              className="h-9 text-sm"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Formato da cidade: <span className="font-mono">Nome da Cidade,XX</span> onde XX é o código ISO do país (ex: BR, US).
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="gap-1.5" disabled={saving}>
            {saving
              ? <Loader2 className="size-3.5 animate-spin" />
              : saved
              ? <CheckCircle2 className="size-3.5 text-emerald-500" />
              : null}
            {saved ? 'Salvo!' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
