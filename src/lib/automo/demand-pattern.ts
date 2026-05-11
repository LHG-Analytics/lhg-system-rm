import { getAutomPool, getUnitCategoryIds } from './client'

export interface DemandPatternRow {
  dia_semana: string
  faixa_horaria: string
  locacoes: number
  share_pct: number
}

export interface DemandPatternResult {
  rows: DemandPatternRow[]
  totalLocacoes: number
  lowDemandSlots: string[]
  highDemandSlots: string[]
  /** Nomes dos dias com demanda acima de 120% da média — candidatos a tier extra */
  highDemandDays: string[]
  /** Ratio (FDS+Dom) ÷ (Seg–Qui) para calibrar o premium de FDS */
  fdsSemanaRatio: number | null
}

const DOW_LABEL: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
}
const FDS_DAYS = new Set(['sexta', 'sabado', 'domingo'])
const SEMANA_DAYS = new Set(['segunda', 'terca', 'quarta', 'quinta'])

export async function queryDemandPattern(
  unitSlug: string,
  days = 60,
): Promise<DemandPatternResult | null> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return null

  const categoryIds = await getUnitCategoryIds(unitSlug)
  if (!categoryIds.length) return null

  const idList = categoryIds.join(',')
  const sql = `
    WITH slots AS (
      SELECT
        EXTRACT(DOW FROM la.datainicialdaocupacao)::int AS dow,
        CASE
          WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 6  THEN '00:00-05:59'
          WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 12 THEN '06:00-11:59'
          WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 18 THEN '12:00-17:59'
          ELSE '18:00-23:59'
        END AS faixa,
        COUNT(*) AS locacoes
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= CURRENT_DATE - INTERVAL '${days} days'
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${idList})
      GROUP BY 1, 2
    )
    SELECT
      CASE dow
        WHEN 0 THEN 'domingo' WHEN 1 THEN 'segunda' WHEN 2 THEN 'terca'
        WHEN 3 THEN 'quarta'  WHEN 4 THEN 'quinta'  WHEN 5 THEN 'sexta'
        WHEN 6 THEN 'sabado'
      END AS dia_semana,
      faixa AS faixa_horaria,
      SUM(locacoes)::int AS locacoes,
      ROUND(SUM(locacoes) * 100.0 / SUM(SUM(locacoes)) OVER (), 1) AS share_pct
    FROM slots
    GROUP BY dow, faixa
    ORDER BY dow, faixa
  `

  const result = await pool.query<DemandPatternRow>(sql)
  if (!result.rows.length) return null

  const rows = result.rows
  const totalLocacoes = rows.reduce((acc, r) => acc + r.locacoes, 0)
  const avgShare = 100 / rows.length

  const lowDemandSlots = rows
    .filter(r => r.share_pct < avgShare * 0.7)
    .map(r => `${r.dia_semana} ${r.faixa_horaria} (${r.share_pct}%)`)

  const highDemandSlots = rows
    .filter(r => r.share_pct > avgShare * 1.4)
    .map(r => `${r.dia_semana} ${r.faixa_horaria} (${r.share_pct}%)`)

  // Dias com demanda total acima de 120% da média entre os 7 dias
  const byDay = new Map<string, number>()
  for (const r of rows) {
    byDay.set(r.dia_semana, (byDay.get(r.dia_semana) ?? 0) + r.locacoes)
  }
  const avgDay = totalLocacoes / 7
  const highDemandDays = [...byDay.entries()]
    .filter(([, loc]) => loc > avgDay * 1.2)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)

  // Ratio FDS ÷ Semana (locações por dia)
  let fdsTotal = 0, fdsCount = 0, semanaTotal = 0, semanaCount = 0
  for (const [dia, loc] of byDay.entries()) {
    if (FDS_DAYS.has(dia))    { fdsTotal += loc; fdsCount++ }
    if (SEMANA_DAYS.has(dia)) { semanaTotal += loc; semanaCount++ }
  }
  const fdsSemanaRatio =
    fdsCount > 0 && semanaCount > 0 && semanaTotal > 0
      ? (fdsTotal / fdsCount) / (semanaTotal / semanaCount)
      : null

  // Sort rows by DOW order then faixa
  rows.sort((a, b) => {
    const dowA = DOW_LABEL[a.dia_semana] ?? 0
    const dowB = DOW_LABEL[b.dia_semana] ?? 0
    if (dowA !== dowB) return dowA - dowB
    return a.faixa_horaria.localeCompare(b.faixa_horaria)
  })

  return { rows, totalLocacoes, lowDemandSlots, highDemandSlots, highDemandDays, fdsSemanaRatio }
}

export function buildDemandPatternBlock(pattern: DemandPatternResult, unitName: string, days: number): string {
  const lines = [
    `## Padrão de demanda por dia × faixa horária — ${unitName} (últimos ${days} dias · ${pattern.totalLocacoes} locações)`,
    '',
    '| Dia da Semana | Faixa Horária | Locações | Share % |',
    '|---------------|---------------|----------|---------|',
    ...pattern.rows.map(r =>
      `| ${r.dia_semana} | ${r.faixa_horaria} | ${r.locacoes} | ${r.share_pct}% |`
    ),
  ]

  if (pattern.fdsSemanaRatio !== null) {
    lines.push(`\n**Ratio FDS÷Semana:** ${pattern.fdsSemanaRatio.toFixed(2)}x — ${
      pattern.fdsSemanaRatio >= 1.5 ? 'diferencial de demanda alto → premium FDS justificado'
      : pattern.fdsSemanaRatio >= 1.2 ? 'diferencial moderado → avaliar premium entre 15–30%'
      : 'demanda similar → split semana/FDS pode não ser suficiente para preços muito diferentes'
    }`)
  }

  if (pattern.highDemandDays.length > 0) {
    lines.push(`**Dias com demanda acima da média (>120%):** ${pattern.highDemandDays.join(', ')} — candidatos a tier de preço próprio`)
  }

  if (pattern.lowDemandSlots.length > 0) {
    lines.push(`🔵 **Baixa demanda** (estímulo de preço / desconto Guia mais agressivo): ${pattern.lowDemandSlots.join(', ')}`)
  }

  if (pattern.highDemandSlots.length > 0) {
    lines.push(`🟢 **Alta demanda** (preço mais agressivo / desconto Guia reduzido): ${pattern.highDemandSlots.join(', ')}`)
  }

  return lines.join('\n')
}
