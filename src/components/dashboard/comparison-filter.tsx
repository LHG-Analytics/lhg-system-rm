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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
    : 'Personalizado'

  const today = new Date()

  return (
    <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-3">
      {/* Período */}
      <div className="flex flex-col gap-1.5">
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
                className={cn('h-7 px-2.5 text-xs gap-1.5', !isCustom && 'text-muted-foreground')}
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
                numberOfMonths={2}
                disabled={(date) => date > today || date < new Date('2020-01-01')}
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Horário + Filtros + Buscar */}
      <div className="flex items-end gap-2 flex-wrap">
        {/* Horário */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Horário</Label>
          <div className="flex items-center gap-1">
            <Select
              value={String(filters.startHour)}
              onValueChange={(v) => update({ startHour: Number(v) })}
            >
              <SelectTrigger size="sm" className="w-[76px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>{fmtH(h, 'start')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">→</span>
            <Select
              value={String(filters.endHour)}
              onValueChange={(v) => update({ endHour: Number(v) })}
            >
              <SelectTrigger size="sm" className="w-[76px]">
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

        {/* Tipo de data */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Data</Label>
          <ToggleGroup
            type="single"
            value={filters.dateType}
            onValueChange={(v) => { if (v) update({ dateType: v as CompDateType }) }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="checkin"  className="text-xs px-2">Entrada</ToggleGroupItem>
            <ToggleGroupItem value="checkout" className="text-xs px-2">Saída</ToggleGroupItem>
            <ToggleGroupItem value="all"      className="text-xs px-2">Todas</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</Label>
          <Select
            value={filters.status}
            onValueChange={(v) => update({ status: v as CompRentalStatus })}
          >
            <SelectTrigger size="sm" className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FINALIZADA">Finalizadas</SelectItem>
              <SelectItem value="TRANSFERIDA">Transferidas</SelectItem>
              <SelectItem value="CANCELADA">Canceladas</SelectItem>
              <SelectItem value="ABERTA">Em aberto</SelectItem>
              <SelectItem value="TODAS">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          onClick={() => onSearch(filters)}
          disabled={loading}
          className="h-8 gap-1.5 self-end"
        >
          <Search className="size-3.5" />
          Buscar
        </Button>
      </div>
    </div>
  )
}
