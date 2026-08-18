import type { CategoryPeriodKPIRow } from '@/lib/automo/category-period-kpis'
import type { DataTableGiroByWeek } from '@/lib/kpis/types'

/**
 * Motor de detecção de oportunidades para o relatório semanal.
 *
 * Deliberadamente NÃO usa IA aqui — cada oportunidade é um desvio numérico
 * calculado a partir dos dados que o sistema já tem (categoria × período,
 * categoria × turno, categoria × dia da semana). A IA só escreve o resumo
 * executivo em cima dessa lista; ela nunca inventa os números.
 */

export type OpportunityDimension = 'periodo' | 'turno' | 'dia_semana'
export type OpportunityDirection = 'below' | 'above'

export interface Opportunity {
  dimension:      OpportunityDimension
  categoria:      string
  /** Rótulo do recorte: nome do período, do turno ou do dia da semana */
  label:          string
  metric:         'giro' | 'revpar'
  value:          number
  benchmarkValue: number
  /** (value - benchmark) / benchmark × 100 — negativo = abaixo do esperado */
  gapPct:         number
  direction:      OpportunityDirection
  suggestion:     string
  /** Prompt sugerido para abrir a conversa certa no Agente RM (link montado depois, com unitSlug) */
  agentPrompt:    string
}

const MIN_GAP_PCT = 25       // só entra na lista se o desvio for de pelo menos 25%
const MIN_SAMPLE  = 3        // ignora recortes com poucas locações (ruído estatístico)

interface TurnoCategoryRow {
  categoria:  string
  turno:      string
  locacoes:   number
  giro:       number
  receita:    number
  capacidade: number
}

function pushIfSignificant(
  list: Opportunity[],
  dimension: OpportunityDimension,
  categoria: string,
  label: string,
  metric: 'giro' | 'revpar',
  value: number,
  benchmark: number,
  sample: number,
  fmtMoney: (v: number) => string,
) {
  if (benchmark <= 0 || sample < MIN_SAMPLE) return
  const gapPct = ((value - benchmark) / benchmark) * 100
  if (Math.abs(gapPct) < MIN_GAP_PCT) return

  const direction: OpportunityDirection = gapPct < 0 ? 'below' : 'above'
  const dimLabel = dimension === 'periodo' ? 'no período' : dimension === 'turno' ? 'no turno' : 'no dia'
  const metricLabel = metric === 'giro' ? 'giro' : 'RevPAR'
  const valueLabel = metric === 'giro' ? value.toFixed(2) : fmtMoney(value)
  const benchmarkLabel = metric === 'giro' ? benchmark.toFixed(2) : fmtMoney(benchmark)

  // Sem o nome da categoria aqui de propósito — quem renderiza (UI/e-mail) já mostra
  // a categoria como rótulo separado; incluir aqui duplicava o nome duas vezes.
  const suggestion = direction === 'below'
    ? `${label}: ${metricLabel} ${dimLabel} é ${Math.abs(gapPct).toFixed(0)}% menor que a referência de comparação (${valueLabel} vs ${benchmarkLabel}). Vale avaliar promoção, desconto extra ou reposicionamento de preço nesse recorte para estimular demanda.`
    : `${label}: ${metricLabel} ${dimLabel} é ${Math.abs(gapPct).toFixed(0)}% maior que a referência de comparação (${valueLabel} vs ${benchmarkLabel}). A demanda já está forte — há espaço para reajustar o preço nesse recorte sem perder volume.`

  const agentPrompt = direction === 'below'
    ? `Analisar por que ${categoria} tem ${metricLabel.toLowerCase()} mais baixo que a média ${dimLabel} (${label}) e propor uma ação para reduzir esse gap.`
    : `Avaliar se dá para aumentar o preço de ${categoria} ${dimLabel} (${label}), já que a demanda ali está ${Math.abs(gapPct).toFixed(0)}% acima da média da categoria.`

  list.push({ dimension, categoria, label, metric, value, benchmarkValue: benchmark, gapPct, direction, suggestion, agentPrompt })
}

/**
 * Categoria × período: compara o giro de cada período com a média (ponderada por
 * locações) da própria categoria nos demais períodos.
 */
function detectByPeriodo(rows: CategoryPeriodKPIRow[], fmtMoney: (v: number) => string): Opportunity[] {
  const out: Opportunity[] = []
  const byCategoria = new Map<string, CategoryPeriodKPIRow[]>()
  for (const r of rows) {
    if (!byCategoria.has(r.categoria)) byCategoria.set(r.categoria, [])
    byCategoria.get(r.categoria)!.push(r)
  }

  for (const [categoria, catRows] of byCategoria) {
    if (catRows.length < 2) continue // precisa de pelo menos 2 períodos para comparar
    const totalLocacoes = catRows.reduce((s, r) => s + r.locacoes, 0)
    if (totalLocacoes < MIN_SAMPLE) continue
    const avgGiro = catRows.reduce((s, r) => s + r.giro * r.locacoes, 0) / totalLocacoes

    for (const r of catRows) {
      pushIfSignificant(out, 'periodo', categoria, r.periodo, 'giro', r.giro, avgGiro, r.locacoes, fmtMoney)
    }
  }
  return out
}

/**
 * Categoria × turno: compara o giro de cada turno (Diurno/Noturno ou Pico/Fora)
 * com a média ponderada dos turnos daquela categoria.
 */
function detectByTurno(rows: TurnoCategoryRow[], fmtMoney: (v: number) => string): Opportunity[] {
  const out: Opportunity[] = []
  const byCategoria = new Map<string, TurnoCategoryRow[]>()
  for (const r of rows) {
    if (!byCategoria.has(r.categoria)) byCategoria.set(r.categoria, [])
    byCategoria.get(r.categoria)!.push(r)
  }

  for (const [categoria, catRows] of byCategoria) {
    if (catRows.length < 2) continue
    const totalLocacoes = catRows.reduce((s, r) => s + r.locacoes, 0)
    if (totalLocacoes < MIN_SAMPLE) continue
    const avgGiro = catRows.reduce((s, r) => s + r.giro * r.locacoes, 0) / totalLocacoes

    for (const r of catRows) {
      pushIfSignificant(out, 'turno', categoria, r.turno, 'giro', r.giro, avgGiro, r.locacoes, fmtMoney)
    }
  }
  return out
}

// FDS = sexta+sábado (mesma convenção usada em toda a precificação — day-band-grid.ts).
// Domingo entra em "semana": nas motéis o padrão de domingo já se parece mais com dia
// de semana do que com sexta/sábado.
const FDS_DAYS = new Set(['sexta-feira', 'sábado'])

/**
 * Categoria × dia da semana: usa a mesma tabela giro-por-categoria×dia já calculada
 * para o chat do agente (DataTableGiroByWeek) — sem query nova.
 *
 * Compara cada dia com a média do seu PRÓPRIO grupo (dias de semana entre si, FDS entre
 * si) — não com a média dos 7 dias juntos. Comparar com a média geral sempre aponta
 * "sábado/sexta estão acima da média" pra toda categoria, o que já é óbvio e não é uma
 * oportunidade de verdade — o sinal útil é um dia fora do padrão DENTRO do próprio grupo
 * (ex: quinta anormalmente fraca entre os dias de semana, ou sexta muito abaixo de sábado
 * dentro do FDS).
 */
function detectByDiaSemana(giroByWeek: DataTableGiroByWeek[], fmtMoney: (v: number) => string): Opportunity[] {
  const out: Opportunity[] = []

  for (const entry of giroByWeek) {
    for (const [categoria, days] of Object.entries(entry)) {
      const entries = Object.entries(days).filter(([, v]) => v.giro > 0)
      if (entries.length < 2) continue

      const groups = [
        entries.filter(([day]) => FDS_DAYS.has(day)),
        entries.filter(([day]) => !FDS_DAYS.has(day)),
      ]

      for (const group of groups) {
        if (group.length < 2) continue // precisa de ao menos 2 dias no mesmo grupo para comparar
        const avgGiro = group.reduce((s, [, v]) => s + v.giro, 0) / group.length
        for (const [dayName, v] of group) {
          // Sem contagem de locações aqui — usa MIN_SAMPLE=0 (giro>0 já indica que houve alguma locação)
          pushIfSignificant(out, 'dia_semana', categoria, dayName, 'giro', v.giro, avgGiro, MIN_SAMPLE, fmtMoney)
        }
      }
    }
  }
  return out
}

export function detectOpportunities(
  categoryPeriodKPIs: CategoryPeriodKPIRow[],
  turnoCategoryTable: TurnoCategoryRow[],
  giroByWeek: DataTableGiroByWeek[],
  fmtMoney: (v: number) => string,
  maxItems = 8,
): Opportunity[] {
  const all = [
    ...detectByPeriodo(categoryPeriodKPIs, fmtMoney),
    ...detectByTurno(turnoCategoryTable, fmtMoney),
    ...detectByDiaSemana(giroByWeek, fmtMoney),
  ]

  return all
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, maxItems)
}
