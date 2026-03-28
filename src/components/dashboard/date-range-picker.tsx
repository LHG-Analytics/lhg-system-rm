'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import type { DatePreset } from '@/lib/date-range'
import { resolvePreset } from '@/lib/date-range'

const PRESETS: { value: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { value: '7d',          label: 'Últimos 7 dias'     },
  { value: 'this-month',  label: 'Este mês'           },
  { value: 'last-month',  label: 'Último mês fechado' },
]

export function DateRangePicker() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const preset   = (searchParams.get('preset') ?? 'this-month') as DatePreset
  const urlStart = searchParams.get('start') ?? ''
  const urlEnd   = searchParams.get('end')   ?? ''

  // Resolve effective dates (preset → calculated, custom → URL dates)
  function getResolved(p: DatePreset, s: string, e: string) {
    return resolvePreset(p, s || null, e || null)
  }

  const initial = getResolved(preset, urlStart, urlEnd)
  const [localStart, setLocalStart] = useState(initial.startDate)
  const [localEnd,   setLocalEnd]   = useState(initial.endDate)

  // Sync when URL changes (e.g. unit switch, back/forward)
  useEffect(() => {
    const p = (searchParams.get('preset') ?? 'this-month') as DatePreset
    const s = searchParams.get('start') ?? ''
    const e = searchParams.get('end')   ?? ''
    const r = getResolved(p, s, e)
    setLocalStart(r.startDate)
    setLocalEnd(r.endDate)
  }, [searchParams])

  function navigate(extra: Record<string, string>) {
    const params = new URLSearchParams()
    for (const [k, v] of searchParams.entries()) {
      if (k !== 'preset' && k !== 'start' && k !== 'end') params.set(k, v)
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function handlePresetChange(value: string) {
    const resolved = resolvePreset(value as DatePreset)
    setLocalStart(resolved.startDate)
    setLocalEnd(resolved.endDate)
    navigate({ preset: value, start: resolved.startDate, end: resolved.endDate })
  }

  // When user edits dates manually, treat as custom range
  function handleApply() {
    if (!localStart || !localEnd) return
    navigate({ preset: 'custom', start: localStart, end: localEnd })
  }

  const today = new Date().toISOString().slice(0, 10)

  // Dropdown shows the preset if it's one of the 3 known ones, else falls back to 'this-month'
  const displayPreset = PRESETS.find((p) => p.value === preset)?.value ?? 'this-month'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="size-3.5 text-foreground shrink-0 cursor-pointer" />

      <select
        value={displayPreset}
        onChange={(e) => handlePresetChange(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {PRESETS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={localStart}
          max={localEnd || today}
          onChange={(e) => setLocalStart(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          value={localEnd}
          min={localStart}
          max={today}
          onChange={(e) => setLocalEnd(e.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleApply}
          disabled={!localStart || !localEnd}
          className="h-7 px-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Aplicar
        </button>
      </div>
    </div>
  )
}
