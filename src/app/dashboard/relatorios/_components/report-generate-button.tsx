'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarDays, Loader2 } from 'lucide-react'
import { format, subWeeks, startOfWeek, endOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { DateRange } from 'react-day-picker'

interface Props {
  unitSlug: string
  onGenerated: (id: string) => void
}

export function ReportGenerateButton({ unitSlug, onGenerated }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const lastMonday = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 })
    const lastSunday = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 })
    return { from: lastMonday, to: lastSunday }
  })

  async function generate() {
    if (!range?.from || !range?.to) return
    setLoading(true)
    setOpen(false)
    try {
      const res = await fetch('/api/agente/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitSlug,
          dateFrom: format(range.from, 'yyyy-MM-dd'),
          dateTo: format(range.to, 'yyyy-MM-dd'),
        }),
      })
      const data = await res.json()
      if (data.id) onGenerated(data.id)
    } finally {
      setLoading(false)
    }
  }

  async function generateLastNWeeks(n: number) {
    setLoading(true)
    const results: string[] = []
    for (let i = n; i >= 1; i--) {
      const monday = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const sunday = endOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      // Escalonar 2s por posição — mais recente (i=1) tem delay 0 e aparece primeiro na sidebar
      const delayMs = (i - 1) * 2000
      try {
        const res = await fetch('/api/agente/reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unitSlug,
            dateFrom: format(monday, 'yyyy-MM-dd'),
            dateTo: format(sunday, 'yyyy-MM-dd'),
            delayMs,
          }),
        })
        const data = await res.json()
        if (data.id) results.push(data.id)
      } catch { /* continue */ }
    }
    setLoading(false)
    if (results.length > 0) onGenerated(results[0])
  }

  const label = range?.from && range?.to
    ? `${format(range.from, 'dd/MM')} → ${format(range.to, 'dd/MM')}`
    : 'Selecionar período'

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-sm" disabled={loading}>
            <CalendarDays className="w-4 h-4 mr-2 shrink-0" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={range}
            onSelect={setRange}
            numberOfMonths={2}
            locale={ptBR}
            weekStartsOn={1}
          />
          <div className="p-2 border-t">
            <Button className="w-full" size="sm" onClick={generate} disabled={!range?.from || !range?.to || loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Gerar relatório
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground"
        disabled={loading}
        onClick={() => generateLastNWeeks(4)}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
        Gerar histórico (4 semanas)
      </Button>
    </div>
  )
}
