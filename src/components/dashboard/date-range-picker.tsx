'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { CalendarIcon } from 'lucide-react'
import { format, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { DateRange } from 'react-day-picker'
import type { DatePreset } from '@/lib/date-range'
import { resolvePreset } from '@/lib/date-range'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─── Dados estáticos ──────────────────────────────────────────────────────────

const PRESETS: { value: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { value: '7d',         label: 'Últ. 7 dias'       },
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

function parseIso(s: string): Date | undefined {
  if (!s) return undefined
  try { return parse(s, 'yyyy-MM-dd', new Date()) } catch { return undefined }
}

export type DateType     = 'all' | 'checkin' | 'checkout'
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
  const [calendarOpen, setCalendarOpen] = useState(false)

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

  // Preset fixo clicado → navega imediatamente
  function handlePresetClick(value: Exclude<DatePreset, 'custom'>) {
    const resolved = resolvePreset(value)
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

  // Range personalizado selecionado → navega ao completar
  function handleRangeSelect(range: DateRange | undefined) {
    const from = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
    const to   = range?.to   ? format(range.to,   'yyyy-MM-dd') : ''
    setLocalStart(from)
    setLocalEnd(to)
    if (from && to) {
      setCalendarOpen(false)
      navigate({
        preset:    'custom',
        start:     from,
        end:       to,
        startHour: String(localStartHour),
        endHour:   String(localEndHour),
        dateType:  localDateType,
        status:    localStatus,
      })
    }
  }

  // Aplicar horário + filtros mantendo o preset atual
  function handleApply() {
    if (!localStart || !localEnd) return
    navigate({
      preset:    preset,
      start:     localStart,
      end:       localEnd,
      startHour: String(localStartHour),
      endHour:   String(localEndHour),
      dateType:  localDateType,
      status:    localStatus,
    })
  }

  const isCustom = preset === 'custom'

  const customLabel = isCustom && localStart && localEnd
    ? `${format(parse(localStart, 'yyyy-MM-dd', new Date()), 'dd/MM')} → ${format(parse(localEnd, 'yyyy-MM-dd', new Date()), 'dd/MM')}`
    : 'Personalizado'

  const today = new Date()

  return (
    <div className="flex items-end gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">

      {/* Período — presets fixos + personalizado */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Período</Label>
        <div className="flex items-center gap-1">
          {/* Botões de preset fixo */}
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={preset === p.value ? 'default' : 'outline'}
              onClick={() => handlePresetClick(p.value)}
              className="h-7 px-3 text-xs"
            >
              {p.label}
            </Button>
          ))}

          {/* Separador visual */}
          <div className="w-px h-5 bg-border mx-1 shrink-0" />

          {/* Personalizado — abre calendar em popover */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant={isCustom ? 'default' : 'outline'}
                className={cn(
                  'h-7 px-2.5 text-xs gap-1.5',
                  !isCustom && 'text-muted-foreground hover:text-foreground',
                )}
              >
                <CalendarIcon className="size-3 shrink-0" />
                {customLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={parseIso(localStart)}
                selected={{ from: parseIso(localStart), to: parseIso(localEnd) }}
                onSelect={handleRangeSelect}
                numberOfMonths={2}
                disabled={(date) => date > today || date < new Date('2020-01-01')}
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Separator orientation="vertical" className="h-8 shrink-0" />

      {/* Horário */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Horário</Label>
        <div className="flex items-center gap-2">
          <Select value={String(localStartHour)} onValueChange={(v) => setLocalStartHour(Number(v))}>
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
          <Select value={String(localEndHour)} onValueChange={(v) => setLocalEndHour(Number(v))}>
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

      <Separator orientation="vertical" className="h-8 shrink-0" />

      {/* Filtros */}
      <div className="flex flex-col gap-1.5 shrink-0">
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
        className="self-end shrink-0"
      >
        Aplicar
      </Button>
    </div>
  )
}
