/**
 * Bloco de "Estrutura da unidade" injetado no system prompt do agente.
 * Inclui capacidade instalada por categoria (n_suítes + custo variável)
 * e comissões por canal de venda. Usado em chat e propostas.
 *
 * Sem este bloco, o agente teria que perguntar ao usuário o total de suítes
 * a cada conversa, o que é absurdo num agente de Revenue Management.
 */

export interface UnitCapacityRow {
  categoria: string
  n_suites: number
  custo_variavel_locacao: number
  notes?: string | null
}

export interface UnitChannelCostRow {
  canal: string
  comissao_pct: number
  taxa_fixa: number
}

const CANAL_LABEL: Record<string, string> = {
  balcao_site:     'Balcão / Site Imediato',
  site_programada: 'Site Programada',
  guia_moteis:     'Guia de Motéis',
  booking:         'Booking.com',
  expedia:         'Expedia',
  outros:          'Outros',
}

export function buildUnitStructureBlock(
  capacity: UnitCapacityRow[],
  channelCosts: UnitChannelCostRow[],
): string {
  if (!capacity.length && !channelCosts.length) return ''

  const totalSuites = capacity.reduce((acc, r) => acc + r.n_suites, 0)
  const sections: string[] = []

  if (capacity.length) {
    const rows = capacity
      .map((r) => `- ${r.categoria}: ${r.n_suites} suíte${r.n_suites !== 1 ? 's' : ''} (custo variável R$ ${r.custo_variavel_locacao.toFixed(2)}/locação${r.notes ? ` — ${r.notes}` : ''})`)
      .join('\n')
    sections.push(`**Capacidade instalada (total: ${totalSuites} suítes):**\n${rows}`)
  }

  if (channelCosts.length) {
    const rows = channelCosts
      .map((r) => {
        const taxa = r.taxa_fixa > 0 ? ` + R$ ${r.taxa_fixa.toFixed(2)} fixo` : ''
        return `- ${CANAL_LABEL[r.canal] ?? r.canal}: ${r.comissao_pct.toFixed(1)}%${taxa}`
      })
      .join('\n')
    sections.push(`**Comissões por canal (impacto na margem líquida):**\n${rows}`)
  }

  return `## Estrutura da unidade

${sections.join('\n\n')}

> Use estes dados para cálculos de margem e nunca pergunte ao usuário o total de suítes ou comissões — eles estão acima.`
}
