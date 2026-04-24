'use client'

import { useState } from 'react'
import { CalendarIcon, Search } from 'lucide-react'
import { format, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { DateRange as DayPickerRange } from 'react-day-picker'
import { resolvePreset } from '@/lib/date-range'
import type { DatePreset } from '@/lib/date-range'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CompDateType     = 'all' | 'checkin' | 'checkout'
export type CompRentalStatus = 'FINALIZADA' | 'TRANSFERIDA' | 'CANCELADA' | 'ABERTA' | 'TODAS'

export interface ComparisonFilters {
  preset:    DatePreset
  startDate: string            // YYYY-MM-DD
  endDate:   string            // YYYY-MM-DD
  startHour: number
  endHour:   number
  dateType:  CompDateType
  status:    CompRentalStatus
}

interface Props {
  initial:  ComparisonFilters
  onSearch: (filters: ComparisonFilters) => void
  loading?: boolean
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

const PRESETS: { value: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { value: '7d',         label: '7 dias'   },
  { value: 'this-month', label: 'Este mês' },
  { value: 'last-month', label: 'Mês ant.' },
]

const DATE_TYPE_OPTIONS: { value: CompDateType; label: string }[] = [
  { value: 'checkin',  label: 'Entrada' },
  { value: 'checkout', label: 'Saída'   },
  { value: 'all',      label: 'Todas'   },
]

const STATUS_OPTIONS: { value: CompRentalStatus; label: string }[] = [
  { value: 'FINALIZADA',  label: 'Finalizadas'  },
  { value: 'TRANSFERIDA', label: 'Transferidas' },
  { value: 'CANCELADA',   label: 'Canceladas'   },
  { value: 'ABERTA',      label: 'Em aberto'    },
  { value: 'TODAS',       label: 'Todas'        },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function fmtH(h: number, type: 'start' | 'end') {
  return type === 'start'
    ? `${String(h).padStart(2, '0')}:00`
    : `${String(h).padStart(2, '0')}:59`
}

function parseIso(s: string): Date | undefined {
  if (!s) return undefined
  try { return parse(s, 'yyyy-MM-dd', new Date()) } catch { return undefined }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ComparisonFilter({ initial, onSearch, loading }: Props) {
  const [filters, setFilters] = useState<ComparisonFilters>(initial)
  const [calOpen, setCalOpen] = useState(false)

  function update(patch: Partial<ComparisonFilters>) {
    setFilters(prev => ({ ...prev, ...patch }))
  }

  function handlePreset(value: Exclude<DatePreset, 'custom'>) {
    const r = resolvePreset(value)
    update({ preset: value, startDate: r.startDate, endDate: r.endDate })
  }

  function handleRange(range: DayPickerRange | undefined) {
    const from = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
    const to   = range?.to   ? format(range.to,   'yyyy-MM-dd') : ''
    if (from) update({ startDate: from, endDate: to || from, preset: 'custom' })
    if (from && to) setCalOpen(false)
  }

  const isCustom    = filters.preset === 'custom'
  const customLabel = isCustom && filters.startDate && filters.endDate
    ? `${format(parse(filters.startDate, 'yyyy-MM-dd', new Date()), 'dd/MM')} → ${format(parse(filters.endDate, 'yyyy-MM-dd', new Date()), 'dd/MM')}`
    : 'Custom'

  const today = new Date()

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">

      {/* ── Linha 1: Período ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Período</Label>
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={filters.preset === p.value ? 'default' : 'outline'}
              onClick={() => handlePreset(p.value)}
              className="h-7 px-2.5 text-xs"
            >
              {p.label}
            </Button>
          ))}
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant={isCustom ? 'default' : 'outline'}
                className={cn('h-7 px-2.5 text-xs gap-1', !isCustom && 'text-muted-foreground')}
              >
                <CalendarIcon className="size-3 shrink-0" />
                {customLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={parseIso(filters.startDate)}
                selected={{ from: parseIso(filters.startDate), to: parseIso(filters.endDate) }}
                onSelect={handleRange}
                numberOfMonths={1}
                disabled={(date) => date > today || date < new Date('2020-01-01')}
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* ── Linha 2: Grade de filtros ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">

        {/* Horário */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Horário</Label>
          <div className="flex items-center gap-1">
            <Select
              value={String(filters.startHour)}
              onValueChange={(v) => update({ startHour: Number(v) })}
            >
              <SelectTrigger size="sm" className="flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>{fmtH(h, 'start')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground shrink-0">→</span>
            <Select
              value={String(filters.endHour)}
              onValueChange={(v) => update({ endHour: Number(v) })}
            >
              <SelectTrigger size="sm" className="flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>{fmtH(h, 'end')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</Label>
          <Select
            value={filters.status}
            onValueChange={(v) => update({ status: v as CompRentalStatus })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tipo de data */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Data</Label>
          <div className="flex gap-1">
            {DATE_TYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => update({ dateType: o.value })}
                className={cn(
                  'flex-1 h-8 rounded-md border text-xs font-medium transition-colors',
                  filters.dateType === o.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:text-foreground hover:bg-muted/50',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Botão Buscar */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-transparent select-none">-</Label>
          <Button
            size="sm"
            onClick={() => onSearch(filters)}
            disabled={loading}
            className="w-full h-8 gap-1.5"
          >
            <Search className="size-3.5" />
            Buscar
          </Button>
        </div>

      </div>
    </div>
  )
}
