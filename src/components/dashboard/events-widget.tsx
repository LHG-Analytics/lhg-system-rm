import { AlertTriangle, Calendar, Clock, MapPin, WifiOff, XCircle } from 'lucide-react'
import type { EventsResult, EventItem } from '@/lib/agente/events'

interface EventsWidgetProps {
  result: EventsResult
  city: string
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  return day === 0 || day === 5 || day === 6
}

function ptDayFmt(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${days[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function groupByDate(events: EventItem[]) {
  const map = new Map<string, EventItem[]>()
  for (const e of events) {
    if (!map.has(e.date)) map.set(e.date, [])
    map.get(e.date)!.push(e)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function WidgetShell({ city, badge, children }: { city: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold">Eventos próximos — {city}</h2>
          <span className="text-xs text-muted-foreground">(próximos 14 dias)</span>
        </div>
        {badge}
      </div>
      {children}
    </div>
  )
}

export function EventsWidget({ result, city }: EventsWidgetProps) {
  // Não configurado — oculta silenciosamente
  if (result.status === 'unconfigured') return null

  // Erro de API
  if (result.status === 'error') {
    return (
      <WidgetShell city={city}>
        <div className="px-5 py-4 flex items-start gap-3">
          <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Erro ao buscar eventos</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{result.message}</p>
          </div>
        </div>
      </WidgetShell>
    )
  }

  // Sem eventos
  if (result.status === 'empty') {
    return (
      <WidgetShell city={city}>
        <div className="px-5 py-4 flex items-center gap-3">
          <WifiOff className="size-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Nenhum evento encontrado nos próximos 14 dias via {result.source}.
          </p>
        </div>
      </WidgetShell>
    )
  }

  // Com eventos
  const grouped = groupByDate(result.events)
  const highImpactDates = grouped.filter(([date]) => isWeekend(date))

  return (
    <WidgetShell
      city={city}
      badge={highImpactDates.length > 0 ? (
        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3 shrink-0" />
          {highImpactDates.length} fim{highImpactDates.length > 1 ? 's' : ''} de semana com evento
        </div>
      ) : undefined}
    >
      <div className="divide-y">
        {grouped.map(([date, evs]) => {
          const weekend = isWeekend(date)
          return (
            <div key={date} className={weekend ? 'bg-amber-500/5' : undefined}>
              <div className="px-5 py-1.5 flex items-center gap-2">
                <span className={`text-xs font-semibold tabular-nums ${weekend ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {ptDayFmt(date)}
                </span>
                {weekend && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    FDS
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0 pb-2">
                {evs.map((e, i) => (
                  <a
                    key={i}
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-1.5 flex items-start gap-3 hover:bg-muted/40 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug group-hover:text-primary transition-colors truncate">
                        {e.name}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {e.time && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="size-3 shrink-0" />
                            {e.time}
                          </span>
                        )}
                        {e.venue && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate max-w-xs">
                            <MapPin className="size-3 shrink-0" />
                            {e.venue}
                          </span>
                        )}
                        {e.category && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {e.category}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-5 py-2.5 border-t bg-muted/20">
        <p className="text-[11px] text-muted-foreground">
          Eventos de grande porte em FDS tendem a elevar demanda por pernoite. Considere precificação dinâmica nessas datas.
        </p>
      </div>
    </WidgetShell>
  )
}
