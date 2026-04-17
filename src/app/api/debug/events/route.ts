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

  // ── Sympla: testa 3 variações para diagnosticar ──────────────────────────
  if (symToken) {
    const symplaTests: Record<string, unknown> = {}

    // Variação 1: sem filtro de data (confirma se a API retorna eventos do organizador)
    try {
      const url = `https://api.sympla.com.br/public/v3/events?page=1&page_size=5`
      const res = await fetch(url, { headers: { 's_token': symToken }, signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      symplaTests.sem_data = { status: res.status, total: (body?.data ?? []).length, raw: body }
    } catch (e) { symplaTests.sem_data = { error: String(e) } }

    // Variação 2: com start_date/end_date
    try {
      const url = `https://api.sympla.com.br/public/v3/events?start_date=${startDate}&end_date=${endDate}&page=1&page_size=5`
      const res = await fetch(url, { headers: { 's_token': symToken }, signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      symplaTests.com_data = { status: res.status, total: (body?.data ?? []).length, events: (body?.data ?? []).map((e: { name: string; address?: { city?: string } }) => ({ name: e.name, city: e.address?.city })) }
    } catch (e) { symplaTests.com_data = { error: String(e) } }

    // Variação 3: token como query param (formato original)
    try {
      const url = `https://api.sympla.com.br/public/v3/events?s_token=${symToken}&start_date=${startDate}&end_date=${endDate}&page=1&page_size=5`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const body = await res.json()
      symplaTests.token_query_param = { status: res.status, total: (body?.data ?? []).length }
    } catch (e) { symplaTests.token_query_param = { error: String(e) } }

    results.sympla = symplaTests
  } else {
    results.sympla = { error: 'SYMPLA_TOKEN não configurada' }
  }

  return NextResponse.json(results, { status: 200 })
}
