import type { SuiteAvailabilityRow } from '@/lib/automo/suite-availability'
import type { RealtimeOccupancyRow } from '@/lib/automo/realtime-occupancy'

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
  realtimeOccupancy?: RealtimeOccupancyRow[],
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

  // Ocupação em tempo real — só inclui se houver dados
  if (realtimeOccupancy && realtimeOccupancy.length > 0) {
    const now = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    })
    const totalOcupadas   = realtimeOccupancy.reduce((s, r) => s + r.ocupadas,   0)
    const totalDisponiveis = realtimeOccupancy.reduce((s, r) => s + r.disponiveis, 0)
    const totalLivres      = realtimeOccupancy.reduce((s, r) => s + r.livres,     0)
    const pctGeral = totalDisponiveis > 0
      ? ` — **${Math.round((totalOcupadas / totalDisponiveis) * 100)}% de ocupação geral**`
      : ''

    const header = `| Categoria | Ocupadas | Livres | Disponíveis | % Ocup. |`
    const sep    = `|-----------|----------|--------|-------------|---------|`
    const rowsLines = realtimeOccupancy.map((r) => {
      const pct = r.disponiveis > 0 ? Math.round(r.pct_ocupacao) : 0
      const alert = pct >= 100 ? ' ⚠️ LOTADA' : pct >= 85 ? ' 🔴' : pct >= 60 ? ' 🟡' : ' 🟢'
      return `| ${r.categoria} | ${r.ocupadas} | ${r.livres} | ${r.disponiveis} | ${pct}%${alert} |`
    })
    const footer = `| **Total** | **${totalOcupadas}** | **${totalLivres}** | **${totalDisponiveis}** | — |`

    sections.push(
      `**Ocupação agora (${now}):**${pctGeral}\n` +
      [header, sep, ...rowsLines, footer].join('\n') + '\n' +
      `\n> 🔴 ≥85% · 🟡 60–84% · 🟢 <60%. Use estes dados para decisões imediatas: categoria lotada = oportunidade de aumento; categoria vazia = oportunidade de promoção.`
    )
  }

  // Identifica categorias volume-constrained (≤ 2 suítes no total)
  const volumeConstrained = availability.filter((r) => r.total <= 2)

  const vcWarning = volumeConstrained.length > 0
    ? `\n\n> ⚠️ **CATEGORIAS VOLUME-CONSTRAINED** (inventário ≤ 2 suítes — ${volumeConstrained.map((r) => r.categoria).join(', ')}): o giro e a ocupação dessas categorias são ESTRUTURALMENTE LIMITADOS pelo inventário, não pelo preço. NÃO reduzir preço para perseguir giro — isso só reduz receita sem aumentar volume. Estratégia obrigatória: maximizar RevPAR e ticket médio. Giro/ocupação baixos são ESPERADOS e aceitáveis quando comparados a categorias com mais suítes.`
    : ''

  return `## Estrutura da unidade

${sections.join('\n\n')}

> Use estes dados para cálculos de margem e nunca pergunte ao usuário o total de suítes ou comissões — eles estão acima. Suítes bloqueadas (em obras, manutenção etc) NÃO contam como disponíveis para venda.${vcWarning}`
}
