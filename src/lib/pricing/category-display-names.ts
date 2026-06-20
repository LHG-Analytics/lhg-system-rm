/**
 * Mapeamento de nomes de categoria do Automo → nomes de exibição por unidade.
 *
 * Os nomes internos (chaves) são os que vêm da planilha de preços importada.
 * Os nomes de exibição são os que o gestor usa no dia a dia.
 *
 * Regra de exclusão (UNIT_SCHED_EXCLUDED): categorias que NÃO existem no site
 * programado (Day Use / Pernoite / Diária) e portanto não devem ser precificadas
 * no canal site_programada.
 */

// Chaves são lowercase para comparação case-insensitive
const LIV_MAP: Record<string, string> = {
  'hidro promo':         'Lumini Hidro',
  'vip':                 'Lumini Vip',
  'diamond':             'Lumini Diamond',
  'lounge':              'LIV',
  'lounge hidro':        'LIV Hidro',
  'hidro sexy':          'LIV Hidro Sexy',
  'lounge spa':          'LIV SPA',
  'lounge spa 50 sombras': 'LIV SPA 50 Sombra',
  'lounge acqua':        'LIV Acqua',
  'hidro e sauna':       'LIV Hidro e Sauna',
}

export const UNIT_CATEGORY_MAP: Record<string, Record<string, string>> = {
  liv: LIV_MAP,
}

// Categorias excluídas do canal site_programada (não existem no site agendado)
export const UNIT_SCHED_EXCLUDED: Record<string, Set<string>> = {
  liv: new Set(['hidro promo', 'vip', 'diamond']),
}

/** Retorna o nome de exibição para a categoria (fallback = nome original). */
export function getCategoryDisplayName(unitSlug: string, categoria: string): string {
  const map = UNIT_CATEGORY_MAP[unitSlug]
  if (!map) return categoria
  return map[categoria.trim().toLowerCase()] ?? categoria
}

/** Verifica se a categoria deve ser excluída do canal site_programada. */
export function isSchedExcluded(unitSlug: string, categoria: string): boolean {
  const set = UNIT_SCHED_EXCLUDED[unitSlug]
  return set?.has(categoria.trim().toLowerCase()) ?? false
}
