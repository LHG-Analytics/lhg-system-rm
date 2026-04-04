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

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Formata hora de início: 06 → "06:00:00" */
function fmtStartHour(h: number) { return `${String(h).padStart(2, '0')}:00:00` }
/** Formata hora de fim:   05 → "05:59:59" */
function fmtEndHour(h: number)   { return `${String(h).padStart(2, '0')}:59:59` }

function clampHour(v: string | null, fallback: number): number {
  const n = parseInt(v ?? '')
  return isNaN(n) || n < 0 || n > 23 ? fallback : n
}

export type DateType = 'all' | 'checkin' | 'checkout'

const DATE_TYPE_OPTIONS: { value: DateType; label: string; description: string }[] = [
  { value: 'checkin',  label: 'Entrada', description: 'Filtrar pela data de entrada na suíte' },
  { value: 'checkout', label: 'Saída',   description: 'Filtrar pela data de saída da suíte'   },
  { value: 'all',      label: 'Todas',   description: 'Considerar entradas e saídas'          },
]

export type RentalStatus = 'FINALIZADA' | 'TRANSFERIDA' | 'CANCELADA' | 'ABERTA' | 'TODAS'

const STATUS_OPTIONS: { value: RentalStatus; label: string; description: string }[] = [
  { value: 'FINALIZADA',  label: 'Finalizadas',   description: 'Locações encerradas normalmente' },
  { value: 'TRANSFERIDA', label: 'Transferidas',  description: 'Transferidas para outra suíte'   },
  { value: 'CANCELADA',   label: 'Canceladas',    description: 'Canceladas antes do fim'         },
  { value: 'ABERTA',      label: 'Em aberto',     description: 'Locações ainda em andamento'     },
  { value: 'TODAS',       label: 'Todas',         description: 'Sem filtro de status'            },
]

export function DateRangePicker() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const preset   = (searchParams.get('preset') ?? 'this-month') as DatePreset
  const urlStart = searchParams.get('start') ?? ''
  const urlEnd   = searchParams.get('end')   ?? ''

  function getResolved(p: DatePreset, s: string, e: string) {
    return resolvePreset(p, s || null, e || null)
  }

  const initial = getResolved(preset, urlStart, urlEnd)
  const [localStart,     setLocalStart]     = useState(initial.startDate)
  const [localEnd,       setLocalEnd]       = useState(initial.endDate)
  const [localStartHour, setLocalStartHour] = useState(() => clampHour(searchParams.get('startHour'), 6))
  const [localEndHour,   setLocalEndHour]   = useState(() => clampHour(searchParams.get('endHour'),   5))
  const [localDateType,  setLocalDateType]  = useState<DateType>(
    () => (searchParams.get('dateType') as DateType) ?? 'checkin'
  )
  const [localStatus,    setLocalStatus]    = useState<RentalStatus>(
    () => (searchParams.get('status') as RentalStatus) ?? 'FINALIZADA'
  )

  // Sync when URL changes (unit switch, back/forward)
  useEffect(() => {
    const p = (searchParams.get('preset') ?? 'this-month') as DatePreset
    const s = searchParams.get('start') ?? ''
    const e = searchParams.get('end')   ?? ''
    const r = getResolved(p, s, e)
    setLocalStart(r.startDate)
    setLocalEnd(r.endDate)
    setLocalStartHour(clampHour(searchParams.get('startHour'), 6))
    setLocalEndHour(clampHour(searchParams.get('endHour'),   5))
    setLocalDateType((searchParams.get('dateType') as DateType) ?? 'checkin')
    setLocalStatus((searchParams.get('status') as RentalStatus) ?? 'FINALIZADA')
  }, [searchParams])

  function navigate(extra: Record<string, string>) {
    const params = new URLSearchParams()
    const DATE_KEYS = new Set(['preset', 'start', 'end', 'startHour', 'endHour', 'dateType', 'status'])
    for (const [k, v] of searchParams.entries()) {
      if (!DATE_KEYS.has(k)) params.set(k, v)
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v !== '') params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function handlePresetChange(value: string) {
    const resolved = resolvePreset(value as DatePreset)
    setLocalStart(resolved.startDate)
    setLocalEnd(resolved.endDate)
    navigate({
      preset:    value,
      start:     resolved.startDate,
      end:       resolved.endDate,
      startHour: String(localStartHour),
      endHour:   String(localEndHour),
      dateType:  localDateType,
      status:    localStatus,
    })
  }

  function handleApply() {
    if (!localStart || !localEnd) return
    navigate({
      preset:    'custom',
      start:     localStart,
      end:       localEnd,
      startHour: String(localStartHour),
      endHour:   String(localEndHour),
      dateType:  localDateType,
      status:    localStatus,
    })
  }

  const today = new Date().toISOString().slice(0, 10)
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
      </div>

      {/* Filtro de horas */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">das</span>
        <select
          value={localStartHour}
          onChange={(e) => setLocalStartHour(Number(e.target.value))}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{fmtStartHour(h)}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">às</span>
        <select
          value={localEndHour}
          onChange={(e) => setLocalEndHour(Number(e.target.value))}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{fmtEndHour(h)}</option>
          ))}
        </select>
      </div>

      {/* Filtro de tipo de data */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Data</span>
        <select
          value={localDateType}
          onChange={(e) => setLocalDateType(e.target.value as DateType)}
          title={DATE_TYPE_OPTIONS.find(o => o.value === localDateType)?.description}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {DATE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filtro de status de locação */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <select
          value={localStatus}
          onChange={(e) => setLocalStatus(e.target.value as RentalStatus)}
          title={STATUS_OPTIONS.find(o => o.value === localStatus)?.description}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleApply}
        disabled={!localStart || !localEnd}
        className="h-7 px-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Aplicar
      </button>
    </div>
  )
}
