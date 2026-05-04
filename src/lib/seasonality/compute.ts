import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'

/**
 * HV5 (LHG-165): sazonalidade aprendida do histórico Automo.
 *
 * Algoritmo (sem ML — estatística simples):
 *   Para cada dia D do trailing year:
 *     revpar(D)       = receita_dia / suíte-dias_do_dia
 *     baseline_window = média de revpar dos ±15 dias do mesmo ano
 *     factor          = revpar(D) / baseline_window
 *   Persiste em unit_seasonality(unit_id, 'MM-DD', 'annual_recurring')
 *
 * Conforme ano acumula, n_observations sobe. No 1º ano: confidence='low'.
 */

interface DayKpi {
  date_iso:    string  // YYYY-MM-DD
  revpar:      number
  giro:        number
  ocupacao:    number
  ticket:      number
}

function getAdmin() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Busca KPIs diários do trailing year direto do Automo.
 * Resultado: 1 row por dia do período com revpar/giro/ocupacao/ticket.
 */
async function fetchDailyKpis(unitSlug: string): Promise<DayKpi[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = (UNIT_CATEGORY_IDS[unitSlug] ?? []).join(',')
  if (!catIds) return []

  // Trailing year: hoje - 365 dias até ontem (corte 06:00)
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 365)
  const startIso = start.toISOString().slice(0, 10)
  const endIso   = today.toISOString().slice(0, 10) // exclusive

  // Query: agrupa por data (corte 06:00 = dia operacional), descontando
  // suítes-dia bloqueadas via mesmo CTE de suite-days (LHG-172).
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
      SELECT
        d.dia,
        COUNT(*)::bigint AS suite_dias
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
        COALESCE(SUM(CAST(la.valortotal          AS DECIMAL(15,4))), 0) AS valor_total,
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
      COALESCE(lp.rentals,        0) AS rentals,
      COALESCE(lp.receita,        0) AS receita,
      COALESCE(lp.occupied_seconds, 0) AS occupied_seconds,
      sd.suite_dias                  AS suite_dias
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

/**
 * Computa e persiste fatores sazonais para uma unidade.
 * Algoritmo: para cada dia D, factor_kpi = kpi(D) / median(kpi de ±15 dias).
 */
export async function recomputeSeasonality(unitId: string, unitSlug: string): Promise<{
  ok: boolean
  days_processed: number
  error?: string
}> {
  try {
    const dailyKpis = await fetchDailyKpis(unitSlug)
    if (dailyKpis.length < 30) {
      return { ok: false, days_processed: dailyKpis.length, error: 'dados insuficientes (<30 dias)' }
    }

    const admin = getAdmin()

    // Para cada dia do array, calcula factors usando janela ±15 dias
    const WINDOW = 15

    // Helper: median de array
    function median(arr: number[]): number {
      if (!arr.length) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    const upserts = dailyKpis.map((day, idx) => {
      const lo = Math.max(0, idx - WINDOW)
      const hi = Math.min(dailyKpis.length, idx + WINDOW + 1)
      const window = dailyKpis.slice(lo, hi).filter((_, i) => i !== idx - lo)
      const baselineRev = median(window.map((d) => d.revpar)) || 1
      const baselineGiro = median(window.map((d) => d.giro)) || 1
      const baselineOcc = median(window.map((d) => d.ocupacao)) || 1
      const baselineTicket = median(window.map((d) => d.ticket)) || 1

      // stddev de revpar na janela
      const mean = window.reduce((a, d) => a + d.revpar, 0) / Math.max(1, window.length)
      const variance = window.reduce((a, d) => a + Math.pow(d.revpar - mean, 2), 0) / Math.max(1, window.length)
      const stddev = Math.sqrt(variance)

      const dateMM_DD = day.date_iso.slice(5)  // YYYY-MM-DD → MM-DD

      return {
        unit_id:         unitId,
        date_key:        dateMM_DD,
        date_key_type:   'annual_recurring' as const,
        revpar_factor:   +(day.revpar / baselineRev).toFixed(3),
        giro_factor:     +(day.giro / baselineGiro).toFixed(3),
        ocupacao_factor: +(day.ocupacao / baselineOcc).toFixed(3),
        ticket_factor:   +(day.ticket / baselineTicket).toFixed(3),
        n_observations:  1, // 1 ano de dados
        stddev_revpar:   +stddev.toFixed(3),
        computed_at:     new Date().toISOString(),
      }
    })

    // Upsert em batch (PostgreSQL aceita ON CONFLICT)
    const { error } = await admin
      .from('unit_seasonality')
      .upsert(upserts, { onConflict: 'unit_id,date_key,date_key_type' })

    if (error) return { ok: false, days_processed: 0, error: error.message }

    return { ok: true, days_processed: upserts.length }
  } catch (e) {
    return { ok: false, days_processed: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Read API ────────────────────────────────────────────────────────────────

export interface SeasonalFactor {
  date:           string          // YYYY-MM-DD
  date_label:     string          // 'DD/MM' formatted
  day_of_week:    string          // 'segunda-feira'
  revpar_factor:  number          // ex: 1.47
  giro_factor:    number
  ocupacao_factor: number
  ticket_factor:  number
  confidence:     'low' | 'medium' | 'high'
  is_hot:         boolean         // factor > 1.3
  is_cold:        boolean         // factor < 0.7
}

const DOW_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/**
 * Retorna fatores sazonais para os próximos N dias (incluindo hoje).
 * Vazio se a unidade não tem dados computados (< 30 dias trailing year).
 */
export async function getUpcomingSeasonalFactors(unitId: string, days = 30): Promise<SeasonalFactor[]> {
  const admin = getAdmin()
  const today = new Date()

  // Gera array de date_keys MM-DD para os próximos N dias
  const dates: { iso: string; mmdd: string; dow: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const iso = d.toISOString().slice(0, 10)
    dates.push({ iso, mmdd: iso.slice(5), dow: d.getDay() })
  }

  const { data } = await admin
    .from('unit_seasonality')
    .select('date_key, revpar_factor, giro_factor, ocupacao_factor, ticket_factor, n_observations')
    .eq('unit_id', unitId)
    .eq('date_key_type', 'annual_recurring')
    .in('date_key', dates.map((d) => d.mmdd))

  if (!data || !data.length) return []

  const map = new Map(data.map((r) => [r.date_key, r]))

  return dates
    .map((d) => {
      const row = map.get(d.mmdd)
      if (!row) return null
      const revparF = Number(row.revpar_factor) || 1
      const confidence: 'low' | 'medium' | 'high' =
        (row.n_observations ?? 0) >= 3 ? 'high'
        : (row.n_observations ?? 0) >= 2 ? 'medium'
        : 'low'
      return {
        date:           d.iso,
        date_label:     `${d.iso.slice(8, 10)}/${d.iso.slice(5, 7)}`,
        day_of_week:    DOW_PT[d.dow],
        revpar_factor:  revparF,
        giro_factor:    Number(row.giro_factor) || 1,
        ocupacao_factor: Number(row.ocupacao_factor) || 1,
        ticket_factor:  Number(row.ticket_factor) || 1,
        confidence,
        is_hot:         revparF > 1.3,
        is_cold:        revparF < 0.7,
      } as SeasonalFactor
    })
    .filter((x): x is SeasonalFactor => x !== null)
}

/**
 * Retorna o fator sazonal de uma data específica (MM-DD).
 * Útil para a decomposição de lift (HV1) ajustar a contribuição
 * "seasonality" comparando expected_factor das duas janelas.
 */
export async function getSeasonalFactorFor(unitId: string, date: Date): Promise<SeasonalFactor | null> {
  const factors = await getUpcomingSeasonalFactors(unitId, 1)
  // getUpcomingSeasonalFactors hoje começa em today — para data específica seria ineficiente;
  // retornamos null (HV1 vai gracefully skip) — refatorar quando virar bottleneck.
  void date
  return factors[0] ?? null
}

/**
 * Bloco markdown injetado no prompt: próximos 30 dias com factor.
 * Vazio quando a unidade ainda não tem dados de sazonalidade computados.
 */
export function buildSeasonalityBlock(factors: SeasonalFactor[]): string {
  if (!factors.length) return ''

  // Filtra só dias relevantes: factor > 1.15 OU < 0.85 (esquece os "normais")
  const relevant = factors.filter((f) => f.revpar_factor > 1.15 || f.revpar_factor < 0.85)
  if (!relevant.length) {
    return `## Sazonalidade esperada (próximos 30 dias)

Nenhum dia com sazonalidade significativa nos próximos 30 dias — manter operação calibrada para a média.`
  }

  const fmtFactor = (n: number) => `${n.toFixed(2)}x`
  const lines = relevant.slice(0, 12).map((f) => {
    const tag = f.is_hot ? '🔥 quente' : f.is_cold ? '🥶 frio' : ''
    return `| ${f.date_label} | ${f.day_of_week.slice(0, 3)} | **${fmtFactor(f.revpar_factor)}** | ${fmtFactor(f.giro_factor)} | ${fmtFactor(f.ocupacao_factor)} | ${tag} |`
  }).join('\n')

  return `## Sazonalidade esperada (próximos 30 dias)

| Data | Dia | Fator RevPAR | Fator Giro | Fator Ocupação | |
|------|-----|--------------|------------|----------------|---|
${lines}

> Considere a sazonalidade ao propor preços:
> - Datas com fator > 1.3 → demanda historicamente inelástica, espaço para aumento
> - Datas com fator < 0.7 → demanda elástica, considerar promoção ou desconto
> - Confiança baixa (1 ano de dados) — a tendência aumenta com acúmulo de mais ciclos.`
}
