import { getAutomPool, getUnitCategoryIds } from './client'

export interface RealtimeOccupancyRow {
  categoria: string
  total: number        // total de suítes não excluídas
  bloqueadas: number   // suítes com bloqueio ativo
  disponiveis: number  // total − bloqueadas
  ocupadas: number     // suítes com locação ativa neste momento
  livres: number       // disponiveis − ocupadas
  pct_ocupacao: number // ocupadas / disponiveis × 100 (0 se disponiveis = 0)
  motivos_bloqueio: string[]
}

interface RawRow {
  categoria: string
  total:      string
  bloqueadas: string
  ocupadas:   string
  motivos_bloqueio: string | null
}

/**
 * Retorna a ocupação em tempo real por categoria de suíte.
 *
 * "Ativa" = fimocupacaotipo IS NULL (locação ainda aberta, não finalizada/cancelada).
 * "Disponível" = total − bloqueadas (descontando obras/manutenção com datafim IS NULL).
 * "Livre" = disponíveis − ocupadas.
 *
 * Usado pelo agente RM para tomar decisões de precificação conscientes da
 * ocupação atual — ex: categoria 100% cheia → oportunidade de aumento imediato.
 */
export async function getRealtimeOccupancyByCategory(
  unitSlug: string,
): Promise<RealtimeOccupancyRow[]> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = (await getUnitCategoryIds(unitSlug)).join(',')
  if (!catIds) return []

  const sql = `
    WITH
    bloqueios_ativos AS (
      SELECT aps.id_apartamento, b.observacao
      FROM bloqueadoapartamento b
      INNER JOIN apartamentostate aps ON b.id_apartamentostate = aps.id
      WHERE aps.datafim IS NULL
    ),
    locacoes_ativas AS (
      SELECT aps.id_apartamento
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      WHERE la.fimocupacaotipo IS NULL
        AND la.datainicialdaocupacao <= NOW()
    )
    SELECT
      ca.descricao                           AS categoria,
      COUNT(*)                               AS total,
      COUNT(ba.id_apartamento)               AS bloqueadas,
      COUNT(lo.id_apartamento)               AS ocupadas,
      string_agg(DISTINCT NULLIF(TRIM(ba.observacao), ''), ' / ')
                                             AS motivos_bloqueio
    FROM apartamento a
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    LEFT  JOIN bloqueios_ativos ba ON a.id = ba.id_apartamento
    LEFT  JOIN locacoes_ativas  lo ON a.id = lo.id_apartamento
    WHERE ca.id IN (${catIds})
      AND a.dataexclusao IS NULL
    GROUP BY ca.descricao
    ORDER BY ca.descricao
  `

  try {
    const { rows } = await pool.query<RawRow>(sql)
    return rows.map((r) => {
      const total      = Number(r.total)      || 0
      const bloqueadas = Number(r.bloqueadas) || 0
      const ocupadas   = Number(r.ocupadas)   || 0
      const disponiveis = Math.max(0, total - bloqueadas)
      const livres      = Math.max(0, disponiveis - ocupadas)
      const pct_ocupacao = disponiveis > 0 ? (ocupadas / disponiveis) * 100 : 0
      const motivos_bloqueio = r.motivos_bloqueio
        ? r.motivos_bloqueio.split(' / ').filter(Boolean)
        : []
      return { categoria: r.categoria, total, bloqueadas, disponiveis, ocupadas, livres, pct_ocupacao, motivos_bloqueio }
    })
  } catch (e) {
    console.error('[realtime-occupancy]', e)
    return []
  }
}
