import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ElasticityResult {
  categoria: string
  periodo: string
  dia_tipo: string
  elasticity: number | null       // null = dados insuficientes
  r_squared: number | null
  n_observations: number
  confidence_interval_low: number | null
  confidence_interval_high: number | null
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
}

interface Observation {
  variacao_pct: number   // Δpreço %
  delta_giro_pct: number // Δgiro %
}

// ─── Regressão OLS log-log ────────────────────────────────────────────────────
// Modelo: ln(1 + Δg/100) = a + b·ln(1 + Δp/100)
// b é a elasticidade-preço (esperado negativo)

function olsLogLog(observations: Observation[]): {
  elasticity: number
  intercept: number
  r_squared: number
  se_b: number
} | null {
  const pairs = observations.filter(
    (o) => o.variacao_pct !== 0 && isFinite(o.variacao_pct) && isFinite(o.delta_giro_pct)
  )
  const n = pairs.length
  if (n < 3) return null

  const xs = pairs.map((o) => Math.log(1 + o.variacao_pct / 100))
  const ys = pairs.map((o) => Math.log(1 + o.delta_giro_pct / 100))

  const meanX = xs.reduce((s, v) => s + v, 0) / n
  const meanY = ys.reduce((s, v) => s + v, 0) / n

  let ssXX = 0, ssXY = 0, ssTot = 0
  for (let i = 0; i < n; i++) {
    ssXX += (xs[i] - meanX) ** 2
    ssXY += (xs[i] - meanX) * (ys[i] - meanY)
    ssTot += (ys[i] - meanY) ** 2
  }

  if (ssXX === 0) return null

  const b = ssXY / ssXX
  const a = meanY - b * meanX

  // Resíduos e R²
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (a + b * xs[i])) ** 2
  }
  const r_squared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0

  // Erro padrão de b (para IC 95%)
  const mse = ssRes / Math.max(1, n - 2)
  const se_b = Math.sqrt(mse / ssXX)

  return { elasticity: b, intercept: a, r_squared, se_b }
}

// Valor crítico t aproximado para IC 95% (graus de liberdade = n - 2)
function tCritical(df: number): number {
  if (df >= 30) return 2.042
  if (df >= 20) return 2.086
  if (df >= 10) return 2.228
  if (df >= 5)  return 2.571
  return 3.182 // df = 3 (mínimo)
}

function confidenceLevel(n: number): ElasticityResult['confidence'] {
  if (n >= 10) return 'high'
  if (n >= 5)  return 'medium'
  if (n >= 3)  return 'low'
  return 'insufficient'
}

// ─── Cálculo e persistência por unidade ──────────────────────────────────────

export async function computeAndPersistElasticity(unitId: string): Promise<number> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Busca todas as lições com variação de preço e giro mensuráveis (últimos 365 dias)
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)

  const { data: lessons } = await admin
    .from('rm_pricing_lessons')
    .select('categoria, periodo, dia_tipo, variacao_pct, delta_giro_pct, observed_at')
    .eq('unit_id', unitId)
    .gte('observed_at', cutoff.toISOString())
    .not('variacao_pct', 'is', null)
    .not('delta_giro_pct', 'is', null)

  if (!lessons?.length) return 0

  // Agrupa por (categoria, periodo, dia_tipo)
  const groups = new Map<string, Observation[]>()
  let windowStart = lessons[0].observed_at
  let windowEnd   = lessons[0].observed_at

  for (const l of lessons) {
    const key = `${l.categoria}|${l.periodo}|${l.dia_tipo}`
    const list = groups.get(key) ?? []
    list.push({
      variacao_pct:   Number(l.variacao_pct),
      delta_giro_pct: Number(l.delta_giro_pct),
    })
    groups.set(key, list)
    if (l.observed_at < windowStart) windowStart = l.observed_at
    if (l.observed_at > windowEnd)   windowEnd   = l.observed_at
  }

  const dataWindowStart = windowStart.slice(0, 10)
  const dataWindowEnd   = windowEnd.slice(0, 10)

  const upserts: Database['public']['Tables']['rm_price_elasticity']['Insert'][] = []

  for (const [key, obs] of groups) {
    const [categoria, periodo, dia_tipo] = key.split('|')
    const regression = olsLogLog(obs)

    if (!regression) {
      // Dados insuficientes — persiste apenas o contador
      upserts.push({
        unit_id: unitId, categoria, periodo, dia_tipo,
        elasticity: null, intercept: null, r_squared: null,
        n_observations: obs.length,
        confidence_interval_low: null, confidence_interval_high: null,
        computed_at: new Date().toISOString(),
        data_window_start: dataWindowStart,
        data_window_end: dataWindowEnd,
      })
      continue
    }

    const { elasticity, intercept, r_squared, se_b } = regression
    const df = obs.length - 2
    const t = tCritical(df)
    const ci_low  = +(elasticity - t * se_b).toFixed(3)
    const ci_high = +(elasticity + t * se_b).toFixed(3)

    upserts.push({
      unit_id: unitId, categoria, periodo, dia_tipo,
      elasticity:              +elasticity.toFixed(3),
      intercept:               +intercept.toFixed(3),
      r_squared:               +r_squared.toFixed(3),
      n_observations:          obs.length,
      confidence_interval_low:  ci_low,
      confidence_interval_high: ci_high,
      computed_at:             new Date().toISOString(),
      data_window_start:       dataWindowStart,
      data_window_end:         dataWindowEnd,
    })
  }

  if (upserts.length) {
    await admin
      .from('rm_price_elasticity')
      .upsert(upserts, { onConflict: 'unit_id,categoria,periodo,dia_tipo' })
  }

  return upserts.length
}

// ─── Leitura para prompt ──────────────────────────────────────────────────────

export async function getElasticityForUnit(unitId: string): Promise<ElasticityResult[]> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await admin
    .from('rm_price_elasticity')
    .select('*')
    .eq('unit_id', unitId)
    .order('categoria')
    .order('periodo')

  return (data ?? []).map((r) => ({
    categoria:               r.categoria,
    periodo:                 r.periodo,
    dia_tipo:                r.dia_tipo,
    elasticity:              r.elasticity != null ? Number(r.elasticity) : null,
    r_squared:               r.r_squared  != null ? Number(r.r_squared)  : null,
    n_observations:          r.n_observations,
    confidence_interval_low:  r.confidence_interval_low  != null ? Number(r.confidence_interval_low)  : null,
    confidence_interval_high: r.confidence_interval_high != null ? Number(r.confidence_interval_high) : null,
    confidence: confidenceLevel(r.n_observations),
  }))
}

// ─── Bloco markdown para o prompt ────────────────────────────────────────────

export function buildElasticityBlock(rows: ElasticityResult[]): string {
  const usable = rows.filter((r) => r.elasticity != null && r.confidence !== 'insufficient')
  if (!usable.length) return ''

  const DIA_LABEL: Record<string, string> = { semana: 'Semana', fds_feriado: 'FDS/Fer.', todos: 'Todos' }
  const CONF_LABEL: Record<string, string> = { high: '✅ Alta', medium: '⚠️ Média', low: '🔸 Baixa' }

  const lines = usable.map((r) => {
    const e = r.elasticity!.toFixed(2)
    const interpretation =
      Math.abs(r.elasticity!) < 0.5  ? 'Inelástica — aumentos absorvidos' :
      Math.abs(r.elasticity!) < 1.0  ? 'Moderada — monitorar volume'       :
                                       'Elástica — cuidado com aumentos'
    const ci = r.confidence_interval_low != null && r.confidence_interval_high != null
      ? `[${r.confidence_interval_low.toFixed(2)}, ${r.confidence_interval_high.toFixed(2)}]`
      : '—'
    return `| ${r.categoria} | ${r.periodo} | ${DIA_LABEL[r.dia_tipo] ?? r.dia_tipo} | ${e} | ${ci} | ${r.n_observations} | ${CONF_LABEL[r.confidence] ?? r.confidence} | ${interpretation} |`
  }).join('\n')

  return `## Elasticidades-preço observadas

| Categoria | Período | Dia | Elasticidade | IC 95% | n obs | Confiança | Interpretação |
|-----------|---------|-----|--------------|--------|-------|-----------|---------------|
${lines}

> Use a elasticidade para calibrar a magnitude das propostas:
> - **< 0.5 (inelástica):** aumentos de preço aumentam receita — demanda pouco sensível
> - **0.5–1.0 (moderada):** aumentos moderados; monitore o volume nas revisões
> - **> 1.0 (elástica):** demanda muito sensível — aumentos reduzem receita líquida
>
> Para calcular impacto de receita: Δreceita% ≈ Δpreço% × (1 + elasticidade)`
}

// ─── Cálculo de impacto esperado de receita ───────────────────────────────────

export function expectedRevenueChangePct(
  elasticity: number,
  deltaPricePct: number,
): number {
  // delta_giro_pct ≈ elasticidade × delta_preco_pct
  const deltaGiroPct = elasticity * deltaPricePct
  // delta_receita = (1 + Δp/100) × (1 + Δg/100) - 1
  const deltaRevenuePct =
    ((1 + deltaPricePct / 100) * (1 + deltaGiroPct / 100) - 1) * 100
  return +deltaRevenuePct.toFixed(1)
}
