import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { generateHolidaysForYear } from '@/lib/calendar/holidays-br'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Popula unit_events com feriados nacionais, estaduais e datas comerciais
 * para um ano específico (ou ano corrente + próximo). Idempotente: se já
 * existe entrada com mesmo title + event_date na unidade, pula.
 *
 * Body: { unitSlug: string, years?: number[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return new Response('Apenas admins podem popular feriados', { status: 403 })
  }

  const body = await req.json() as { unitSlug: string; years?: number[] }
  const { unitSlug } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const currentYear = new Date().getFullYear()
  const years = body.years && body.years.length ? body.years : [currentYear, currentYear + 1]

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, slug, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id && profile.unit_id !== null) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  // Cidade configurada pra escolher feriados estaduais
  const { data: cfg } = await admin
    .from('rm_agent_config')
    .select('city')
    .eq('unit_id', unit.id)
    .maybeSingle()

  const city = cfg?.city ?? null

  // Eventos já existentes (para deduplicar por title + event_date)
  const { data: existing } = await admin
    .from('unit_events')
    .select('title, event_date')
    .eq('unit_id', unit.id)

  const existingKeys = new Set(
    (existing ?? []).map((e) => `${e.title}|${e.event_date}`),
  )

  let inserted = 0
  let skipped  = 0

  for (const year of years) {
    const holidays = generateHolidaysForYear(year, city)
    const toInsert = holidays
      .filter((h) => !existingKeys.has(`${h.title}|${h.event_date}`))
      .map((h) => ({
        unit_id: unit.id,
        title: h.title,
        event_date: h.event_date,
        event_end_date: h.event_end_date,
        event_type: h.event_type,
        impact_description: h.impact_description,
        created_by: user.id,
      }))

    skipped += holidays.length - toInsert.length

    if (toInsert.length) {
      const { error } = await admin.from('unit_events').insert(toInsert)
      if (error) {
        return Response.json({ error: error.message, inserted, skipped }, { status: 500 })
      }
      inserted += toInsert.length
    }
  }

  return Response.json({
    ok: true,
    unit: unit.name,
    city,
    years,
    inserted,
    skipped,
  })
}
