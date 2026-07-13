import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, getUnitCategoryIds } from '@/lib/automo/client'
import { cteBaseSuiteDays, cteSuiteDaysByDow } from '@/lib/automo/suite-days'
import { getUnitTurnos, buildTurnoCaseSQL } from '@/lib/automo/turno-helpers'
import type { TurnoBand } from '@/lib/automo/turno-helpers'
import { resolveOperationalRange, opTs } from '@/lib/automo/operational-day'
import { isValidIsoDate, resolvePreset } from '@/lib/date-range'
import type { Database } from '@/types/database.types'

export type { TurnoBand }

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface TurnoHeatmapCell {
  day_name: string
  turno:    string
  giro:     number // taxa (locações / suítes-turno disponíveis)
  giroPct:  number // % de participação no giro total da grade (soma das 14 células = 100)
  receita:  number
}

export interface TurnoHeatmapResponse {
  rows:       TurnoHeatmapCell[]
  turnos:     TurnoBand[]
  categories: { id: number; nome: string }[]
}

function dowCase(col: string) {
  return `CASE EXTRACT(DOW FROM ${col})
      WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terca'
      WHEN 3 THEN 'Quarta'  WHEN 4 THEN 'Quinta'  WHEN 5 THEN 'Sexta'
      WHEN 6 THEN 'Sabado'
    END`
}

function buildTurnoQuery(
  idList: string,
  isoStart: string,
  isoEnd: string,
  statusFilter: string,
  turnos: [TurnoBand, TurnoBand],
): string {
  const turnoSQL = buildTurnoCaseSQL(turnos, 'EXTRACT(HOUR FROM la.datainicialdaocupacao)::int')
  return `
    WITH ${cteBaseSuiteDays(idList, `'${isoStart}'`, `'${isoEnd}'`)},
    ${cteSuiteDaysByDow()},
    turno_locacoes AS (
      SELECT
        ${dowCase(opTs('la.datainicialdaocupacao'))} AS day_name,
        EXTRACT(DOW FROM ${opTs('la.datainicialdaocupacao')})::int AS dow,
        ${turnoSQL} AS turno,
        COUNT(*) AS locacoes,
        SUM(COALESCE(CAST(la.valortotal AS DECIMAL(15,4)), 0)) AS receita
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento       a  ON aps.id_apartamento     = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= '${isoStart}'
        AND la.datainicialdaocupacao <= '${isoEnd}'
        ${statusFilter}
        AND ca.id IN (${idList})
      GROUP BY ${dowCase(opTs('la.datainicialdaocupacao'))}, EXTRACT(DOW FROM ${opTs('la.datainicialdaocupacao')})::int, ${turnoSQL}
    )
    SELECT
      tl.day_name,
      tl.turno,
      tl.locacoes,
      tl.receita,
      sdtd.suite_dias AS suite_dias
    FROM turno_locacoes tl
    JOIN suite_dias_total_dow sdtd ON sdtd.dow = tl.dow
    ORDER BY tl.day_name, tl.turno`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const sp       = req.nextUrl.searchParams
  const unitSlug = sp.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const VALID_STATUSES = ['FINALIZADA', 'TRANSFERIDA', 'CANCELADA', 'ABERTA', 'TODAS'] as const
  type HeatmapStatus = typeof VALID_STATUSES[number]
  const rawStatus = sp.get('status') ?? 'FINALIZADA'
  const rentalStatus: HeatmapStatus = VALID_STATUSES.includes(rawStatus as HeatmapStatus)
    ? (rawStatus as HeatmapStatus) : 'FINALIZADA'
  const statusFilter = rentalStatus === 'TODAS'    ? '' :
                       rentalStatus === 'ABERTA'   ? 'AND la.fimocupacaotipo IS NULL' :
                       `AND la.fimocupacaotipo = '${rentalStatus}'`

  const rawStart = sp.get('startDate')
  const rawEnd   = sp.get('endDate')
  const range    = (rawStart && rawEnd && isValidIsoDate(rawStart) && isValidIsoDate(rawEnd))
    ? { startDate: rawStart, endDate: rawEnd }
    : resolvePreset('7d')

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
  const hasGlobalAccess = ['super_admin', 'admin'].includes(profile.role ?? '') && !profile.unit_id
  if (!hasGlobalAccess && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const pool = await getAutomPool(unitSlug)
  if (!pool) {
    return Response.json({ error: `Conexão Automo não configurada para ${unitSlug}.` }, { status: 422 })
  }

  const allCategoryIds = await getUnitCategoryIds(unitSlug)
  if (!allCategoryIds.length) {
    return Response.json({ error: 'IDs de categoria não configurados.' }, { status: 422 })
  }

  const categoryId = sp.get('categoryId')
  const selectedIds = categoryId
    ? allCategoryIds.filter((id) => id === parseInt(categoryId, 10))
    : allCategoryIds

  if (!selectedIds.length) {
    return Response.json({ error: 'Categoria inválida para esta unidade.' }, { status: 400 })
  }

  const idList    = selectedIds.join(',')
  const allIdList = allCategoryIds.join(',')
  const { startDate, endDate } = range
  const { isoStart, isoEnd } = resolveOperationalRange(startDate, endDate)

  try {
    const turnos = await getUnitTurnos(unitSlug)

    const catResult = await pool.query<{ id: number; nome: string }>(`
      SELECT ca.id, ca.descricao AS nome
      FROM categoriaapartamento ca
      WHERE ca.id IN (${allIdList})
      ORDER BY ca.descricao
    `)

    const sql = buildTurnoQuery(idList, isoStart, isoEnd, statusFilter, turnos)
    const result = await pool.query<{ day_name: string; turno: string; locacoes: string; receita: string; suite_dias: string }>(sql)

    const turnoHours = (label: string) => {
      const t = turnos.find((x) => x.label === label)
      if (!t) return 24
      return t.startHour < t.endHour ? t.endHour - t.startHour : 24 - t.startHour + t.endHour
    }

    const cells = result.rows.map((r) => {
      const locacoes  = Number(r.locacoes)   || 0
      const receita   = Number(r.receita)    || 0
      const suiteDias = Number(r.suite_dias) || 1
      const capacidadeTurno = suiteDias * (turnoHours(r.turno) / 24)
      const giro = capacidadeTurno > 0 ? locacoes / capacidadeTurno : 0
      return { day_name: r.day_name, turno: r.turno, giro, receita: +receita.toFixed(2) }
    })

    const totalGiro = cells.reduce((s, c) => s + c.giro, 0)
    const rows: TurnoHeatmapCell[] = cells.map((c) => ({
      day_name: c.day_name,
      turno:    c.turno,
      giro:     +c.giro.toFixed(3),
      giroPct:  totalGiro > 0 ? +((c.giro / totalGiro) * 100).toFixed(1) : 0,
      receita:  c.receita,
    }))

    return Response.json({ rows, turnos, categories: catResult.rows } satisfies TurnoHeatmapResponse)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[heatmap/turno] Erro Automo (${unitSlug}):`, msg)
    return Response.json({ error: `Erro ao conectar com o banco Automo: ${msg}` }, { status: 500 })
  }
}
