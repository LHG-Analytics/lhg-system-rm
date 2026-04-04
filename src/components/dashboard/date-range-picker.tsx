'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { CalendarIcon } from 'lucide-react'
import type { DatePreset } from '@/lib/date-range'
import { resolvePreset } from '@/lib/date-range'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ─── Dados estáticos ──────────────────────────────────────────────────────────

const PRESETS: { value: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { value: '7d',         label: 'Últimos 7 dias'     },
  { value: 'this-month', label: 'Este mês'           },
  { value: 'last-month', label: 'Último mês fechado' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function fmtStartHour(h: number) { return `${String(h).padStart(2, '0')}:00:00` }
function fmtEndHour(h: number)   { return `${String(h).padStart(2, '0')}:59:59` }
function clampHour(v: string | null, fallback: number): number {
  const n = parseInt(v ?? '')
  return isNaN(n) || n < 0 || n > 23 ? fallback : n
}

export type DateType    = 'all' | 'checkin' | 'checkout'
export type RentalStatus = 'FINALIZADA' | 'TRANSFERIDA' | 'CANCELADA' | 'ABERTA' | 'TODAS'

const DATE_TYPE_OPTIONS: { value: DateType; label: string }[] = [
  { value: 'checkin',  label: 'Entrada' },
  { value: 'checkout', label: 'Saída'   },
  { value: 'all',      label: 'Todas'   },
]

const STATUS_OPTIONS: { value: RentalStatus; label: string }[] = [
  { value: 'FINALIZADA',  label: 'Finalizadas'  },
  { value: 'TRANSFERIDA', label: 'Transferidas' },
  { value: 'CANCELADA',   label: 'Canceladas'   },
  { value: 'ABERTA',      label: 'Em aberto'    },
  { value: 'TODAS',       label: 'Todas'        },
]

// ─── Componente ───────────────────────────────────────────────────────────────

export function DateRangePicker() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  const preset   = (searchParams.get('preset') ?? 'this-month') as DatePreset
  const urlStart = searchParams.get('start') ?? ''
  const urlEnd   = searchParams.get('end')   ?? ''

  const initial = resolvePreset(preset, urlStart || null, urlEnd || null)

  const [localStart,     setLocalStart]     = useState(initial.startDate)
  const [localEnd,       setLocalEnd]       = useState(initial.endDate)
  const [localStartHour, setLocalStartHour] = useState(() => clampHour(searchParams.get('startHour'), 6))
  const [localEndHour,   setLocalEndHour]   = useState(() => clampHour(searchParams.get('endHour'),   5))
  const [localDateType,  setLocalDateType]  = useState<DateType>(
    () => (searchParams.get('dateType') as DateType) ?? 'checkin'
  )
  const [localStatus, setLocalStatus] = useState<RentalStatus>(
    () => (searchParams.get('status') as RentalStatus) ?? 'FINALIZADA'
  )

  useEffect(() => {
    const p = (searchParams.get('preset') ?? 'this-month') as DatePreset
    const s = searchParams.get('start') ?? ''
    const e = searchParams.get('end')   ?? ''
    const r = resolvePreset(p, s || null, e || null)
    setLocalStart(r.startDate)
    setLocalEnd(r.endDate)
    setLocalStartHour(clampHour(searchParams.get('startHour'), 6))
    setLocalEndHour(clampHour(searchParams.get('endHour'),     5))
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

  const today        = new Date().toISOString().slice(0, 10)
  const displayPreset = PRESETS.find((p) => p.value === preset)?.value ?? 'this-month'

  return (
    <div className="flex items-end gap-3 flex-wrap">

      {/* Período */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Período</Label>
        <div className="flex items-center gap-2">
          <CalendarIcon className="size-3.5 text-muted-foreground shrink-0" />
          <Select value={displayPreset} onValueChange={handlePresetChange}>
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={localStart}
            max={localEnd || today}
            onChange={(e) => setLocalStart(e.target.value)}
            className="h-7 w-[130px] text-xs px-2"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={localEnd}
            min={localStart}
            max={today}
            onChange={(e) => setLocalEnd(e.target.value)}
            className="h-7 w-[130px] text-xs px-2"
          />
        </div>
      </div>

      <Separator orientation="vertical" className="h-8 hidden sm:block" />

      {/* Horas */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Horário</Label>
        <div className="flex items-center gap-2">
          <Select
            value={String(localStartHour)}
            onValueChange={(v) => setLocalStartHour(Number(v))}
          >
            <SelectTrigger size="sm" className="w-[108px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>{fmtStartHour(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">→</span>
          <Select
            value={String(localEndHour)}
            onValueChange={(v) => setLocalEndHour(Number(v))}
          >
            <SelectTrigger size="sm" className="w-[108px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>{fmtEndHour(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator orientation="vertical" className="h-8 hidden sm:block" />

      {/* Data tipo + Status */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Filtros</Label>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={localDateType}
            onValueChange={(v) => v && setLocalDateType(v as DateType)}
            variant="outline"
            size="sm"
          >
            {DATE_TYPE_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Select value={localStatus} onValueChange={(v) => setLocalStatus(v as RentalStatus)}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        size="sm"
        onClick={handleApply}
        disabled={!localStart || !localEnd}
        className="self-end"
      >
        Aplicar
      </Button>
    </div>
  )
}
