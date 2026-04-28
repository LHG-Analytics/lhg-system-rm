import type { SuiteAvailabilityRow } from '@/lib/automo/suite-availability'

/**
 * Bloco de "Estrutura da unidade" injetado no system prompt do agente.
 * Mescla:
 *   - Suítes disponíveis por categoria (Automo dinâmico, descontando bloqueios)
 *   - Custo variável por categoria + comissões por canal (cadastro manual)
 *
 * Sem este bloco, o agente teria que perguntar ao usuário o total de suítes
 * a cada conversa, o que é absurdo num agente de Revenue Management.
 */

export interface UnitCapacityRow {
  categoria: string
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
  availability: SuiteAvailabilityRow[],
  capacity: UnitCapacityRow[],
  channelCosts: UnitChannelCostRow[],
): string {
  if (!availability.length && !capacity.length && !channelCosts.length) return ''

  // Mapa categoria → custo variável (manual)
  const custoMap = new Map<string, { custo: number; notes: string | null }>()
  for (const c of capacity) {
    custoMap.set(c.categoria, { custo: c.custo_variavel_locacao, notes: c.notes ?? null })
  }

  const sections: string[] = []

  if (availability.length) {
    const totalDisponiveis = availability.reduce((acc, r) => acc + r.disponiveis, 0)
    const totalBloqueadas  = availability.reduce((acc, r) => acc + r.bloqueadas, 0)

    const rows = availability.map((r) => {
      const custoInfo = custoMap.get(r.categoria)
      const custoStr = custoInfo
        ? ` · custo variável R$ ${custoInfo.custo.toFixed(2)}/locação`
        : ''
      const notesStr = custoInfo?.notes ? ` — ${custoInfo.notes}` : ''
      const bloqueioInfo = r.bloqueadas > 0
        ? ` _(${r.bloqueadas} bloqueada${r.bloqueadas > 1 ? 's' : ''}${r.motivos_bloqueio.length ? ': ' + r.motivos_bloqueio.slice(0, 2).join('; ') : ''})_`
        : ''
      return `- ${r.categoria}: **${r.disponiveis} disponíve${r.disponiveis !== 1 ? 'is' : 'l'}** de ${r.total} total${custoStr}${notesStr}${bloqueioInfo}`
    }).join('\n')

    const headline = totalBloqueadas > 0
      ? `**Capacidade instalada (${totalDisponiveis} disponíveis · ${totalBloqueadas} bloqueada${totalBloqueadas > 1 ? 's' : ''} de ${totalDisponiveis + totalBloqueadas} total):**`
      : `**Capacidade instalada (${totalDisponiveis} suítes disponíveis):**`

    sections.push(`${headline}\n${rows}`)
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

> Use estes dados para cálculos de margem e nunca pergunte ao usuário o total de suítes ou comissões — eles estão acima. Suítes bloqueadas (em obras, manutenção etc) NÃO contam como disponíveis para venda.`
}
