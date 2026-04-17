// Módulo de contexto de eventos locais via Apify (Sympla scraping)
// Eventos são cacheados em rm_agent_config.events_cache (TTL 4h)
// Filtro de relevância: apenas eventos que influenciam demanda por hospedagem

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface EventItem {
  name: string
  date: string        // YYYY-MM-DD
  time?: string       // HH:MM
  venue?: string
  category?: string
  url: string
  source: 'apify'
}

export type EventsResult =
  | { status: 'ok';           events: EventItem[] }
  | { status: 'empty';        source: string }
  | { status: 'error';        message: string }
  | { status: 'unconfigured' }

// ─── Cache (rm_agent_config.events_cache) ────────────────────────────────────

const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 horas

interface CacheEntry {
  updated_at: string
  result: EventsResult
}

async function getEventsCache(unitId: string): Promise<{ result: EventsResult | null; isStale: boolean }> {
  try {
    const { data } = await getAdminClient()
      .from('rm_agent_config')
      .select('events_cache')
      .eq('unit_id', unitId)
      .single()

    if (!data?.events_cache) return { result: null, isStale: true }

    const entry = data.events_cache as unknown as CacheEntry
    const age = Date.now() - new Date(entry.updated_at).getTime()
    return { result: entry.result, isStale: age > CACHE_TTL_MS }
  } catch {
    return { result: null, isStale: true }
  }
}

export async function setEventsCache(unitId: string, result: EventsResult): Promise<void> {
  try {
    const entry: CacheEntry = { updated_at: new Date().toISOString(), result }
    await getAdminClient()
      .from('rm_agent_config')
      .update({ events_cache: entry as unknown as Record<string, unknown> })
      .eq('unit_id', unitId)
  } catch {
    // Ignora erros de cache
  }
}

// ─── Apify scraping ───────────────────────────────────────────────────────────

/** Busca eventos via Apify (Sympla scraping) + filtra com AI por relevância hoteleira. */
export async function fetchEventsFromApify(city: string): Promise<EventsResult> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) return { status: 'unconfigured' }

  const searchUrl = `https://www.sympla.com.br/pesquisar?d=${encodeURIComponent(city)}&online=false`

  try {
    // 1. Inicia o run sem waitSecs — retorna imediatamente (status READY ou RUNNING)
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${token}&memory=1024`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: searchUrl }],
          maxCrawlPages: 1,
          crawlerType: 'playwright:chrome',
        }),
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!runRes.ok) return { status: 'error', message: `Apify HTTP ${runRes.status}` }

    const run = await runRes.json() as { data?: { id: string; status: string; defaultDatasetId: string } }
    const runId = run.data?.id
    if (!runId) return { status: 'error', message: 'Apify: runId ausente' }

    // 2. Polling — 10 × 5s = 50s (dentro do limit de 60s da Vercel Hobby)
    let status = run.data?.status ?? 'READY'
    let datasetId = run.data?.defaultDatasetId ?? ''

    for (let i = 0; i < 10 && status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED'; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const poll = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`,
        { signal: AbortSignal.timeout(4000) }
      ).catch(() => null)
      if (poll?.ok) {
        const d = await poll.json() as { data?: { status: string; defaultDatasetId: string } }
        status = d.data?.status ?? status
        datasetId = d.data?.defaultDatasetId ?? datasetId
      }
    }

    if (status !== 'SUCCEEDED') return { status: 'error', message: `Apify: run ${status}` }

    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!dataRes.ok) return { status: 'error', message: `Apify dataset HTTP ${dataRes.status}` }

    const items = await dataRes.json() as Array<{ markdown?: string; text?: string }>
    const pageContent = items[0]?.markdown ?? items[0]?.text ?? ''

    if (!pageContent || pageContent.length < 200) {
      return { status: 'empty', source: 'Sympla' }
    }

    return await parseEventsWithAI(city, pageContent)
  } catch (e) {
    return { status: 'error', message: `Apify: ${e instanceof Error ? e.message : 'erro desconhecido'}` }
  }
}

async function parseEventsWithAI(city: string, pageContent: string): Promise<EventsResult> {
  try {
    const { generateText } = await import('ai')
    const { ANALYSIS_MODEL } = await import('@/lib/agente/model')

    const today = new Date().toISOString().slice(0, 10)
    const in14d = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      maxOutputTokens: 2000,
      prompt: `Extraia eventos desta página do Sympla em ${city} entre ${today} e ${in14d}.

CRITÉRIO DE RELEVÂNCIA — inclua APENAS eventos que tendam a gerar demanda por hospedagem:
✅ Shows, concertos e festivais de música
✅ Eventos esportivos (jogos, corridas, campeonatos)
✅ Feiras, exposições e convenções de grande porte
✅ Festas e baladas grandes
✅ Eventos culturais com público esperado > 500 pessoas

❌ Excluir: cursos, workshops, palestras, reuniões, eventos corporativos pequenos, aulas, meetups.

Retorne APENAS JSON válido, sem markdown, neste formato:
{"events":[{"name":"...","date":"YYYY-MM-DD","time":"HH:MM","venue":"...","category":"...","url":"..."}]}

Conteúdo da página:
${pageContent.slice(0, 8000)}`,
    })

    const parsed = JSON.parse(text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')) as {
      events: Array<{ name: string; date: string; time?: string; venue?: string; category?: string; url?: string }>
    }

    const events: EventItem[] = (parsed.events ?? [])
      .filter(e => e.date >= today && e.date <= in14d)
      .map(e => ({
        name: e.name,
        date: e.date,
        time: e.time,
        venue: e.venue,
        category: e.category,
        url: e.url ?? 'https://sympla.com.br',
        source: 'apify' as const,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))

    if (events.length === 0) return { status: 'empty', source: 'Sympla' }
    return { status: 'ok', events }
  } catch (e) {
    return { status: 'error', message: `Parse AI: ${e instanceof Error ? e.message : 'erro'}` }
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna eventos do cache. Se stale, dispara refresh com `after()` em background
 * (resposta não é bloqueada). Requer unitId para lookup de cache.
 */
export async function fetchEventsResult(cityField: string, unitId?: string): Promise<EventsResult> {
  if (!unitId || !process.env.APIFY_API_TOKEN) return { status: 'unconfigured' }

  const city = cityField.split(',')[0].trim()
  const { result, isStale } = await getEventsCache(unitId)

  // Refresh em background após resposta — não bloqueia a página
  if (isStale) {
    after(async () => {
      const fresh = await fetchEventsFromApify(city)
      await setEventsCache(unitId, fresh)
    })
  }

  return result ?? { status: 'unconfigured' }
}

/**
 * Retorna bloco de texto para o system prompt do agente RM.
 * Lê do cache — não faz chamada externa.
 */
export async function fetchEventsContext(cityField: string, unitId?: string): Promise<string | null> {
  if (!unitId) return null

  const { result } = await getEventsCache(unitId)
  if (!result || result.status !== 'ok') return null

  const city = cityField.split(',')[0].trim()
  const lines = result.events.map((e) => {
    const time = e.time ? ` às ${e.time}` : ''
    const venue = e.venue ? ` @ ${e.venue}` : ''
    const cat = e.category ? ` (${e.category})` : ''
    return `- **${e.name}** — ${e.date}${time}${venue}${cat}`
  })

  return `## Eventos relevantes próximos — ${city} (próximos 14 dias)
${lines.join('\n')}

> Eventos de grande porte tendem a elevar demanda por pernoite e períodos longos. Considere precificação dinâmica nessas datas.`
}

/** Refresh forçado — usado pelo cron e pelo endpoint de refresh manual. */
export async function refreshEventsForUnit(unitId: string, city: string): Promise<EventsResult> {
  const result = await fetchEventsFromApify(city)
  await setEventsCache(unitId, result)
  return result
}
