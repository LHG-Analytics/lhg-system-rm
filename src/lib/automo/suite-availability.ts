import { getAutomPool, UNIT_CATEGORY_IDS } from './client'

/**
 * Disponibilidade de suítes por categoria, considerando bloqueios ativos.
 *
 * Fonte:
 *   - apartamento (filtro: dataexclusao IS NULL e categoria pertence à unidade)
 *   - bloqueadoapartamento → apartamentostate (filtro: datafim IS NULL = bloqueio ativo)
 *
 * O bloco "Estrutura da unidade" do agente RM usa esses números para
 * dar contexto correto de capacidade — uma suíte em obra não conta como
 * disponível para venda.
 */

export interface SuiteAvailabilityRow {
  categoria: string
  total: number      // total de suítes da categoria não excluídas
  bloqueadas: number // suítes com bloqueio ativo (datafim IS NULL)
  disponiveis: number // total − bloqueadas
  motivos_bloqueio: string[]  // observações distintas dos bloqueios ativos
}

interface RawRow {
  categoria: string
  total: string
  bloqueadas: string
  motivos_bloqueio: string[] | null
}

export async function getSuiteAvailabilityByCategory(unitSlug: string): Promise<SuiteAvailabilityRow[]> {
  const pool = getAutomPool(unitSlug)
  if (!pool) return []

  const catIds = (UNIT_CATEGORY_IDS[unitSlug] ?? []).join(',')
  if (!catIds) return []

  const sql = `
    WITH bloqueios_ativos AS (
      SELECT
        aps.id_apartamento,
        ARRAY_AGG(DISTINCT NULLIF(TRIM(b.observacao), '')) FILTER (WHERE b.observacao IS NOT NULL) AS observacoes
      FROM bloqueadoapartamento b
      INNER JOIN apartamentostate aps ON b.id_apartamentostate = aps.id
      WHERE aps.datafim IS NULL
      GROUP BY aps.id_apartamento
    )
    SELECT
      ca.descricao AS categoria,
      COUNT(*) AS total,
      COUNT(ba.id_apartamento) AS bloqueadas,
      ARRAY_AGG(DISTINCT obs) FILTER (WHERE obs IS NOT NULL) AS motivos_bloqueio
    FROM apartamento a
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    LEFT JOIN bloqueios_ativos ba ON a.id = ba.id_apartamento
    LEFT JOIN LATERAL UNNEST(ba.observacoes) AS obs ON TRUE
    WHERE ca.id IN (${catIds})
      AND a.dataexclusao IS NULL
    GROUP BY ca.descricao
    ORDER BY ca.descricao;
  `

  try {
    const { rows } = await pool.query<RawRow>(sql)
    return rows.map((r) => {
      const total      = Number(r.total) || 0
      const bloqueadas = Number(r.bloqueadas) || 0
      return {
        categoria: r.categoria,
        total,
        bloqueadas,
        disponiveis: Math.max(0, total - bloqueadas),
        motivos_bloqueio: r.motivos_bloqueio ?? [],
      }
    })
  } catch (e) {
    console.error('[suite-availability]', e)
    return []
  }
}
