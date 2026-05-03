/**
 * Blocos de contexto compartilhados entre chat (`/api/agente/chat`) e
 * geração de propostas (`/api/agente/proposals`). Centralizar aqui evita
 * "amnésia situacional" — quando o gerente pergunta no chat sobre algo
 * que o agente sabe ao gerar proposta (ou vice-versa).
 *
 * Funções stateless puras: recebem dados já buscados, retornam string markdown.
 */

import type { CompanyKPIResponse } from '@/lib/kpis/types'

// ─── Pricing thresholds (regras de ajuste dinâmico configuradas pelo gestor) ─

export interface PricingThresholds {
  giro_high?: number | null
  giro_low?: number | null
  ocupacao_high?: number | null
  ocupacao_low?: number | null
  adjustment_pct?: number | null
}

export function buildPricingThresholdsBlock(t: PricingThresholds | null | undefined): string {
  if (!t) return ''
  const pct = t.adjustment_pct ?? 10
  const lines: string[] = []
  if (t.giro_high != null)     lines.push(`- Giro > ${t.giro_high} em qualquer categoria/período → demanda aquecida, priorize aumento de ~${pct}%`)
  if (t.giro_low  != null)     lines.push(`- Giro < ${t.giro_low} em qualquer categoria/período → demanda fraca, avalie redução de ~${pct}% para estimular volume`)
  if (t.ocupacao_high != null) lines.push(`- Taxa de ocupação > ${t.ocupacao_high}% → demanda inelástica, aumente preço em ~${pct}%`)
  if (t.ocupacao_low  != null) lines.push(`- Taxa de ocupação < ${t.ocupacao_low}% → demanda elástica, avalie redução de ~${pct}% ou pacote promocional`)
  if (!lines.length) return ''
  return `## Regras de ajuste dinâmico configuradas pelo gestor
Aplique estas regras ao diagnosticar e ao propor preços:
${lines.join('\n')}`
}

// ─── Shared context (texto livre cadastrado pelo gestor) ─────────────────────

export function buildSharedContextBlock(text: string | null | undefined): string {
  if (!text || !text.trim()) return ''
  return `## Contexto estratégico da unidade (compartilhado)
${text.trim()}`
}

// ─── Guardrails (limites de preço — bloco textual para o agente) ─────────────

interface GuardrailRow {
  categoria: string
  periodo: string
  dia_tipo?: string | null
  preco_minimo: number
  preco_maximo: number
}

const DIA_GUARDRAIL_LABEL: Record<string, string> = {
  todos: 'Semana + FDS',
  semana: 'Semana',
  fds_feriado: 'FDS/Feriado',
}

export function buildGuardrailsBlock(rows: GuardrailRow[] | null | undefined): string {
  if (!rows || !rows.length) return ''
  const lines = rows.map((g) =>
    `| ${g.categoria} | ${g.periodo} | ${DIA_GUARDRAIL_LABEL[g.dia_tipo ?? 'todos'] ?? 'Todos'} | R$ ${g.preco_minimo.toFixed(2)} | R$ ${g.preco_maximo.toFixed(2)} |`
  ).join('\n')
  return `## Guardrails de preço configurados pelo gestor

| Categoria | Período | Dia | Preço Mínimo | Preço Máximo |
|-----------|---------|-----|-------------|-------------|
${lines}

> Estes são os limites mínimo/máximo para cada combinação. Considere-os ao discutir preços; nas propostas, valores fora do intervalo são ajustados automaticamente ao limite.`
}

// ─── Memória estratégica (últimas propostas aprovadas + delta KPI) ────────────

interface ProposalLite {
  rows: unknown
  context: string | null
  reviewed_at: string | null
  kpi_baseline?: unknown
}

interface ProposedRowLite {
  canal: string
  categoria: string
  periodo: string
  dia_tipo: string
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
}

const CANAL_LABELS_MEM: Record<string, string> = {
  balcao_site:    'Balcão/Site',
  site_programada:'Site Programada',
  guia_moteis:    'Guia de Motéis',
}

/**
 * Bloco de memória estratégica: lista as últimas propostas aprovadas com Δ%
 * e — quando há kpi_baseline (LHG-156) — comparação justa antes/depois em
 * janela igual. Sem baseline, usa fallback enviesado e marca como "cautelosa".
 */
export function buildStrategicMemoryBlock(
  history: ProposalLite[],
  kpiAfter: CompanyKPIResponse | null,
  kpiBefore: CompanyKPIResponse | null,
): string {
  const relevant = history.filter((p) =>
    Array.isArray(p.rows) && (p.rows as ProposedRowLite[]).some((r) => Math.abs(r.variacao_pct) >= 1)
  )
  if (!relevant.length) return ''

  function fmtBRL(n: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
  }
  function delta(a: number, b: number) {
    if (!b) return '—'
    const pct = ((a - b) / b) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }

  let impactBlock = ''
  type BaselineLike = {
    window_days?: number
    kpis?: { total?: { revpar?: number; trevpar?: number; giro?: number; ocupacao?: number; ticket?: number } }
  }
  const lastApproved = relevant[0]
  const lastBaseline = (lastApproved.kpi_baseline ?? null) as BaselineLike | null
  const baselineTotal = lastBaseline?.kpis?.total

  if (kpiAfter && baselineTotal) {
    const af = kpiAfter.TotalResult
    const bf = {
      revpar:   baselineTotal.revpar   ?? 0,
      trevpar:  baselineTotal.trevpar  ?? 0,
      giro:     baselineTotal.giro     ?? 0,
      ocupacao: baselineTotal.ocupacao ?? 0,
      ticket:   baselineTotal.ticket   ?? 0,
    }
    impactBlock = `### Resultado observado após última mudança de tabela _(janela igual de ${lastBaseline?.window_days ?? 28} dias — comparação confiável)_
| KPI | Antes (baseline) | Depois | Δ |
|-----|------------------|--------|---|
| RevPAR | ${fmtBRL(bf.revpar)} | ${fmtBRL(af.totalRevpar)} | **${delta(af.totalRevpar, bf.revpar)}** |
| TRevPAR | ${fmtBRL(bf.trevpar)} | ${fmtBRL(af.totalTrevpar)} | **${delta(af.totalTrevpar, bf.trevpar)}** |
| Giro | ${bf.giro.toFixed(2)} | ${af.totalGiro.toFixed(2)} | **${delta(af.totalGiro, bf.giro)}** |
| Ocupação | ${bf.ocupacao.toFixed(1)}% | ${af.totalOccupancyRate.toFixed(1)}% | **${delta(af.totalOccupancyRate, bf.ocupacao)}** |
| Ticket Médio | ${fmtBRL(bf.ticket)} | ${fmtBRL(af.totalAllTicketAverage)} | **${delta(af.totalAllTicketAverage, bf.ticket)}** |

> Comparação contra baseline congelado no momento da aprovação. Use para calibrar a próxima proposta com confiança.

`
  } else if (kpiAfter && kpiBefore) {
    const af = kpiAfter.TotalResult
    const bf = kpiBefore.TotalResult
    impactBlock = `### Resultado observado após última mudança de tabela _(janelas diferentes — interpretação cautelosa)_
| KPI | Antes | Depois | Δ |
|-----|-------|--------|---|
| RevPAR | ${fmtBRL(bf.totalRevpar)} | ${fmtBRL(af.totalRevpar)} | **${delta(af.totalRevpar, bf.totalRevpar)}** |
| TRevPAR | ${fmtBRL(bf.totalTrevpar)} | ${fmtBRL(af.totalTrevpar)} | **${delta(af.totalTrevpar, bf.totalTrevpar)}** |
| Giro | ${bf.totalGiro.toFixed(2)} | ${af.totalGiro.toFixed(2)} | **${delta(af.totalGiro, bf.totalGiro)}** |
| Ocupação | ${bf.totalOccupancyRate.toFixed(1)}% | ${af.totalOccupancyRate.toFixed(1)}% | **${delta(af.totalOccupancyRate, bf.totalOccupancyRate)}** |
| Ticket Médio | ${fmtBRL(bf.totalAllTicketAverage)} | ${fmtBRL(af.totalAllTicketAverage)} | **${delta(af.totalAllTicketAverage, bf.totalAllTicketAverage)}** |

> ⚠️ Comparação entre vigências de durações diferentes — pode ter viés de sazonalidade.

`
  }

  const blocks = relevant.map((p, idx) => {
    const date = p.reviewed_at
      ? new Date(p.reviewed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '?'
    const changed = ((p.rows as ProposedRowLite[]) ?? []).filter((r) => Math.abs(r.variacao_pct) >= 1)
    const tableLines = changed.map((r) =>
      `| ${r.categoria} | ${r.periodo} | ${CANAL_LABELS_MEM[r.canal] ?? r.canal} | ` +
      `${r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos'} | ` +
      `R$ ${r.preco_atual.toFixed(2)} | R$ ${r.preco_proposto.toFixed(2)} | ` +
      `${r.variacao_pct > 0 ? '+' : ''}${r.variacao_pct.toFixed(1)}% |`
    ).join('\n')
    const rank = idx === 0 ? 'mais recente' : `${idx + 1}ª mais recente`
    return `### Proposta aprovada em ${date} (${rank})
${p.context ? `Contexto: ${p.context}` : ''}

Alterações aplicadas (${changed.length} item${changed.length !== 1 ? 'ns' : ''}):
| Categoria | Período | Canal | Dia | Preço anterior | Preço novo | Δ% |
|-----------|---------|-------|-----|----------------|------------|-----|
${tableLines}`
  }).join('\n\n---\n\n')

  return `## Memória estratégica — ${relevant.length} proposta(s) aprovada(s) recentemente

${impactBlock}${blocks}`
}
