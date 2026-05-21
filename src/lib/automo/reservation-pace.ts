import { getAutomPool, getUnitCategoryIds } from './client'

export type PaceSignal = 'acima' | 'normal' | 'abaixo' | 'muito_abaixo'

export interface ReservationPaceResult {
  /** Check-ins desde 06h BRT hoje */
  hoje_total: number
  /** Média de check-ins neste mesmo bloco de tempo (06h→agora) nos últimos 4 mesmos dias da semana */
  historico_medio: number
  /** Check-ins nas últimas 2h */
  hoje_2h: number
  /** Média de check-ins em janela de 2h equivalente nos últimos 4 mesmos dias da semana */
  historico_2h_medio: number
  /** Dia da semana atual (0=dom … 6=sáb) */
  dia_semana: number
  /** Hora atual BRT (0-23) */
  hora_atual: number
  /** Ratio hoje_total / historico_medio (null se sem histórico) */
  pace_ratio: number | null
  /** Ratio da janela de 2h */
  pace_ratio_2h: number | null
  /** Sinal de pace consolidado */
  signal: PaceSignal
  /** Número de semanas históricas encontradas (0-4) */
  n_historico: number
}

interface RawRow {
  hoje_total:         string
  hoje_2h:            string
  historico_total_1:  string | null
  historico_total_2:  string | null
  historico_total_3:  string | null
  historico_total_4:  string | null
  historico_2h_1:     string | null
  historico_2h_2:     string | null
  historico_2h_3:     string | null
  historico_2h_4:     string | null
  n_historico:        string
}

function toSignal(ratio: number | null): PaceSignal {
  if (ratio === null) return 'normal'
  if (ratio >= 1.15) return 'acima'
  if (ratio >= 0.85) return 'normal'
  if (ratio >= 0.60) return 'abaixo'
  return 'muito_abaixo'
}

/**
 * Calcula o ritmo de check-ins de hoje versus a média histórica do mesmo
 * dia da semana nas últimas 4 semanas, considerando o mesmo bloco horário.
 *
 * Exemplo: são 18h de sexta → compara check-ins de 06h-18h de hoje
 * com a média de check-ins de 06h-18h das últimas 4 sextas-feiras.
 *
 * Permite ao agente RM detectar: "estamos 35% abaixo do ritmo normal
 * para uma sexta à tarde — oportunidade de incentivo de preço".
 */
export async function getReservationPace(unitSlug: string): Promise<ReservationPaceResult | null> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return null

  const catIds = (await getUnitCategoryIds(unitSlug)).join(',')
  if (!catIds) return null

  const sql = `
    WITH
    brt_now AS (
      SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo') AS ts
    ),
    -- Início do dia operacional (06:00 BRT) — se hora < 6, usa ontem 06h
    op_start AS (
      SELECT
        CASE
          WHEN EXTRACT(HOUR FROM ts) >= 6
            THEN DATE_TRUNC('day', ts) + INTERVAL '6 hours'
          ELSE
            (DATE_TRUNC('day', ts) - INTERVAL '1 day') + INTERVAL '6 hours'
        END AS inicio_hoje
      FROM brt_now
    ),
    -- Base de locações filtrada por unidade
    base AS (
      SELECT la.datainicialdaocupacao
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE ca.id IN (${catIds})
        AND a.dataexclusao IS NULL
        AND (la.fimocupacaotipo IS NULL OR la.fimocupacaotipo != 'CANCELADA')
    ),
    -- Hoje: desde op_start até agora
    hoje AS (
      SELECT
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >= (SELECT inicio_hoje FROM op_start)
            AND b.datainicialdaocupacao <= (SELECT ts FROM brt_now) AT TIME ZONE 'UTC'
        ) AS total,
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >= ((SELECT ts FROM brt_now) - INTERVAL '2 hours') AT TIME ZONE 'UTC'
            AND b.datainicialdaocupacao <= (SELECT ts FROM brt_now) AT TIME ZONE 'UTC'
        ) AS duas_horas
      FROM base b
    ),
    -- Histórico: mesmas 4 semanas anteriores, mesmo dia da semana
    -- Janela: 06h até a mesma hora de hoje (para comparação justa)
    semana_1 AS (
      SELECT
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            ((SELECT inicio_hoje FROM op_start) - INTERVAL '7 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '7 days')
        ) AS total,
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            (((SELECT ts FROM brt_now) - INTERVAL '2 hours') AT TIME ZONE 'UTC' - INTERVAL '7 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '7 days')
        ) AS duas_horas
      FROM base b
    ),
    semana_2 AS (
      SELECT
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            ((SELECT inicio_hoje FROM op_start) - INTERVAL '14 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '14 days')
        ) AS total,
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            (((SELECT ts FROM brt_now) - INTERVAL '2 hours') AT TIME ZONE 'UTC' - INTERVAL '14 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '14 days')
        ) AS duas_horas
      FROM base b
    ),
    semana_3 AS (
      SELECT
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            ((SELECT inicio_hoje FROM op_start) - INTERVAL '21 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '21 days')
        ) AS total,
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            (((SELECT ts FROM brt_now) - INTERVAL '2 hours') AT TIME ZONE 'UTC' - INTERVAL '21 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '21 days')
        ) AS duas_horas
      FROM base b
    ),
    semana_4 AS (
      SELECT
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            ((SELECT inicio_hoje FROM op_start) - INTERVAL '28 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '28 days')
        ) AS total,
        COUNT(*) FILTER (
          WHERE b.datainicialdaocupacao >=
            (((SELECT ts FROM brt_now) - INTERVAL '2 hours') AT TIME ZONE 'UTC' - INTERVAL '28 days')
            AND b.datainicialdaocupacao <=
            ((SELECT ts FROM brt_now) AT TIME ZONE 'UTC' - INTERVAL '28 days')
        ) AS duas_horas
      FROM base b
    ),
    -- Quantas semanas históricas têm dados (total > 0)
    n_hist AS (
      SELECT (
        CASE WHEN s1.total > 0 THEN 1 ELSE 0 END +
        CASE WHEN s2.total > 0 THEN 1 ELSE 0 END +
        CASE WHEN s3.total > 0 THEN 1 ELSE 0 END +
        CASE WHEN s4.total > 0 THEN 1 ELSE 0 END
      ) AS n
      FROM semana_1 s1, semana_2 s2, semana_3 s3, semana_4 s4
    )
    SELECT
      h.total        AS hoje_total,
      h.duas_horas   AS hoje_2h,
      s1.total       AS historico_total_1,
      s2.total       AS historico_total_2,
      s3.total       AS historico_total_3,
      s4.total       AS historico_total_4,
      s1.duas_horas  AS historico_2h_1,
      s2.duas_horas  AS historico_2h_2,
      s3.duas_horas  AS historico_2h_3,
      s4.duas_horas  AS historico_2h_4,
      n_hist.n       AS n_historico
    FROM hoje h, semana_1 s1, semana_2 s2, semana_3 s3, semana_4 s4, n_hist
  `

  try {
    const { rows } = await pool.query<RawRow>(sql)
    const r = rows[0]
    if (!r) return null

    const hojeTotal  = Number(r.hoje_total)  || 0
    const hoje2h     = Number(r.hoje_2h)     || 0
    const nHistorico = Number(r.n_historico) || 0

    // Média histórica considerando apenas semanas com dados (total > 0)
    const histTotals = [r.historico_total_1, r.historico_total_2, r.historico_total_3, r.historico_total_4]
      .map(Number).filter((v) => v > 0)
    const hist2hs = [r.historico_2h_1, r.historico_2h_2, r.historico_2h_3, r.historico_2h_4]
      .map(Number).filter((_, i) => Number([r.historico_total_1, r.historico_total_2, r.historico_total_3, r.historico_total_4][i]) > 0)

    const historicoMedio = histTotals.length
      ? histTotals.reduce((a, b) => a + b, 0) / histTotals.length
      : 0
    const historico2hMedio = hist2hs.length
      ? hist2hs.reduce((a, b) => a + b, 0) / hist2hs.length
      : 0

    const paceRatio   = historicoMedio  > 0 ? hojeTotal / historicoMedio   : null
    const paceRatio2h = historico2hMedio > 0 ? hoje2h  / historico2hMedio : null

    // Sinal consolidado: usa o pior dos dois ratios (mais conservador)
    const worstRatio = paceRatio2h !== null && paceRatio !== null
      ? Math.min(paceRatio, paceRatio2h)
      : (paceRatio ?? paceRatio2h)

    // Hora e dia BRT para contexto
    const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))

    return {
      hoje_total:        hojeTotal,
      historico_medio:   Math.round(historicoMedio * 10) / 10,
      hoje_2h:           hoje2h,
      historico_2h_medio: Math.round(historico2hMedio * 10) / 10,
      dia_semana:        nowBRT.getDay(),
      hora_atual:        nowBRT.getHours(),
      pace_ratio:        paceRatio !== null ? Math.round(paceRatio * 100) / 100 : null,
      pace_ratio_2h:     paceRatio2h !== null ? Math.round(paceRatio2h * 100) / 100 : null,
      signal:            toSignal(worstRatio),
      n_historico:       nHistorico,
    }
  } catch (e) {
    console.error('[reservation-pace]', e)
    return null
  }
}

// ── Forward pickup: reservas confirmadas para os próximos 7 dias ─────────────

export interface WeeklyPickupRow {
  date: string        // DD/MM/YYYY
  dow_label: string   // "Seg", "Ter", etc.
  confirmed: number
  historical_avg: number
  signal: 'alto' | 'normal' | 'baixo'
}

export interface WeeklyPickupResult {
  rows: WeeklyPickupRow[]
}

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function pickupSignal(confirmed: number, avg: number): 'alto' | 'normal' | 'baixo' {
  if (avg === 0) return confirmed > 0 ? 'alto' : 'normal'
  const ratio = confirmed / avg
  if (ratio >= 1.2) return 'alto'
  if (ratio <= 0.7) return 'baixo'
  return 'normal'
}

/**
 * Retorna reservas confirmadas para os próximos 7 dias vs média histórica
 * por dia da semana (últimas 8 semanas). Não usa catIds — pool é por empresa.
 */
export async function getWeeklyPickup(unitSlug: string): Promise<WeeklyPickupResult | null> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return null

  const sql = `
    WITH upcoming AS (
      SELECT gs::date AS check_in_date
      FROM generate_series(
        CURRENT_DATE + 1,
        CURRENT_DATE + 7,
        '1 day'::interval
      ) AS gs
    ),
    confirmed AS (
      SELECT r.dataatendimento::date AS check_in_date, COUNT(*) AS reservas
      FROM reserva r
      WHERE r.dataatendimento::date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7
        AND r.cancelada IS NULL
      GROUP BY 1
    ),
    hist_by_day AS (
      SELECT
        EXTRACT(DOW FROM r.dataatendimento)::int AS dow,
        r.dataatendimento::date AS dia,
        COUNT(*) AS reservas_do_dia
      FROM reserva r
      WHERE r.dataatendimento::date BETWEEN CURRENT_DATE - 56 AND CURRENT_DATE - 1
        AND r.cancelada IS NULL
      GROUP BY 1, 2
    ),
    hist_avg AS (
      SELECT dow, ROUND(AVG(reservas_do_dia), 1) AS media
      FROM hist_by_day
      GROUP BY dow
    )
    SELECT
      u.check_in_date,
      EXTRACT(DOW FROM u.check_in_date)::int AS dow,
      COALESCE(c.reservas, 0)::int AS confirmed,
      COALESCE(h.media, 0)::numeric AS historical_avg
    FROM upcoming u
    LEFT JOIN confirmed c ON c.check_in_date = u.check_in_date
    LEFT JOIN hist_avg   h ON h.dow = EXTRACT(DOW FROM u.check_in_date)::int
    ORDER BY u.check_in_date
  `

  try {
    const { rows } = await pool.query<{
      check_in_date: Date; dow: string; confirmed: string; historical_avg: string
    }>(sql)

    return {
      rows: rows.map((r) => {
        const dow = Number(r.dow)
        const confirmed = Number(r.confirmed)
        const historical_avg = Number(r.historical_avg)
        const d = new Date(r.check_in_date)
        const dd = String(d.getUTCDate()).padStart(2, '0')
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        return {
          date: `${dd}/${mm}`,
          dow_label: DOW_SHORT[dow] ?? '?',
          confirmed,
          historical_avg,
          signal: pickupSignal(confirmed, historical_avg),
        }
      }),
    }
  } catch (e) {
    console.error('[weekly-pickup]', e)
    return null
  }
}

export function buildPickupBlock(pickup: WeeklyPickupResult | null): string {
  if (!pickup?.rows.length) return ''

  const SIGNAL_ICON: Record<string, string> = {
    alto:   '🟢',
    normal: '⚪',
    baixo:  '🔴',
  }

  const lines = [
    '## Antecipação de reservas — próximos 7 dias',
    'Reservas já confirmadas no sistema vs média histórica do mesmo dia da semana (últimas 8 semanas).',
    '',
    '| Data | Dia | Confirmadas | Média histórica | Sinal |',
    '|------|-----|-------------|-----------------|-------|',
    ...pickup.rows.map((r) =>
      `| ${r.date} | ${r.dow_label} | ${r.confirmed} | ${r.historical_avg} | ${SIGNAL_ICON[r.signal]} ${r.signal} |`
    ),
    '',
    '> Em motéis, a maioria das reservas é feita no mesmo dia — baixa antecipação é normal. Use como sinal de tendência, não como previsão definitiva.',
  ]

  return lines.join('\n')
}

const DIAS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

const SIGNAL_LABELS: Record<PaceSignal, string> = {
  acima:       '🟢 ACIMA do normal (+15% ou mais)',
  normal:      '⚪ No ritmo normal (±15%)',
  abaixo:      '🟡 ABAIXO do normal (−15% a −40%)',
  muito_abaixo:'🔴 MUITO ABAIXO do normal (−40% ou mais)',
}

/**
 * Formata o resultado de pace como bloco markdown para o system prompt do agente.
 * Retorna string vazia se sem dados (n_historico = 0 e sem check-ins hoje).
 */
export function buildPaceBlock(pace: ReservationPaceResult | null): string {
  if (!pace) return ''
  if (pace.n_historico === 0 && pace.hoje_total === 0) return ''

  const hora = String(pace.hora_atual).padStart(2, '0') + ':00'
  const dia  = DIAS_PT[pace.dia_semana] ?? 'hoje'

  const ratioStr = pace.pace_ratio !== null
    ? `${Math.round(pace.pace_ratio * 100)}%`
    : 'sem histórico'
  const ratio2hStr = pace.pace_ratio_2h !== null
    ? `${Math.round(pace.pace_ratio_2h * 100)}%`
    : 'sem histórico'

  const histNote = pace.n_historico > 0
    ? `(média de ${pace.n_historico} ${pace.n_historico === 1 ? 'semana' : 'semanas'} anteriores)`
    : '(sem histórico suficiente para comparação)'

  const lines = [
    `## Ritmo de check-ins hoje (pace) — ${dia}, ${hora} BRT`,
    '',
    `| Janela | Hoje | Média histórica ${histNote} | Pace |`,
    `|--------|------|------|------|`,
    `| Desde 06h | ${pace.hoje_total} check-ins | ${pace.historico_medio} | ${ratioStr} |`,
    `| Últimas 2h | ${pace.hoje_2h} check-ins | ${pace.historico_2h_medio} | ${ratio2hStr} |`,
    '',
    `**Status:** ${SIGNAL_LABELS[pace.signal]}`,
  ]

  if (pace.signal === 'muito_abaixo') {
    lines.push('> ⚠️ Ritmo muito abaixo do normal: avalie incentivo de preço temporário ou promoção relâmpago.')
  } else if (pace.signal === 'abaixo') {
    lines.push('> Ritmo abaixo do esperado: monitore a próxima hora e considere ajuste se persistir.')
  } else if (pace.signal === 'acima') {
    lines.push('> Ritmo acima do normal: avalie se há margem para subir preços imediatamente.')
  }

  return lines.join('\n')
}
