/**
 * Demanda por faixa horária (diurna 06–17h vs noturna 18–05h) por categoria.
 * Usado para flutuar o preço por faixa nas propostas: a faixa com demanda
 * significativamente maior recebe prêmio. Conta locações finalizadas pelo
 * horário de check-in (datainicialdaocupacao).
 */
import { getAutomPool, getUnitCategoryIds } from './client'
import { ddmmyyyyToIso, ddmmyyyyToIsoEnd, addDays } from './company-kpis'

export interface BandDemand {
  diurno: number   // check-ins 06:00–17:59
  noturno: number  // check-ins 18:00–05:59
}

/** Map<categoria(UPPER), BandDemand> */
export async function queryBandDemandByCategory(
  unitSlug: string,
  startDDMMYYYY: string,
  endDDMMYYYY: string,
): Promise<Map<string, BandDemand>> {
  const pool = await getAutomPool(unitSlug)
  if (!pool) return new Map()
  const catIds = await getUnitCategoryIds(unitSlug)
  if (!catIds.length) return new Map()

  const isoStart = ddmmyyyyToIso(startDDMMYYYY)
  // bound inclusivo: período fechado usa (fim+1) 05:59:59; aqui basta cobrir o intervalo
  const isoEnd = addDays(ddmmyyyyToIso(endDDMMYYYY), 1)
  void ddmmyyyyToIsoEnd

  const sql = `
    SELECT
      UPPER(ca.descricao) AS categoria,
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM la.datainicialdaocupacao) BETWEEN 6 AND 17)     AS diurno,
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM la.datainicialdaocupacao) NOT BETWEEN 6 AND 17) AS noturno
    FROM locacaoapartamento la
    INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
    INNER JOIN apartamento a        ON aps.id_apartamento     = a.id
    INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
    WHERE la.datainicialdaocupacao >= $1
      AND la.datainicialdaocupacao <  $2
      AND la.fimocupacaotipo = 'FINALIZADA'
      AND ca.id IN (${catIds.join(',')})
    GROUP BY UPPER(ca.descricao)
  `
  try {
    const { rows } = await pool.query<{ categoria: string; diurno: string; noturno: string }>(sql, [isoStart, isoEnd])
    const map = new Map<string, BandDemand>()
    for (const r of rows) {
      map.set(r.categoria, { diurno: Number(r.diurno) || 0, noturno: Number(r.noturno) || 0 })
    }
    return map
  } catch (err) {
    console.error('[BandDemand] Query falhou:', err instanceof Error ? err.message : err)
    return new Map()
  }
}
