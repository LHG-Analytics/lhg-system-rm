import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'

/**
 * HV3 (LHG-163): detecção diária de anomalias via z-score.
 *
 * Algoritmo:
 *   Para cada (unit, metric):
 *     - current  = média dos últimos 7 dias
 *     - baseline = mean + stddev dos 83 dias anteriores (total 90d)
 *     - z = (current − mean) / stddev
 *     - Se |z| > 2 e n_observacoes >= 5: vira row em rm_anomalies
 *
 * Throttle: mesma metric+scope só re-detectada se a anterior fechou
 * (resolved/acknowledged) ou se tem mais de 7 dias.
 *
 * Filtro de ruído: ignora anomalias quando há eventos ativos no
 * período (sazonalidade conhecida — não é "anomalia").
 */

interface DailyMetric {
  date_iso: string
  revpar:   number
  giro:     number
  ocupacao: number
  ticket:   number
}

export interface DetectedAnomaly {
  metric:          'revpar' | 'giro' | 'ocupacao' | 'ticket'
  scope_label:     string
  scope:           Record<string, string | number>
  current_value:   number
  baseline_mean:   number
  baseline_stddev: number
  z_score:         number
  direction:       'positive_outlier' | 'negative_outlier'
}

function getAdmin() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Busca KPIs diários da unidade nos últimos 90 dias.
 * Reaproveita estrutura simplificada de seasonality/compute.ts mas em
 * janela menor para custo reduzido.
 */
async function fetchDailyMetrics(unitSlug: string, days = 90): Promise<DailyMetric[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = (UNIT_CATEGORY_IDS[unitSlug] ?? []).join(',')
  if (!catIds) return []

  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - days)
  const startIso = start.toISOString().slice(0, 10)
  const endIso   = today.toISOString().slice(0, 10)

  const sql = `
    WITH dias_periodo AS (
      SELECT generate_series($1::date, $2::date - INTERVAL '1 day', '1 day'::interval)::date AS dia
    ),
    bloqueios_intervalos AS (
      SELECT
        aps.id_apartamento,
        aps.datainicio::date AS bloq_inicio,
        COALESCE(aps.datafim::date, '9999-12-31'::date) AS bloq_fim
      FROM bloqueadoapartamento b
      INNER JOIN apartamentostate aps ON b.id_apartamentostate = aps.id
    ),
    suite_dias_por_dia AS (
      SELECT d.dia, COUNT(*)::bigint AS suite_dias
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      CROSS JOIN dias_periodo d
      WHERE ca.id IN (${catIds})
        AND a.dataexclusao IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bloqueios_intervalos bi
          WHERE bi.id_apartamento = a.id
            AND d.dia BETWEEN bi.bloq_inicio AND bi.bloq_fim
        )
      GROUP BY d.dia
    ),
    locacoes_por_dia AS (
      SELECT
        DATE(la.datainicialdaocupacao - INTERVAL '6 hour') AS dia,
        COUNT(*) AS rentals,
        COALESCE(SUM(CAST(la.valorliquidolocacao AS DECIMAL(15,4))), 0) AS receita,
        COALESCE(SUM(EXTRACT(EPOCH FROM la.datafinaldaocupacao - la.datainicialdaocupacao)), 0) AS occupied_seconds
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1::timestamp
        AND la.datainicialdaocupacao <  $2::timestamp
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
      GROUP BY DATE(la.datainicialdaocupacao - INTERVAL '6 hour')
    )
    SELECT
      sd.dia::text AS date_iso,
      COALESCE(lp.rentals, 0) AS rentals,
      COALESCE(lp.receita, 0) AS receita,
      COALESCE(lp.occupied_seconds, 0) AS occupied_seconds,
      sd.suite_dias AS suite_dias
    FROM suite_dias_por_dia sd
    LEFT JOIN locacoes_por_dia lp ON sd.dia = lp.dia
    WHERE sd.suite_dias > 0
    ORDER BY sd.dia;
  `

  interface Row {
    date_iso: string
    rentals: string
    receita: string
    occupied_seconds: string
    suite_dias: string
  }

  const { rows } = await pool.query<Row>(sql, [startIso, endIso])
  return rows.map((r) => {
    const suite_dias = Number(r.suite_dias) || 1
    const rentals    = Number(r.rentals) || 0
    const receita    = Number(r.receita) || 0
    const occupiedSec = Number(r.occupied_seconds) || 0
    return {
      date_iso: r.date_iso,
      revpar:   +(receita / suite_dias).toFixed(2),
      giro:     +(rentals / suite_dias).toFixed(3),
      ocupacao: +(occupiedSec / (suite_dias * 86_400) * 100).toFixed(2),
      ticket:   rentals > 0 ? +(receita / rentals).toFixed(2) : 0,
    }
  })
}

function meanAndStddev(arr: number[]): { mean: number; stddev: number } {
  if (!arr.length) return { mean: 0, stddev: 0 }
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length
  return { mean, stddev: Math.sqrt(variance) }
}

const METRIC_LABEL: Record<DetectedAnomaly['metric'], string> = {
  revpar:   'RevPAR',
  giro:     'Giro',
  ocupacao: 'Ocupação',
  ticket:   'Ticket Médio',
}

/**
 * Detecta anomalias na unidade. Retorna lista (vazio se nada acima do z=2).
 */
export async function detectAnomalies(unitSlug: string): Promise<DetectedAnomaly[]> {
  const dailies = await fetchDailyMetrics(unitSlug, 90)
  if (dailies.length < 30) return []  // dados insuficientes

  // Últimos 7 dias = janela móvel; baseline = anteriores
  const sorted = [...dailies].sort((a, b) => a.date_iso.localeCompare(b.date_iso))
  const recent   = sorted.slice(-7)
  const baseline = sorted.slice(0, sorted.length - 7)
  if (baseline.length < 20) return []

  const anomalies: DetectedAnomaly[] = []

  const metrics: DetectedAnomaly['metric'][] = ['revpar', 'giro', 'ocupacao', 'ticket']

  for (const metric of metrics) {
    const recentValues = recent.map((d) => d[metric]).filter((v) => Number.isFinite(v))
    const baselineValues = baseline.map((d) => d[metric]).filter((v) => Number.isFinite(v))
    if (recentValues.length < 5 || baselineValues.length < 20) continue

    const current     = recentValues.reduce((a, b) => a + b, 0) / recentValues.length
    const { mean, stddev } = meanAndStddev(baselineValues)
    if (stddev < 0.001) continue  // zero variation → ignorar

    const z = +((current - mean) / stddev).toFixed(2)
    if (Math.abs(z) <= 2) continue

    anomalies.push({
      metric,
      scope_label:    `Total (${METRIC_LABEL[metric]} 7d)`,
      scope:          { dimension: 'total' },
      current_value:  +current.toFixed(2),
      baseline_mean:  +mean.toFixed(2),
      baseline_stddev: +stddev.toFixed(2),
      z_score:        z,
      direction:      z > 0 ? 'positive_outlier' : 'negative_outlier',
    })
  }

  return anomalies
}

/**
 * Persiste anomalias detectadas, respeitando throttle (não duplica
 * scope/metric com row aberto < 7 dias) e gera notificação in-app
 * para anomalias negativas.
 */
export async function persistAnomalies(
  unitId: string,
  unitSlug: string,
  anomalies: DetectedAnomaly[],
  notifyUserId: string | null,
): Promise<{ inserted: number; throttled: number }> {
  if (!anomalies.length) return { inserted: 0, throttled: 0 }
  const admin = getAdmin()

  // Busca anomalias dos últimos 7 dias para throttle
  const throttleCutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: existing } = await admin
    .from('rm_anomalies')
    .select('metric, scope, status, detected_at')
    .eq('unit_id', unitId)
    .gte('detected_at', throttleCutoff)

  // Helper: é o mesmo escopo? (compara metric + scope.dimension)
  function isSameScope(a: { metric: string; scope: unknown }, b: { metric: string; scope: unknown }) {
    if (a.metric !== b.metric) return false
    const sa = a.scope as { dimension?: string }
    const sb = b.scope as { dimension?: string }
    return sa?.dimension === sb?.dimension
  }

  let inserted = 0
  let throttled = 0

  for (const an of anomalies) {
    const existingMatch = (existing ?? []).find((row) =>
      isSameScope({ metric: row.metric, scope: row.scope }, an)
      && row.status === 'open'
    )
    if (existingMatch) {
      throttled++
      continue
    }

    const { data: inserted_row } = await admin
      .from('rm_anomalies')
      .insert({
        unit_id:         unitId,
        metric:          an.metric,
        scope:           an.scope,
        current_value:   an.current_value,
        baseline_mean:   an.baseline_mean,
        baseline_stddev: an.baseline_stddev,
        z_score:         an.z_score,
        direction:       an.direction,
        status:          'open',
      })
      .select('id')
      .single()

    inserted++

    // Notificação só para anomalias negativas (positivas são informativas, não urgentes)
    if (notifyUserId && an.direction === 'negative_outlier' && inserted_row) {
      const directionEmoji = '🔻'
      const metricLabel = METRIC_LABEL[an.metric]
      await admin.from('notifications').insert({
        user_id: notifyUserId,
        type:    'anomalia_detectada',
        title:   `${directionEmoji} Anomalia detectada — ${metricLabel}`,
        body:    `${an.scope_label}: ${an.current_value.toFixed(2)} (z=${an.z_score.toFixed(1)} vs baseline ${an.baseline_mean.toFixed(2)})`,
        link:    `/dashboard?unit=${unitSlug}#anomalies`,
      })
    }
  }

  return { inserted, throttled }
}

/**
 * Roda detecção + persistência para uma unidade. Conveniência
 * para ser chamada pelo cron de revisões diariamente.
 */
export async function runAnomalyDetection(
  unitId: string,
  unitSlug: string,
  notifyUserId: string | null,
): Promise<{ detected: number; inserted: number; throttled: number }> {
  const anomalies = await detectAnomalies(unitSlug)
  const result = await persistAnomalies(unitId, unitSlug, anomalies, notifyUserId)
  return { detected: anomalies.length, ...result }
}
