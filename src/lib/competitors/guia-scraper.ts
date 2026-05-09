// Core Guia de Motéis scraping — shared between competitor-analysis route and report generator

export interface GMapPrice {
  categoria_concorrente: string
  categoria_nossa: string | null
  periodo: string
  preco: number
  dia_tipo?: string
}

export interface GuiaScrapeResult {
  prices: GMapPrice[]
  amenitiesBySuite: Record<string, string[]>
}

type GuiaPeriodo = { tempo: string; valor: number; descricao: string; dataExibicao: string }
type GuiaResponse = { periodos?: GuiaPeriodo[]; pernoites?: GuiaPeriodo[] }

const UA = 'Mozilla/5.0 (compatible; LHG-RM/1.0; +https://lhg.com.br)'

function getTodayGuiaStr(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

function tempoToPeriod(tempo: string): string {
  const h = parseInt(tempo)
  return isNaN(h) ? tempo : `${h}h`
}

function parseDayOfWeek(dateStr: string): number {
  const m = dateStr.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getDay()
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])).getDay()
  return -1
}

function isFds(dateStr: string): boolean {
  const d = parseDayOfWeek(dateStr)
  return d === 5 || d === 6
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function nameFromSlug(url: string): string {
  const slug = url.split('/').filter(Boolean).pop() ?? ''
  if (!/^suites?-/i.test(slug)) return slug
  return 'Suíte ' + slug.replace(/^suites?-/i, '').split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function parseSuiteHtml(html: string, suiteName: string) {
  const suiteId = (html.match(/var\s+suiteid\s*=\s*(\d+)/i) ?? html.match(/data-suite="(\d+)"/))?.[1] ?? null
  const amenIdx = html.search(/[Ee]ssa\s+su[ií]te\s+tem|[Aa]\s+su[ií]te\s+possui/i)
  let amenities: string[] = []
  if (amenIdx >= 0) {
    const pMatch = html.slice(amenIdx).match(/<p[^>]*>([^<]{5,600})<\/p>/i)
    if (pMatch) {
      amenities = pMatch[1].split(',').map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a.length > 2)
    }
  }
  return { suiteId, suiteName, amenities }
}

async function fetchGuiaPrices(suiteId: string): Promise<GuiaResponse | null> {
  try {
    const r = await fetch(
      `https://guiasites.guiademoteis.com.br/api/suites/Periodos/${suiteId}?data=${getTodayGuiaStr()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    return r.ok ? (await r.json() as GuiaResponse) : null
  } catch { return null }
}

function buildPrices(suiteNameStr: string, data: GuiaResponse): GMapPrice[] {
  const out: GMapPrice[] = []
  const wdPeriod: Record<string, number[]> = {}
  const wePeriod: Record<string, number[]> = {}
  data.periodos?.forEach((p) => {
    const key = tempoToPeriod(p.tempo)
    const bucket = isFds(p.dataExibicao) ? wePeriod : wdPeriod
    if (!bucket[key]) bucket[key] = []
    bucket[key].push(p.valor)
  })
  const wdPern: number[] = []
  const wePern: number[] = []
  data.pernoites?.forEach((p) => {
    if (isFds(p.dataExibicao)) wePern.push(p.valor)
    else wdPern.push(p.valor)
  })
  const push = (periodo: string, wd: number | null, we: number | null) => {
    if (wd !== null && we !== null && Math.abs(wd - we) > 1) {
      out.push({ categoria_concorrente: suiteNameStr, categoria_nossa: null, periodo, preco: wd, dia_tipo: 'semana' })
      out.push({ categoria_concorrente: suiteNameStr, categoria_nossa: null, periodo, preco: we, dia_tipo: 'fds_feriado' })
    } else {
      const preco = wd ?? we
      if (preco !== null) out.push({ categoria_concorrente: suiteNameStr, categoria_nossa: null, periodo, preco, dia_tipo: 'todos' })
    }
  }
  const allPeriods = new Set([...Object.keys(wdPeriod), ...Object.keys(wePeriod)])
  allPeriods.forEach((p) => push(p, median(wdPeriod[p] ?? []), median(wePeriod[p] ?? [])))
  push('pernoite', median(wdPern), median(wePern))
  return out
}

async function processSuiteUrl(suiteUrl: string): Promise<{ prices: GMapPrice[]; amenities: string[]; suiteName: string } | null> {
  try {
    const slugName = nameFromSlug(suiteUrl)
    const res = await fetch(suiteUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const html = await res.text()
    const { suiteId, suiteName, amenities } = parseSuiteHtml(html, slugName)
    if (!suiteId) return null
    const data = await fetchGuiaPrices(suiteId)
    if (!data) return null
    const prices = buildPrices(suiteName, data)
    return { prices, amenities, suiteName }
  } catch { return null }
}

export async function scrapeGuiaUrl(competitorUrl: string): Promise<GuiaScrapeResult> {
  const urlObj = new URL(competitorUrl)
  const isSuitePage = /suites?-/i.test(urlObj.pathname)

  let allPrices: GMapPrice[] = []
  const allAmenities: Record<string, string[]> = {}

  if (isSuitePage) {
    const result = await processSuiteUrl(competitorUrl)
    if (result) {
      allPrices = result.prices
      if (result.amenities.length) allAmenities[result.suiteName] = result.amenities
    }
  } else {
    let mainHtml = ''
    try {
      const mainRes = await fetch(competitorUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!mainRes.ok) return { prices: [], amenitiesBySuite: {} }
      mainHtml = await mainRes.text()
    } catch { return { prices: [], amenitiesBySuite: {} } }

    const suiteUrls = new Set<string>()
    for (const [, href] of mainHtml.matchAll(/href=["']([^"']*suites?-[a-z0-9-]+[^"']*)["']/gi)) {
      try { suiteUrls.add(new URL(href, competitorUrl).href) } catch { /* href inválido */ }
    }
    if (!suiteUrls.size) return { prices: [], amenitiesBySuite: {} }

    const CHUNK = 5
    const suiteUrlList = [...suiteUrls]
    for (let i = 0; i < suiteUrlList.length; i += CHUNK) {
      const chunk = suiteUrlList.slice(i, i + CHUNK)
      const results = await Promise.all(chunk.map((url) => processSuiteUrl(url)))
      results.forEach((r) => {
        if (!r) return
        allPrices.push(...r.prices)
        if (r.amenities.length) allAmenities[r.suiteName] = r.amenities
      })
    }
  }

  return { prices: allPrices, amenitiesBySuite: allAmenities }
}
