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

const label = range?.from && range?.to
    ? `${format(range.from, 'dd/MM')} → ${format(range.to, 'dd/MM')}`
    : 'Selecionar período'

  return (
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
  )
}
