import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'

/**
 * HV4 (LHG-164): detecção de mudança de preço de concorrentes + price gap.
 *
 * 2 análises após cada novo snapshot:
 *   1. detectPriceChanges(snapshotId) — compara com snapshot anterior do
 *      mesmo concorrente, popula competitor_snapshots.price_changes
 *      e dispara notificação para mudanças >= 5%.
 *   2. computeAndPersistGaps(unitId) — cruza preços de concorrentes dos
 *      últimos 7 dias com nossa tabela ativa, persiste rm_competitor_price_gaps
 *      por (categoria, periodo, dia_tipo) com mediana/min/max e classificação
 *      underprice/aligned/overprice.
 */

interface CompetitorPriceRow {
  categoria_concorrente: string
  periodo:               string
  preco:                 number
  dia_tipo?:             string  // 'semana' | 'fds_feriado' | 'todos'
}

export interface DetectedChange {
  categoria_concorrente: string
  periodo:               string
  dia_tipo:              string
  preco_anterior:        number
  preco_novo:            number
  delta_pct:             number
}

export interface CompetitorGap {
  categoria_nossa:           string
  categoria_competitor:      string
  periodo:                   string
  dia_tipo:                  string
  preco_nosso:               number
  preco_concorrente_mediana: number
  preco_concorrente_min:     number
  preco_concorrente_max:     number
  gap_pct:                   number
  position:                  'underprice' | 'aligned' | 'overprice'
  competitor_name:           string
  /** Período real do concorrente quando aproximado (ex: "2h" para nosso "3h"). */
  competitor_periodo?:       string
  /** TRUE quando o período foi aproximado para casar com o nosso. */
  is_approximated?:          boolean
}

function getAdmin() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ─── Amenity matching helpers ─────────────────────────────────────────────────

/** Normaliza uma comodidade para forma canônica (lida com variações de escrita) */
function normalizeAmenity(a: string): string {
  const s = a.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/hidro|jacuzzi|whirlpool/.test(s))           return 'hidromassagem'
  if (/piscin/.test(s))                             return 'piscina'
  if (/banheira/.test(s))                           return 'banheira'
  if (/sauna/.test(s))                              return 'sauna'
  if (/ducha.roman|chuveiro.roman/.test(s))         return 'ducha_romantica'
  if (/varanda|deck|area.extern|terrac/.test(s))    return 'area_externa'
  if (/vista/.test(s))                              return 'vista'
  return s
}

// Amenidades genéricas demais para distinguir categorias
const GENERIC_AMENITIES = new Set([
  'tv', 'televisao', 'ar condicionado', 'ar-condicionado', 'wifi',
  'internet', 'frigobar', 'minibar', 'banheiro', 'chuveiro', 'cama',
])

function getDistinctiveAmenities(amenities: string[]): Set<string> {
  return new Set(
    amenities.map(normalizeAmenity).filter(a => a.length > 1 && !GENERIC_AMENITIES.has(a))
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter(x => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return union > 0 ? intersection / union : 0
}

export function parseAmenitiesBySuite(rawText: unknown): Record<string, string[]> {
  try {
    const parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText
    if (parsed && typeof parsed === 'object') {
      const abs = (parsed as Record<string, unknown>).amenitiesBySuite
      if (abs && typeof abs === 'object' && !Array.isArray(abs))
        return abs as Record<string, string[]>
    }
  } catch { /* ignore */ }
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────

// Normaliza períodos: "3 horas" → "3h", "3h" → "3h", "Pernoite" → "pernoite"
function normalizePeriod(p: string): string {
  const h = parseInt(p.trim())
  if (!isNaN(h) && h > 0) return `${h}h`
  const lower = p.toLowerCase().trim()
  if (lower.includes('pernoite')) return 'pernoite'
  if (lower.includes('day use') || lower.includes('dayuse')) return 'dayuse'
  if (lower.includes('diária') || lower.includes('diaria')) return 'diaria'
  return lower
}

/** Converte período normalizado "2h"/"3h" etc. em número de horas. Retorna null se não parseable */
function parseHoursFromPeriod(normPeriod: string): number | null {
  const m = normPeriod.match(/^(\d+(?:\.\d+)?)h$/)
  return m ? parseFloat(m[1]) : null
}

/** Faixa de horas aceita para match aproximado por nosso período normalizado */
function approxHoursRange(ourNorm: string): [number, number] | null {
  if (ourNorm === '3h')  return [1.5, 3.75]
  if (ourNorm === '6h')  return [3.75, 7.5]
  if (ourNorm === '12h') return [7.5, 16]
  return null
}

/**
 * Compara o snapshot recém-salvo com o anterior do mesmo concorrente
 * (mesma unit_id + competitor_name) e popula competitor_snapshots.price_changes.
 * Dispara notificação para mudanças >= 5%.
 */
export async function detectPriceChanges(
  snapshotId: string,
  notifyUserId: string | null = null,
): Promise<{ changes: DetectedChange[]; notified: number }> {
  const admin = getAdmin()

  const { data: current } = await admin
    .from('competitor_snapshots')
    .select('id, unit_id, competitor_name, mapped_prices, scraped_at, units(slug)')
    .eq('id', snapshotId)
    .single()

  if (!current) return { changes: [], notified: 0 }

  // Snapshot anterior do mesmo concorrente
  const { data: previous } = await admin
    .from('competitor_snapshots')
    .select('mapped_prices, scraped_at')
    .eq('unit_id', current.unit_id)
    .eq('competitor_name', current.competitor_name)
    .eq('status', 'done')
    .lt('scraped_at', current.scraped_at)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!previous) return { changes: [], notified: 0 }

  const currentPrices  = (current.mapped_prices as unknown as CompetitorPriceRow[]) ?? []
  const previousPrices = (previous.mapped_prices as unknown as CompetitorPriceRow[]) ?? []

  // Mapa por (categoria, periodo, dia_tipo)
  const prevMap = new Map(
    previousPrices.map((p) => [`${p.categoria_concorrente}|${p.periodo}|${p.dia_tipo ?? 'todos'}`, p.preco])
  )

  const changes: DetectedChange[] = []
  for (const cur of currentPrices) {
    const key  = `${cur.categoria_concorrente}|${cur.periodo}|${cur.dia_tipo ?? 'todos'}`
    const prev = prevMap.get(key)
    if (prev == null || prev === 0) continue
    const delta_pct = +(((cur.preco - prev) / prev) * 100).toFixed(1)
    if (Math.abs(delta_pct) < 0.5) continue
    changes.push({
      categoria_concorrente: cur.categoria_concorrente,
      periodo:               cur.periodo,
      dia_tipo:              cur.dia_tipo ?? 'todos',
      preco_anterior:        prev,
      preco_novo:            cur.preco,
      delta_pct,
    })
  }

  if (changes.length) {
    await admin
      .from('competitor_snapshots')
      .update({ price_changes: changes as unknown as Database['public']['Tables']['competitor_snapshots']['Update']['price_changes'] })
      .eq('id', snapshotId)
  }

  // Notificação para mudanças >= 5%
  let notified = 0
  if (notifyUserId) {
    const significant = changes.filter((c) => Math.abs(c.delta_pct) >= 5)
    if (significant.length) {
      const slug = (current.units as { slug: string } | null)?.slug ?? ''
      const top = significant
        .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
        .slice(0, 3)
      const summary = top.map((c) =>
        `${c.categoria_concorrente} ${c.periodo}: ${c.delta_pct >= 0 ? '+' : ''}${c.delta_pct}%`
      ).join('; ')
      await admin.from('notifications').insert({
        user_id: notifyUserId,
        type:    'concorrente_mudou_preco',
        title:   `🎯 ${current.competitor_name} mudou ${significant.length} preço${significant.length > 1 ? 's' : ''}`,
        body:    summary,
        link:    `/dashboard/concorrentes?unit=${slug}`,
      })
      notified = significant.length
    }
  }

  return { changes, notified }
}

/**
 * Calcula price gap (nosso preço vs mediana de concorrentes equivalentes).
 *
 * Para cada (categoria, periodo, dia_tipo) da nossa tabela ativa:
 *   - Coleta preços de concorrentes dos últimos 7 dias para o mesmo periodo+dia_tipo
 *   - Heurística de matching de categoria: mesmo nome (case-insensitive). Sem
 *     mapping cross-unit por enquanto — agente já tem comodidades para
 *     comparações qualitativas no prompt.
 *   - Calcula mediana/min/max
 *   - gap_pct = (preco_nosso − mediana) / mediana * 100
 *   - Classifica: |gap| < 5% → aligned; gap < -5% → underprice; gap > +5% → overprice
 *
 * Substitui gaps anteriores da mesma unidade (truncate + reinsert).
 */
/**
 * Computa price gaps em duas fases:
 *
 * Fase 1 — match no nível de CATEGORIA (uma suite do concorrente por categoria nossa):
 *   Para cada (nossa_categoria, concorrente), escolhe a suite mais equivalente usando
 *   nome exato → Jaccard de comodidades → proximidade de preço global (mediana de todos
 *   os períodos da categoria). Isso garante que 3h/6h/12h/pernoite de uma mesma
 *   categoria sempre comparam contra a MESMA suite do concorrente, sem inversões de preço.
 *
 * Fase 2 — gap por (nossa_cat, periodo, dia_tipo, concorrente):
 *   Com a suite fixada na Fase 1, busca os preços daquela suite para cada período e
 *   calcula gap_pct = (nosso − mediana_deles) / mediana_deles * 100.
 *
 * @param cutoffDays - janela de snapshots válidos (default 7 dias; relatório usa 14)
 */
export async function computeAndPersistGaps(
  unitId: string,
  cutoffDays = 7,
): Promise<{ inserted: number }> {
  const admin = getAdmin()

  // Tabela de preços ativa (nossa)
  const today = new Date().toISOString().slice(0, 10)
  const { data: activeImport } = await admin
    .from('price_imports')
    .select('parsed_data')
    .eq('unit_id', unitId)
    .lte('valid_from', today)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeImport) return { inserted: 0 }
  const allOurRows = (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
  if (!allOurRows.length) return { inserted: 0 }

  // Deduplica nossas linhas por (cat, per, dia) — prefere balcao_site; evita gaps duplicados por canal
  const ourDeduped = new Map<string, ParsedPriceRow>()
  for (const r of allOurRows) {
    const key = `${r.categoria.trim()}|${normalizePeriod(r.periodo)}|${(r.dia_tipo ?? 'todos').trim()}`
    const existing = ourDeduped.get(key)
    if (!existing || r.canal === 'balcao_site') ourDeduped.set(key, r)
  }

  // Comodidades das nossas suítes (para match semântico)
  const { data: agentCfg } = await admin
    .from('rm_agent_config')
    .select('suite_amenities')
    .eq('unit_id', unitId)
    .maybeSingle()
  const ourAmenities = (agentCfg?.suite_amenities as Record<string, string[]> | null) ?? {}

  // Snapshots de concorrentes dentro da janela (status done)
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 3600 * 1000).toISOString()
  const { data: snapshots } = await admin
    .from('competitor_snapshots')
    .select('id, competitor_name, mapped_prices, scraped_at, raw_text')
    .eq('unit_id', unitId)
    .eq('status', 'done')
    .gte('scraped_at', cutoff)

  if (!snapshots?.length) return { inserted: 0 }

  type Bucket = { precos: number[]; categoria_competitor: string; amenities?: string[] }

  // Estrutura por concorrente: competitor_name → (cat_lower|per|dia) → Bucket
  const perCompetitorData = new Map<string, {
    catBuckets:     Map<string, Bucket>
    amenitiesBySuite: Record<string, string[]>
  }>()

  // Fallback: mediana de mercado por período (todos os concorrentes juntos)
  const periodBuckets = new Map<string, Bucket>()

  for (const snap of snapshots) {
    const amenitiesBySuite = parseAmenitiesBySuite(snap.raw_text)
    const prices = (snap.mapped_prices as unknown as CompetitorPriceRow[]) ?? []

    let compData = perCompetitorData.get(snap.competitor_name)
    if (!compData) {
      compData = { catBuckets: new Map(), amenitiesBySuite: {} }
      perCompetitorData.set(snap.competitor_name, compData)
    }
    Object.assign(compData.amenitiesBySuite, amenitiesBySuite)

    for (const p of prices) {
      const cat = p.categoria_concorrente.trim()
      const per = normalizePeriod(p.periodo)
      const dia = (p.dia_tipo ?? 'todos').trim()

      const catKey = `${cat.toLowerCase()}|${per}|${dia}`
      let catBucket = compData.catBuckets.get(catKey)
      if (!catBucket) {
        const suiteAmenities = amenitiesBySuite[cat] ?? amenitiesBySuite[cat.toLowerCase()] ?? undefined
        catBucket = { precos: [], categoria_competitor: cat, amenities: suiteAmenities }
        compData.catBuckets.set(catKey, catBucket)
      }
      catBucket.precos.push(p.preco)

      const perKey = `${per}|${dia}`
      let perBucket = periodBuckets.get(perKey)
      if (!perBucket) {
        perBucket = { precos: [], categoria_competitor: 'mercado' }
        periodBuckets.set(perKey, perBucket)
      }
      perBucket.precos.push(p.preco)
    }
  }

  // ─── FASE 1: match no nível de categoria ────────────────────────────────────
  // Para cada (nossa categoria, concorrente), decide qual suite do concorrente é
  // equivalente — a mesma suite será usada para TODOS os períodos daquela categoria.
  // Isso evita inversões (6h > 12h) causadas por matching independente por período.

  // Agrega preços por (cat_lower) dentro de cada concorrente (para proximidade global)
  const compCatAggregates = new Map<string, Map<string, { precos: number[]; amenities?: string[]; originalName: string }>>()
  for (const [competitorName, compData] of perCompetitorData) {
    const catAgg = new Map<string, { precos: number[]; amenities?: string[]; originalName: string }>()
    compCatAggregates.set(competitorName, catAgg)
    for (const [key, b] of compData.catBuckets) {
      const compCatLower = key.split('|')[0]
      let agg = catAgg.get(compCatLower)
      if (!agg) {
        agg = { precos: [], amenities: b.amenities, originalName: b.categoria_competitor }
        catAgg.set(compCatLower, agg)
      }
      agg.precos.push(...b.precos)
      if (!agg.amenities && b.amenities) agg.amenities = b.amenities
    }
  }

  // Agrega preços por (nossa_cat) para proximidade global
  const ourCatGlobalMedian = new Map<string, number>()
  const ourCatsPer: Map<string, number[]> = new Map()
  for (const r of ourDeduped.values()) {
    const cat = r.categoria.trim()
    const arr = ourCatsPer.get(cat) ?? []
    arr.push(r.preco)
    ourCatsPer.set(cat, arr)
  }
  for (const [cat, prices] of ourCatsPer) {
    ourCatGlobalMedian.set(cat, median(prices))
  }

  // categoryMatches: competitor_name → our_cat → matched_comp_cat_lower
  const categoryMatches = new Map<string, Map<string, string>>()

  for (const [competitorName, catAgg] of compCatAggregates) {
    const matchMap = new Map<string, string>()
    categoryMatches.set(competitorName, matchMap)

    for (const ourCat of ourCatsPer.keys()) {
      // 1) Nome exato
      if (catAgg.has(ourCat.toLowerCase())) {
        matchMap.set(ourCat, ourCat.toLowerCase())
        continue
      }

      // 2) Jaccard de comodidades (≥ 0.25)
      const ourDistinctive = getDistinctiveAmenities(ourAmenities[ourCat] ?? [])
      if (ourDistinctive.size > 0) {
        let bestScore = 0, bestCat: string | undefined
        for (const [compCatLower, agg] of catAgg) {
          if (!agg.amenities?.length) continue
          const score = jaccardSimilarity(ourDistinctive, getDistinctiveAmenities(agg.amenities))
          if (score > bestScore) { bestScore = score; bestCat = compCatLower }
        }
        if (bestScore >= 0.25 && bestCat) { matchMap.set(ourCat, bestCat); continue }
      }

      // 3) Proximidade de preço global (mediana de TODOS os períodos da categoria)
      const ourMed = ourCatGlobalMedian.get(ourCat) ?? 0
      let bestDist = Infinity, bestCat: string | undefined
      for (const [compCatLower, agg] of catAgg) {
        if (!agg.precos.length) continue
        const dist = Math.abs(median(agg.precos) - ourMed)
        if (dist < bestDist) { bestDist = dist; bestCat = compCatLower }
      }
      if (bestCat) matchMap.set(ourCat, bestCat)
    }
  }

  // ─── FASE 2: gaps usando a suite fixada na Fase 1 ───────────────────────────

  function makeGap(
    r: ParsedPriceRow,
    cat: string,
    per: string,
    dia: string,
    bucket: Bucket,
    competitorName: string,
    competitorPeriodo?: string,
    isApproximated?: boolean,
  ): CompetitorGap {
    const med     = +median(bucket.precos).toFixed(2)
    const min     = +Math.min(...bucket.precos).toFixed(2)
    const max     = +Math.max(...bucket.precos).toFixed(2)
    const gap_pct = +(((r.preco - med) / med) * 100).toFixed(2)
    const position: CompetitorGap['position'] =
      Math.abs(gap_pct) < 5 ? 'aligned' : gap_pct < 0 ? 'underprice' : 'overprice'
    return {
      categoria_nossa:           cat,
      categoria_competitor:      bucket.categoria_competitor,
      periodo:                   per,
      dia_tipo:                  dia,
      preco_nosso:               +r.preco.toFixed(2),
      preco_concorrente_mediana: med,
      preco_concorrente_min:     min,
      preco_concorrente_max:     max,
      gap_pct,
      position,
      competitor_name:           competitorName,
      competitor_periodo:        competitorPeriodo,
      is_approximated:           isApproximated,
    }
  }

  const gaps: CompetitorGap[] = []

  for (const r of ourDeduped.values()) {
    const cat = r.categoria.trim()
    const per = normalizePeriod(r.periodo)
    const dia = (r.dia_tipo ?? 'todos').trim()

    let anyMatched = false

    for (const [competitorName, compData] of perCompetitorData) {
      const matchedCompCatLower = categoryMatches.get(competitorName)?.get(cat)
      if (!matchedCompCatLower) continue

      // Busca bucket da suite fixada para este período
      const key         = `${matchedCompCatLower}|${per}|${dia}`
      const fallbackKey = `${matchedCompCatLower}|${per}|todos`
      let bucket = compData.catBuckets.get(key) ?? compData.catBuckets.get(fallbackKey)
      let approxPeriodo: string | undefined

      // Match aproximado de período: 2h→3h, 4h→6h etc. (concorrentes com grades diferentes)
      if (!bucket) {
        const range = approxHoursRange(per)
        if (range) {
          let bestDist = Infinity
          for (const [bKey, bBucket] of compData.catBuckets) {
            const parts = bKey.split('|')
            if (parts[0] !== matchedCompCatLower) continue
            if (parts[2] !== dia && parts[2] !== 'todos') continue
            const bHours = parseHoursFromPeriod(parts[1])
            if (bHours === null || bHours < range[0] || bHours >= range[1]) continue
            const ourHours = parseHoursFromPeriod(per) ?? 0
            const dist = Math.abs(bHours - ourHours)
            if (dist < bestDist) { bestDist = dist; bucket = bBucket; approxPeriodo = parts[1] }
          }
        }
      }

      if (!bucket || !bucket.precos.length) continue
      if (median(bucket.precos) === 0) continue

      anyMatched = true
      gaps.push(makeGap(r, cat, per, dia, bucket, competitorName, approxPeriodo, !!approxPeriodo))
    }

    // Fallback de mercado apenas quando nenhum concorrente emparelhou
    if (!anyMatched) {
      const bucket = periodBuckets.get(`${per}|${dia}`) ?? periodBuckets.get(`${per}|todos`)
      if (bucket && bucket.precos.length >= 1 && median(bucket.precos) > 0) {
        gaps.push(makeGap(r, cat, per, dia, bucket, 'mercado'))
      }
    }
  }

  if (!gaps.length) return { inserted: 0 }

  await admin.from('rm_competitor_price_gaps').delete().eq('unit_id', unitId)
  const { error } = await admin
    .from('rm_competitor_price_gaps')
    .insert(gaps.map((g) => ({
      unit_id:                   unitId,
      snapshot_id:               null,
      competitor_name:           g.competitor_name,
      categoria_nossa:           g.categoria_nossa,
      categoria_competitor:      g.categoria_competitor,
      periodo:                   g.periodo,
      dia_tipo:                  g.dia_tipo,
      preco_nosso:               g.preco_nosso,
      preco_concorrente_mediana: g.preco_concorrente_mediana,
      preco_concorrente_min:     g.preco_concorrente_min,
      preco_concorrente_max:     g.preco_concorrente_max,
      gap_pct:                   g.gap_pct,
      position:                  g.position,
      competitor_periodo:        g.competitor_periodo ?? null,
      is_approximated:           g.is_approximated ?? false,
    })))

  if (error) {
    console.error('[competitors/gaps] erro ao inserir:', error.message)
    return { inserted: 0 }
  }
  return { inserted: gaps.length }
}

/**
 * Busca gaps recentes para injetar no prompt do agente.
 */
export async function getRecentGaps(unitId: string): Promise<CompetitorGap[]> {
  const admin = getAdmin()
  const { data } = await admin
    .from('rm_competitor_price_gaps')
    .select('*')
    .eq('unit_id', unitId)
    .order('computed_at', { ascending: false })
    .limit(50)

  if (!data) return []
  return data.map((g) => ({
    categoria_nossa:           g.categoria_nossa,
    categoria_competitor:      g.categoria_competitor ?? '',
    periodo:                   g.periodo,
    dia_tipo:                  g.dia_tipo,
    preco_nosso:               Number(g.preco_nosso),
    preco_concorrente_mediana: Number(g.preco_concorrente_mediana),
    preco_concorrente_min:     Number(g.preco_concorrente_min ?? 0),
    preco_concorrente_max:     Number(g.preco_concorrente_max ?? 0),
    gap_pct:                   Number(g.gap_pct),
    position:                  g.position as CompetitorGap['position'],
    competitor_name:           g.competitor_name,
    competitor_periodo:        g.competitor_periodo ?? undefined,
    is_approximated:           g.is_approximated ?? false,
  }))
}

/**
 * Bloco "Posição competitiva" para injetar no prompt do agente.
 */
export function buildCompetitorGapBlock(gaps: CompetitorGap[]): string {
  if (!gaps.length) return ''

  // Foca nos gaps mais relevantes — ordena por |gap_pct| desc
  const sorted = [...gaps].sort((a, b) => Math.abs(b.gap_pct) - Math.abs(a.gap_pct))
  const top = sorted.slice(0, 15)

  const POS_BADGE: Record<CompetitorGap['position'], string> = {
    underprice: '🟦 Underprice',
    aligned:    '🟢 Alinhado',
    overprice:  '🟥 Overprice',
  }

  const DIA_LABEL: Record<string, string> = {
    semana: 'Semana', fds_feriado: 'FDS/Feriado', todos: 'Todos',
  }

  const lines = top.map((g) => {
    const dia = DIA_LABEL[g.dia_tipo] ?? g.dia_tipo
    const gapStr = `${g.gap_pct >= 0 ? '+' : ''}${g.gap_pct.toFixed(1)}%`
    return `| ${g.categoria_nossa} | ${g.periodo} | ${dia} | R$ ${g.preco_nosso.toFixed(2)} | R$ ${g.preco_concorrente_mediana.toFixed(2)} | ${gapStr} | ${POS_BADGE[g.position]} |`
  }).join('\n')

  return `## Posição competitiva (snapshots dos últimos 7 dias)

| Categoria | Período | Dia | Nosso preço | Mediana mercado | Gap | Posição |
|-----------|---------|-----|-------------|-----------------|-----|---------|
${lines}

> Gap negativo = subprecificado vs mercado; gap positivo = superprecificado.
> Use junto com comodidades equivalentes (suíte com hidro só compara com hidro).`
}
