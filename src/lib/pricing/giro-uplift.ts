/**
 * Gerador determinístico de preços pelo método "giro uplift" — replica a lógica da
 * planilha de RM da LIV (aba "Proposta Preços" / "Análise Giro").
 *
 * Regra do método (do chefe):
 *   fator[categoria, grupo_de_dias] = clamp(giro_do_grupo / giro_médio_da_categoria − 1, 0, teto)
 *   preço_proposto = round(preço_atual × (1 + fator))
 *   - NUNCA reduz (o clamp em [0, teto] garante fator ≥ 0).
 *   - O prêmio de pico (faixa 15h–21h) NÃO é aplicado aqui porque a tabela de preços
 *     persistida (canal×categoria×periodo×dia_tipo) não tem dimensão intraday. Fica para
 *     quando houver suporte a faixa horária na tabela (Fase 3).
 *
 * Giro por dia vem de DataTableGiroByWeek; giro médio da categoria de DataTableSuiteCategory.
 * Ambos já usam o corte operacional 06:00 e o denominador suítes-dia (consistente com o dashboard).
 */
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'

// dia_tipo do nosso modelo → dias da semana (nomes como em DataTableGiroByWeek, pt-BR completos)
const SEMANA_DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira']
const FDS_DAYS    = ['sexta-feira', 'sábado']
const ALL_DAYS    = [...SEMANA_DAYS, ...FDS_DAYS]

export interface GiroUpliftRow {
  canal:           string
  categoria:       string
  periodo:         string
  dia_tipo:        string
  preco_atual:     number
  preco_proposto:  number
  variacao_pct:    number
  fator_giro:      number   // fração aplicada (0..teto)
  giro_grupo:      number   // giro médio do grupo de dias
  giro_medio:      number   // giro médio da categoria
  justificativa:   string
}

export interface GiroUpliftParams {
  /** teto de reajuste de giro (fração, ex: 0.05 = 5%) */
  cap: number
  /** arredondamento: casas decimais do preço proposto (LIV usa 0 = dólar inteiro) */
  decimals?: number
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function norm(s: string) {
  return s.trim().toUpperCase()
}

/**
 * Calcula o preço-base do método giro_uplift para cada linha da tabela ativa.
 * Cobertura total: retorna uma linha para CADA entrada de activeRows.
 */
export function generateGiroUpliftRows(
  activeRows: ParsedPriceRow[],
  company: CompanyKPIResponse,
  params: GiroUpliftParams,
): GiroUpliftRow[] {
  const cap = params.cap > 0 ? params.cap : 0.05
  const decimals = params.decimals ?? 0
  const factor = Math.pow(10, decimals)
  const round = (v: number) => Math.round(v * factor) / factor

  // giro médio por categoria (DataTableSuiteCategory é Array<Record<cat, KPI>>)
  const giroMedio = new Map<string, number>()
  for (const item of company.DataTableSuiteCategory ?? []) {
    for (const [cat, kpi] of Object.entries(item)) {
      giroMedio.set(norm(cat), kpi.giro)
    }
  }

  // giro por categoria × dia da semana (DataTableGiroByWeek é Array<Record<cat, Record<dia, {giro}>>>)
  const giroByDay = new Map<string, Record<string, number>>()
  for (const item of company.DataTableGiroByWeek ?? []) {
    for (const [cat, days] of Object.entries(item)) {
      const m: Record<string, number> = {}
      for (const [dia, v] of Object.entries(days)) m[dia] = v.giro
      giroByDay.set(norm(cat), m)
    }
  }

  function avgGiro(catKey: string, dias: string[]): number {
    const days = giroByDay.get(catKey)
    if (!days) return 0
    const vals = dias.map((d) => days[d]).filter((v): v is number => typeof v === 'number' && v > 0)
    if (!vals.length) return 0
    return vals.reduce((s, v) => s + v, 0) / vals.length
  }

  return activeRows.map((row) => {
    const catKey = norm(row.categoria)
    const dias =
      row.dia_tipo === 'fds_feriado' ? FDS_DAYS :
      row.dia_tipo === 'semana'      ? SEMANA_DAYS :
      ALL_DAYS
    const giroMed   = giroMedio.get(catKey) ?? 0
    const giroGrupo = avgGiro(catKey, dias)
    const fator     = giroMed > 0 ? clamp(giroGrupo / giroMed - 1, 0, cap) : 0
    const precoAtual    = Number(row.preco) || 0
    const precoProposto = round(precoAtual * (1 + fator))
    const variacao      = precoAtual > 0 ? +((precoProposto - precoAtual) / precoAtual * 100).toFixed(1) : 0

    const justificativa = fator > 0
      ? `Giro ${giroGrupo.toFixed(2)} > média ${giroMed.toFixed(2)} da categoria → +${(fator * 100).toFixed(1)}% (teto ${(cap * 100).toFixed(0)}%)`
      : `Giro ${giroGrupo.toFixed(2)} ≤ média ${giroMed.toFixed(2)} → mantido (método nunca reduz)`

    return {
      canal:          row.canal,
      categoria:      row.categoria,
      periodo:        row.periodo,
      dia_tipo:       row.dia_tipo,
      preco_atual:    precoAtual,
      preco_proposto: precoProposto,
      variacao_pct:   variacao,
      fator_giro:     +fator.toFixed(4),
      giro_grupo:     +giroGrupo.toFixed(3),
      giro_medio:     +giroMed.toFixed(3),
      justificativa,
    }
  })
}

/**
 * Bloco markdown com a REFERÊNCIA de uplift por giro — um insumo a mais que o agente
 * considera junto com KPIs, concorrentes e eventos (não é um modo separado nem um piso rígido).
 * Mostra, por item, quanto o giro daquele dia está acima da média da própria categoria.
 */
export function buildGiroUpliftBaselineBlock(
  rows: GiroUpliftRow[],
  fmtMoney: (n: number, decimals?: number) => string = (v) => `$ ${v.toFixed(0)}`,
): string {
  if (!rows.length) return ''
  const changed = rows.filter((r) => r.fator_giro > 0)
  if (!changed.length) return ''  // sem dias acima da média → referência não acrescenta nada
  const lines = [
    '## Referência de uplift por giro (insumo — não é piso obrigatório)',
    '> Sinaliza dias/categorias que giram acima da média da PRÓPRIA categoria — candidatos a aumento.',
    '> Use como UM dos insumos: cruze com concorrência, eventos e sazonalidade antes de decidir o preço final.',
    '> Mostra apenas os itens com giro acima da média; os demais não têm sinal de aumento por giro.',
    '',
    '| Canal | Categoria | Período | Dia | Atual | Sugestão giro | Δ% | Critério |',
    '|-------|-----------|---------|-----|-------|---------------|----|----------|',
    ...changed.map((r) =>
      `| ${r.canal} | ${r.categoria} | ${r.periodo} | ${r.dia_tipo} | ${fmtMoney(r.preco_atual)} | ${fmtMoney(r.preco_proposto)} | ${r.variacao_pct >= 0 ? '+' : ''}${r.variacao_pct}% | ${r.justificativa} |`
    ),
  ]
  return lines.join('\n')
}
