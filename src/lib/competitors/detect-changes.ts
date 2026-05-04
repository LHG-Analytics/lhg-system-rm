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
  competitor_name:           string  // representativo (mediana mais próxima)
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
export async function computeAndPersistGaps(unitId: string): Promise<{ inserted: number }> {
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
  const ourRows = (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
  if (!ourRows.length) return { inserted: 0 }

  // Snapshots de concorrentes dos últimos 7 dias (status done)
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: snapshots } = await admin
    .from('competitor_snapshots')
    .select('id, competitor_name, mapped_prices, scraped_at')
    .eq('unit_id', unitId)
    .eq('status', 'done')
    .gte('scraped_at', cutoff)

  if (!snapshots?.length) return { inserted: 0 }

  // Estrutura: por (categoria_competitor_lower, periodo_lower, dia_tipo) → preços + nomes
  type Bucket = { precos: number[]; competitors: Set<string>; categoria_competitor: string }
  const competitorBuckets = new Map<string, Bucket>()

  for (const snap of snapshots) {
    const prices = (snap.mapped_prices as unknown as CompetitorPriceRow[]) ?? []
    for (const p of prices) {
      const cat = p.categoria_concorrente.trim()
      const per = p.periodo.trim()
      const dia = (p.dia_tipo ?? 'todos').trim()
      const key = `${cat.toLowerCase()}|${per.toLowerCase()}|${dia}`
      let bucket = competitorBuckets.get(key)
      if (!bucket) {
        bucket = { precos: [], competitors: new Set(), categoria_competitor: cat }
        competitorBuckets.set(key, bucket)
      }
      bucket.precos.push(p.preco)
      bucket.competitors.add(snap.competitor_name)
    }
  }

  // Para cada nossa linha, tenta matching exato; se não houver, tenta sem dia_tipo (todos)
  const gaps: CompetitorGap[] = []
  for (const r of ourRows) {
    const cat = r.categoria.trim()
    const per = r.periodo.trim()
    const dia = (r.dia_tipo ?? 'todos').trim()
    const exactKey = `${cat.toLowerCase()}|${per.toLowerCase()}|${dia}`
    const fallbackKey = `${cat.toLowerCase()}|${per.toLowerCase()}|todos`

    const bucket = competitorBuckets.get(exactKey) ?? competitorBuckets.get(fallbackKey)
    if (!bucket || bucket.precos.length < 1) continue

    const mediana = +median(bucket.precos).toFixed(2)
    if (mediana === 0) continue

    const min = Math.min(...bucket.precos)
    const max = Math.max(...bucket.precos)
    const gap_pct = +(((r.preco - mediana) / mediana) * 100).toFixed(2)
    const position: CompetitorGap['position'] =
      Math.abs(gap_pct) < 5 ? 'aligned'
      : gap_pct < 0 ? 'underprice'
      : 'overprice'

    gaps.push({
      categoria_nossa:           cat,
      categoria_competitor:      bucket.categoria_competitor,
      periodo:                   per,
      dia_tipo:                  dia,
      preco_nosso:               +r.preco.toFixed(2),
      preco_concorrente_mediana: mediana,
      preco_concorrente_min:     +min.toFixed(2),
      preco_concorrente_max:     +max.toFixed(2),
      gap_pct,
      position,
      competitor_name:           [...bucket.competitors][0] ?? 'mercado',
    })
  }

  if (!gaps.length) return { inserted: 0 }

  // Substitui o conjunto anterior (recompute total): truncate + insert
  await admin.from('rm_competitor_price_gaps').delete().eq('unit_id', unitId)
  const { error } = await admin
    .from('rm_competitor_price_gaps')
    .insert(gaps.map((g) => ({
      unit_id:                   unitId,
      snapshot_id:               null, // gap agregado de múltiplos snapshots
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
