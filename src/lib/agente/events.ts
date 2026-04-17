// Módulo de contexto de eventos locais — Ticketmaster Discovery API (primário) / Sympla (secundário)

interface TMEvent {
  name: string
  dates: { start: { localDate: string; localTime?: string } }
  _embedded?: { venues?: Array<{ name: string; city?: { name: string } }> }
  url: string
  classifications?: Array<{ segment?: { name: string } }>
}

interface TMResponse {
  _embedded?: { events?: TMEvent[] }
  page?: { totalElements: number }
}

interface SymplaEvent {
  name: string
  start_date: string
  start_time: string
  address?: { city?: string; name?: string }
  url: string
  categories?: Array<{ name: string }>
}

interface SymplaResponse {
  data?: SymplaEvent[]
}

function extractCityName(cityField: string): string {
  // "Campinas,BR" → "Campinas"
  return cityField.split(',')[0].trim()
}

function ptDayFmt(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${days[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function fetchTicketmaster(city: string): Promise<string | null> {
  const key = process.env.TICKETMASTER_API_KEY
  if (!key) return null

  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 14)
  const startIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const endIso   = end.toISOString().replace(/\.\d{3}Z$/, 'Z')

  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&city=${encodeURIComponent(city)}&startDateTime=${startIso}&endDateTime=${endIso}&size=8&sort=date,asc&countryCode=BR`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json() as TMResponse

    const events = data._embedded?.events ?? []
    if (events.length === 0) return null

    const lines = events.map((e) => {
      const venue = e._embedded?.venues?.[0]?.name ?? ''
      const cat   = e.classifications?.[0]?.segment?.name ?? ''
      const date  = ptDayFmt(e.dates.start.localDate)
      const time  = e.dates.start.localTime ? ` às ${e.dates.start.localTime.slice(0, 5)}` : ''
      return `- **${e.name}** — ${date}${time}${venue ? ` @ ${venue}` : ''}${cat ? ` (${cat})` : ''}`
    })

    return `## Eventos próximos — ${city} (próximos 14 dias)\n${lines.join('\n')}\n\n> Eventos de grande porte próximos à unidade tendem a elevar a demanda por pernoite e períodos longos. Considere precificação dinâmica nessas datas.`
  } catch {
    return null
  }
}

async function fetchSympla(city: string): Promise<string | null> {
  const token = process.env.SYMPLA_TOKEN
  if (!token) return null

  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 14)
  const startDate = now.toISOString().slice(0, 10)
  const endDate   = end.toISOString().slice(0, 10)

  try {
    const url = `https://api.sympla.com.br/public/v3/events?start_date=${startDate}&end_date=${endDate}&page=1&page_size=8`
    const res = await fetch(url, {
      headers: { 's_token': token },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json() as SymplaResponse

    // Filtra por cidade (Sympla não tem filtro de cidade nativo no tier gratuito)
    const cityLower = city.toLowerCase()
    const events = (data.data ?? []).filter(
      (e) => e.address?.city?.toLowerCase().includes(cityLower) || !e.address?.city
    )
    if (events.length === 0) return null

    const lines = events.map((e) => {
      const date  = ptDayFmt(e.start_date)
      const time  = e.start_time ? ` às ${e.start_time.slice(0, 5)}` : ''
      const venue = e.address?.name ?? ''
      return `- **${e.name}** — ${date}${time}${venue ? ` @ ${venue}` : ''}`
    })

    return `## Eventos próximos — ${city} (próximos 14 dias)\n${lines.join('\n')}\n\n> Eventos de grande porte próximos à unidade tendem a elevar a demanda por pernoite e períodos longos. Considere precificação dinâmica nessas datas.`
  } catch {
    return null
  }
}

/** Busca eventos locais nos próximos 14 dias.
 *  Tenta Ticketmaster primeiro, depois Sympla. Retorna null se nenhuma key estiver configurada. */
export async function fetchEventsContext(cityField: string): Promise<string | null> {
  const city = extractCityName(cityField)

  const [tm, sympla] = await Promise.allSettled([
    fetchTicketmaster(city),
    fetchSympla(city),
  ])

  if (tm.status === 'fulfilled' && tm.value) return tm.value
  if (sympla.status === 'fulfilled' && sympla.value) return sympla.value
  return null
}

// ─── Tipos estruturados para UI ───────────────────────────────────────────────

export interface EventItem {
  name: string
  date: string       // YYYY-MM-DD
  time?: string      // HH:MM
  venue?: string
  category?: string
  url: string
  source: 'ticketmaster' | 'sympla'
}

// ─── Resultado estruturado para a UI ─────────────────────────────────────────

export type EventsResult =
  | { status: 'ok';           events: EventItem[] }
  | { status: 'empty';        source: string }
  | { status: 'error';        message: string }
  | { status: 'unconfigured' }

async function fetchTicketmasterStructured(city: string): Promise<EventsResult> {
  const key = process.env.TICKETMASTER_API_KEY
  if (!key) return { status: 'unconfigured' }

  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 14)
  const startIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const endIso   = end.toISOString().replace(/\.\d{3}Z$/, 'Z')

  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&city=${encodeURIComponent(city)}&startDateTime=${startIso}&endDateTime=${endIso}&size=10&sort=date,asc&countryCode=BR`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { status: 'error', message: `Ticketmaster: HTTP ${res.status} ${res.statusText}` }
    const data = await res.json() as TMResponse

    const events = data._embedded?.events ?? []
    if (events.length === 0) return { status: 'empty', source: 'Ticketmaster' }

    return {
      status: 'ok',
      events: events.map((e): EventItem => ({
        name:     e.name,
        date:     e.dates.start.localDate,
        time:     e.dates.start.localTime?.slice(0, 5),
        venue:    e._embedded?.venues?.[0]?.name,
        category: e.classifications?.[0]?.segment?.name,
        url:      e.url,
        source:   'ticketmaster',
      })),
    }
  } catch (e) {
    return { status: 'error', message: `Ticketmaster: ${e instanceof Error ? e.message : 'timeout ou erro de rede'}` }
  }
}

async function fetchSymplaStructured(city: string): Promise<EventsResult> {
  const token = process.env.SYMPLA_TOKEN
  if (!token) return { status: 'unconfigured' }

  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 14)
  const startDate = now.toISOString().slice(0, 10)
  const endDate   = end.toISOString().slice(0, 10)

  try {
    const url = `https://api.sympla.com.br/public/v3/events?start_date=${startDate}&end_date=${endDate}&page=1&page_size=10`
    const res = await fetch(url, {
      headers: { 's_token': token },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { status: 'error', message: `Sympla: HTTP ${res.status} ${res.statusText}` }
    const data = await res.json() as SymplaResponse

    const cityLower = city.toLowerCase()
    const events = (data.data ?? []).filter(
      (e) => e.address?.city?.toLowerCase().includes(cityLower) || !e.address?.city
    )
    if (events.length === 0) return { status: 'empty', source: 'Sympla' }

    return {
      status: 'ok',
      events: events.map((e): EventItem => ({
        name:     e.name,
        date:     e.start_date,
        time:     e.start_time?.slice(0, 5),
        venue:    e.address?.name,
        category: e.categories?.[0]?.name,
        url:      e.url,
        source:   'sympla',
      })),
    }
  } catch (e) {
    return { status: 'error', message: `Sympla: ${e instanceof Error ? e.message : 'timeout ou erro de rede'}` }
  }
}

/** Retorna resultado estruturado de eventos para a UI do dashboard.
 *  Tenta Ticketmaster primeiro, depois Sympla como fallback. */
export async function fetchEventsResult(cityField: string): Promise<EventsResult> {
  const city = extractCityName(cityField)

  const [tm, sympla] = await Promise.allSettled([
    fetchTicketmasterStructured(city),
    fetchSymplaStructured(city),
  ])

  const tmResult     = tm.status     === 'fulfilled' ? tm.value     : { status: 'error' as const, message: 'Ticketmaster: erro interno' }
  const symplaResult = sympla.status === 'fulfilled' ? sympla.value : { status: 'error' as const, message: 'Sympla: erro interno' }

  // Prioridade: resultado com eventos > empty > error > unconfigured
  if (tmResult.status === 'ok')     return tmResult
  if (symplaResult.status === 'ok') return symplaResult

  // Nenhum retornou eventos — propaga o estado mais informativo
  if (tmResult.status === 'error')     return tmResult
  if (symplaResult.status === 'error') return symplaResult
  if (tmResult.status === 'empty')     return tmResult
  if (symplaResult.status === 'empty') return symplaResult

  // Ambos unconfigured
  return { status: 'unconfigured' }
}

/** @deprecated Use fetchEventsResult. Mantido para compatibilidade com o agente RM. */
export async function fetchEventsStructured(cityField: string): Promise<EventItem[]> {
  const result = await fetchEventsResult(cityField)
  return result.status === 'ok' ? result.events : []
}
