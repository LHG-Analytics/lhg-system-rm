import { NextRequest, NextResponse } from 'next/server'

// Rota de diagnóstico — mostra resposta bruta de Ticketmaster e Sympla
// GET /api/debug/events?city=Campinas
export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get('city') ?? 'Campinas'

  const tmKey    = process.env.TICKETMASTER_API_KEY
  const symToken = process.env.SYMPLA_TOKEN

  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 14)
  const startIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const endIso   = end.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const startDate = now.toISOString().slice(0, 10)
  const endDate   = end.toISOString().slice(0, 10)

  const results: Record<string, unknown> = {
    city,
    ticketmaster_key_set: !!tmKey,
    sympla_token_set: !!symToken,
  }

  // ── Ticketmaster ─────────────────────────────────────────────────────────
  if (tmKey) {
    try {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${tmKey}&city=${encodeURIComponent(city)}&startDateTime=${startIso}&endDateTime=${endIso}&size=5&sort=date,asc&countryCode=BR`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      results.ticketmaster = {
        status: res.status,
        totalElements: body?.page?.totalElements ?? 0,
        events: (body?._embedded?.events ?? []).map((e: { name: string; dates: { start: { localDate: string } }; _embedded?: { venues?: Array<{ city?: { name: string } }> } }) => ({
          name: e.name,
          date: e.dates?.start?.localDate,
          city: e._embedded?.venues?.[0]?.city?.name,
        })),
        raw_page: body?.page,
        error: body?.errors ?? null,
      }
    } catch (e) {
      results.ticketmaster = { error: String(e) }
    }
  } else {
    results.ticketmaster = { error: 'TICKETMASTER_API_KEY não configurada' }
  }

  // ── Sympla ────────────────────────────────────────────────────────────────
  if (symToken) {
    try {
      const url = `https://api.sympla.com.br/public/v3/events?start_date=${startDate}&end_date=${endDate}&page=1&page_size=5`
      const res = await fetch(url, {
        headers: { 's_token': symToken },
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json()
      const events = body?.data ?? []
      const cityLower = city.toLowerCase()
      const filtered = events.filter((e: { address?: { city?: string } }) =>
        e.address?.city?.toLowerCase().includes(cityLower) || !e.address?.city
      )
      results.sympla = {
        status: res.status,
        total_returned: events.length,
        total_after_city_filter: filtered.length,
        sample_cities: events.slice(0, 5).map((e: { name: string; address?: { city?: string } }) => ({
          name: e.name,
          city: e.address?.city,
        })),
        filtered_events: filtered.slice(0, 3).map((e: { name: string; address?: { city?: string; name?: string } }) => ({
          name: e.name,
          city: e.address?.city,
        })),
        error: body?.message ?? null,
      }
    } catch (e) {
      results.sympla = { error: String(e) }
    }
  } else {
    results.sympla = { error: 'SYMPLA_TOKEN não configurada' }
  }

  return NextResponse.json(results, { status: 200 })
}
