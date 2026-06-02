/**
 * Diagnóstico: COUNT de locações por categoria para comparar com Analytics.
 * GET /api/debug/kpis-category-count?unit=andar-de-cima&start=01/05/2026&end=31/05/2026
 *
 * Retorna:
 * - total com catIds configurados
 * - total SEM filtro de categoria (= o que Analytics possivelmente vê)
 * - breakdown por categoria
 * Ajuda a identificar se catIds inclui alguma categoria que Analytics não conta.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAutomPool, getUnitCategoryIds } from '@/lib/automo/client'
import { ddmmyyyyToIso } from '@/lib/automo/company-kpis'
import { cachedCompanyKPIs } from '@/lib/automo/cached-kpis'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp    = req.nextUrl.searchParams
  const unit  = sp.get('unit') ?? 'andar-de-cima'
  const start = sp.get('start') ?? '01/05/2026'
  const end   = sp.get('end')   ?? '31/05/2026'

  const pool = await getAutomPool(unit)
  if (!pool) return NextResponse.json({ error: 'pool indisponível' }, { status: 500 })

  const catIds  = await getUnitCategoryIds(unit)
  const catStr  = catIds.join(',')
  const isoStart = ddmmyyyyToIso(start)

  // Para período fechado: (endDate+1) a 05:59:59
  const [d, m, y] = end.split('/').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  const isoEnd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} 05:59:59`

  const baseWhere = `
    la.datainicialdaocupacao >= $1
    AND la.datainicialdaocupacao <= $2
    AND la.fimocupacaotipo = 'FINALIZADA'
  `

  try {
    const [withCat, withoutCat, perCategory, dashboardFn] = await Promise.all([
      // COUNT com filtro de categoria (o que RM usa)
      pool.query<{ cnt: string; total_value: string }>(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(la.valortotal AS DECIMAL(15,4))), 0) AS total_value
        FROM locacaoapartamento la
        INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
        INNER JOIN apartamento a        ON aps.id_apartamento = a.id
        INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
        WHERE ${baseWhere} AND ca.id IN (${catStr})
      `, [isoStart, isoEnd]),

      // COUNT SEM filtro de categoria (o que Analytics possivelmente vê)
      pool.query<{ cnt: string; total_value: string }>(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(CAST(la.valortotal AS DECIMAL(15,4))), 0) AS total_value
        FROM locacaoapartamento la
        WHERE ${baseWhere}
      `, [isoStart, isoEnd]),

      // Breakdown por categoria
      pool.query<{ cat_id: string; cat_name: string; cnt: string; total_value: string }>(`
        SELECT
          ca.id          AS cat_id,
          ca.descricao   AS cat_name,
          COUNT(*)       AS cnt,
          COALESCE(SUM(CAST(la.valortotal AS DECIMAL(15,4))), 0) AS total_value
        FROM locacaoapartamento la
        INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
        INNER JOIN apartamento a        ON aps.id_apartamento = a.id
        INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
        WHERE ${baseWhere}
        GROUP BY ca.id, ca.descricao
        ORDER BY cnt DESC
      `, [isoStart, isoEnd]),

      // CAMINHO EXATO DO DASHBOARD — confirma que a função casa com a query crua + vendas_diretas
      cachedCompanyKPIs(unit, start, end, 6, 5, 'FINALIZADA', 'checkin')
        .then((r) => ({
          locacoes:    r.TotalResult.totalAllRentalsApartments,
          faturamento: r.TotalResult.totalAllValue,
        }))
        .catch((e) => ({ error: String(e) })),
    ])

    return NextResponse.json({
      // Marcador de versão deployada — confirma qual commit está no ar
      deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local/desconhecido',
      unit,
      period: { start, end, isoStart, isoEnd },
      catIds,
      withCategoryFilter: {
        locacoes: Number(withCat.rows[0].cnt),
        faturamento: Number(withCat.rows[0].total_value),
      },
      withoutCategoryFilter: {
        locacoes: Number(withoutCat.rows[0].cnt),
        faturamento: Number(withoutCat.rows[0].total_value),
      },
      // O que o dashboard realmente renderiza (query de locação + vendas_diretas)
      dashboardFunction: dashboardFn,
      perCategory: perCategory.rows.map(r => ({
        id:         Number(r.cat_id),
        nome:       r.cat_name,
        locacoes:   Number(r.cnt),
        faturamento: Number(r.total_value),
        inCatIds:   catIds.includes(Number(r.cat_id)),
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
