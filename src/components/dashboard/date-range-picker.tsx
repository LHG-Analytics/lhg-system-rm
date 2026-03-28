'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import type { DatePreset } from '@/lib/date-range'

const PRESETS: { value: DatePreset | ''; label: string }[] = [
  { value: '',             label: 'Últimos 12 meses' },
  { value: '7d',          label: 'Últimos 7 dias'   },
  { value: 'this-month',  label: 'Este mês'         },
  { value: 'last-month',  label: 'Último mês fechado' },
  { value: 'custom',      label: 'Personalizada'    },
]

export function DateRangePicker() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const preset   = searchParams.get('preset') ?? ''
  const urlStart = searchParams.get('start')  ?? ''
  const urlEnd   = searchParams.get('end')    ?? ''

  const [localStart, setLocalStart] = useState(urlStart)
  const [localEnd,   setLocalEnd]   = useState(urlEnd)

  // Sync when URL changes externally (e.g. unit switch)
  useEffect(() => {
    setLocalStart(searchParams.get('start') ?? '')
    setLocalEnd(searchParams.get('end')   ?? '')
  }, [searchParams])

  function navigate(extra: Record<string, string>) {
    const params = new URLSearchParams()
    // Preserve unit and other non-date params
    for (const [k, v] of searchParams.entries()) {
      if (k !== 'preset' && k !== 'start' && k !== 'end') {
        params.set(k, v)
      }
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function handlePresetChange(value: string) {
    if (value === 'custom') {
      navigate({ preset: 'custom', ...(localStart && localEnd ? { start: localStart, end: localEnd } : {}) })
    } else if (value) {
      navigate({ preset: value })
    } else {
      navigate({})
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="size-3.5 text-muted-foreground shrink-0" />

      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {PRESETS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={localStart}
            max={localEnd || today}
            onChange={(e) => setLocalStart(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={localEnd}
            min={localStart}
            max={today}
            onChange={(e) => setLocalEnd(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => localStart && localEnd && navigate({ preset: 'custom', start: localStart, end: localEnd })}
            disabled={!localStart || !localEnd}
            className="h-7 px-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  )
}
