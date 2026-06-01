import { getAutomPool, getUnitCategoryIds } from './client'

export type DayFaixa = 'diurno' | 'noturno'

export interface DayTimeDemandRow {
  dow: number        // 0=Dom, 1=Seg, ..., 6=Sáb
  dia_nome: string   // 'Domingo', 'Segunda', ...
  faixa: DayFaixa
  avg_locacoes: number
}

const DOW_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// Ordem de exibição: Seg → Dom
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]

export async function getDayTimeDemand(unitSlug: string, weeks = 8): Promise<DayTimeDemandRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []
  const catIds = await getUnitCategoryIds(unitSlug)
  if (!catIds.length) return []

  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - weeks * 7)

  const catIdsLiteral = catIds.join(',')
  const { rows } = await pool.query<{
    dow: string
    faixa: string
    total_locacoes: string
    total_dias: string
  }>(
    `SELECT
       EXTRACT(DOW FROM la.datainicialdaocupacao)::integer AS dow,
       CASE
         WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) >= 6
              AND EXTRACT(HOUR FROM la.datainicialdaocupacao) < 18
         THEN 'diurno' ELSE 'noturno'
       END AS faixa,
       COUNT(*) AS total_locacoes,
       COUNT(DISTINCT la.datainicialdaocupacao::date) AS total_dias
     FROM locacaoapartamento la
     INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
     INNER JOIN apartamento a        ON aps.id_apartamento = a.id
     INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
     WHERE ca.id IN (${catIdsLiteral})
       AND la.datainicialdaocupacao >= $1
       AND la.datainicialdaocupacao < $2
       AND la.fimocupacaotipo IS NOT NULL
     GROUP BY dow, faixa
     ORDER BY dow, faixa`,
    [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
  )

  return rows.map((r) => ({
    dow: Number(r.dow),
    dia_nome: DOW_NAMES[Number(r.dow)] ?? `DOW${r.dow}`,
    faixa: r.faixa as DayFaixa,
    avg_locacoes: Number(r.total_locacoes) / Math.max(1, Number(r.total_dias)),
  }))
}

export function buildDayTimeDemandBlock(data: DayTimeDemandRow[], weeks = 8): string {
  if (!data.length) return ''

  const byDow = new Map<number, { diurno?: number; noturno?: number }>()
  for (const r of data) {
    if (!byDow.has(r.dow)) byDow.set(r.dow, {})
    byDow.get(r.dow)![r.faixa] = r.avg_locacoes
  }

  const tableRows = DOW_ORDER
    .map((dow) => ({ dow, nome: DOW_NAMES[dow], ...byDow.get(dow) }))
    .filter((r) => r.diurno !== undefined || r.noturno !== undefined)

  const lines = tableRows.map(
    (r) =>
      `| ${(r.nome ?? '').padEnd(8)} | ${(r.diurno ?? 0).toFixed(1).padStart(4)} | ${(r.noturno ?? 0).toFixed(1).padStart(4)} |`,
  )

  return `## Padrão de demanda por dia × faixa horária (últimas ${weeks} semanas)

Use esta tabela para decidir agrupamentos de dias e diferenciação de preço diurno/noturno.
Valores = locações médias por dia naquela faixa.

| Dia      | 06:00–17:59 | 18:00–05:59 |
|----------|-------------|-------------|
${lines.join('\n')}

> **Interpretação:** dias com diferença < 0,3 loc/dia entre si são candidatos a agrupamento no mesmo preço. Diferença > 0,8 entre faixas diurna/noturna justifica preço distinto para o mesmo dia.`
}
