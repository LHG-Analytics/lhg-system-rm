import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type HeatmapMetric = 'giro' | 'ocupacao'

export interface HeatmapCategory {
  id: number
  nome: string
}

export interface HeatmapCell {
  day_name: string
  hour_of_day: number
  value: number
}

export interface HeatmapResponse {
  rows: HeatmapCell[]
  metric: HeatmapMetric
  categories: HeatmapCategory[]
}

export async function GET(req: NextRequest) {
  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug   = req.nextUrl.searchParams.get('unitSlug')
  const metric     = (req.nextUrl.searchParams.get('metric') ?? 'giro') as HeatmapMetric
  const categoryId = req.nextUrl.searchParams.get('categoryId')  // null = total geral

  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  // Resolve unit + verifica acesso
  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, slug, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return new Response('Perfil não encontrado', { status: 403 })
  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  // Pool Automo
  const pool = getAutomPool(unitSlug)
  if (!pool) {
    return Response.json(
      { error: `Conexão Automo não configurada para ${unitSlug}. Verifique DATABASE_URL_LOCAL_${unitSlug.toUpperCase()}.` },
      { status: 422 }
    )
  }

  const allCategoryIds = UNIT_CATEGORY_IDS[unitSlug]
  if (!allCategoryIds?.length) {
    return Response.json({ error: 'IDs de categoria não configurados.' }, { status: 422 })
  }

  // Filtra por categoria selecionada ou usa todas
  const selectedIds = categoryId
    ? allCategoryIds.filter((id) => id === parseInt(categoryId, 10))
    : allCategoryIds

  if (!selectedIds.length) {
    return Response.json({ error: 'Categoria inválida para esta unidade.' }, { status: 400 })
  }

  const idList = selectedIds.join(',')
  const allIdList = allCategoryIds.join(',')

  try {
    // Busca nomes das categorias (sempre todas as da unidade)
    const catResult = await pool.query<{ id: number; nome: string }>(`
      SELECT ca.id, ca.descricao as nome
      FROM categoriaapartamento ca
      WHERE ca.id IN (${allIdList})
      ORDER BY ca.descricao
    `)
    const categories: HeatmapCategory[] = catResult.rows

    let rows: HeatmapCell[]

    if (metric === 'giro') {
      const result = await pool.query<HeatmapCell>(`
        WITH category_suites AS (
          SELECT ca.id, COUNT(a.id) as suites
          FROM apartamento a
          INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
          WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
          GROUP BY ca.id
        ),
        rentals_by_category_day_hour AS (
          SELECT
            ca.id as category_id,
            cs.suites,
            CASE EXTRACT(DOW FROM
              CASE WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 6
                THEN la.datainicialdaocupacao - INTERVAL '1 day'
                ELSE la.datainicialdaocupacao
              END
            )
              WHEN 0 THEN 'Domingo'
              WHEN 1 THEN 'Segunda'
              WHEN 2 THEN 'Terca'
              WHEN 3 THEN 'Quarta'
              WHEN 4 THEN 'Quinta'
              WHEN 5 THEN 'Sexta'
              WHEN 6 THEN 'Sabado'
            END as day_name,
            EXTRACT(HOUR FROM la.datainicialdaocupacao)::INT as hour_of_day,
            COUNT(*) as rentals
          FROM locacaoapartamento la
          INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
          INNER JOIN apartamento a ON aps.id_apartamento = a.id
          INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
          INNER JOIN category_suites cs ON ca.id = cs.id
          WHERE la.datainicialdaocupacao >= CURRENT_DATE - INTERVAL '7 days'
            AND la.datainicialdaocupacao < CURRENT_DATE
            AND la.fimocupacaotipo = 'FINALIZADA'
            AND ca.id IN (${idList})
          GROUP BY ca.id, cs.suites, day_name, hour_of_day
        )
        SELECT
          day_name,
          hour_of_day,
          ROUND(SUM(rentals::DECIMAL / suites), 2)::float as value
        FROM rentals_by_category_day_hour
        GROUP BY day_name, hour_of_day
        ORDER BY
          CASE day_name
            WHEN 'Segunda' THEN 1 WHEN 'Terca' THEN 2 WHEN 'Quarta' THEN 3
            WHEN 'Quinta' THEN 4 WHEN 'Sexta' THEN 5 WHEN 'Sabado' THEN 6
            WHEN 'Domingo' THEN 7
          END,
          hour_of_day
      `)
      rows = result.rows
    } else {
      const result = await pool.query<HeatmapCell>(`
        WITH checkin_times AS (
          SELECT
            CASE
              WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 6
              THEN la.datainicialdaocupacao - INTERVAL '1 day'
              ELSE la.datainicialdaocupacao
            END as occupation_date,
            CASE EXTRACT(DOW FROM
              CASE
                WHEN EXTRACT(HOUR FROM la.datainicialdaocupacao) < 6
                THEN la.datainicialdaocupacao - INTERVAL '1 day'
                ELSE la.datainicialdaocupacao
              END
            )
              WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
              WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
              WHEN 6 THEN 'Sabado'
            END as day_name,
            EXTRACT(HOUR FROM la.datainicialdaocupacao) as hour_of_day,
            EXTRACT(EPOCH FROM (
              COALESCE(la.datafinaldaocupacao, la.datainicialdaocupacao + INTERVAL '6 hours') - la.datainicialdaocupacao
            ))/3600 as hours_occupied
          FROM locacaoapartamento la
          INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
          INNER JOIN apartamento a ON aps.id_apartamento = a.id
          INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
          WHERE la.datainicialdaocupacao >= CURRENT_DATE - INTERVAL '7 days'
            AND la.datainicialdaocupacao < CURRENT_DATE
            AND la.datafinaldaocupacao IS NOT NULL
            AND la.fimocupacaotipo = 'FINALIZADA'
            AND ca.id IN (${idList})
        ),
        capacity AS (
          SELECT COUNT(*) as total_suites
          FROM apartamento a
          INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
          WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
        ),
        hourly_occupancy AS (
          SELECT
            day_name,
            hour_of_day::INT as hour_of_day,
            SUM(hours_occupied) as total_hours_occupied,
            COUNT(*) as day_count
          FROM checkin_times
          GROUP BY day_name, hour_of_day
        )
        SELECT
          ho.day_name,
          ho.hour_of_day,
          ROUND(
            (ho.total_hours_occupied::DECIMAL / (c.total_suites * ho.day_count)) * 100,
            2
          )::float as value
        FROM hourly_occupancy ho, capacity c
        ORDER BY
          CASE ho.day_name
            WHEN 'Segunda' THEN 1 WHEN 'Terca' THEN 2 WHEN 'Quarta' THEN 3
            WHEN 'Quinta' THEN 4 WHEN 'Sexta' THEN 5 WHEN 'Sabado' THEN 6
            WHEN 'Domingo' THEN 7
          END,
          ho.hour_of_day
      `)
      rows = result.rows
    }

    return Response.json({ rows, metric, categories } satisfies HeatmapResponse)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[heatmap] Erro Automo (${unitSlug}):`, msg)
    return Response.json(
      { error: `Erro ao conectar com o banco Automo: ${msg}` },
      { status: 500 }
    )
  }
}
