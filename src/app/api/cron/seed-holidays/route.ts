import { NextRequest } from 'next/server'
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
 * Cron anual: popula unit_events com feriados do ano corrente para
 * todas as unidades ativas. Idempotente — pode rodar diariamente sem
 * duplicar. Configurado em vercel.json para 01/01 anualmente.
 *
 * Auth: Bearer CRON_SECRET (mesmo padrão de /api/cron/revisoes)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Não autorizado', { status: 401 })
  }

  const admin = getAdminClient()
  const { data: units } = await admin
    .from('units')
    .select('id, slug, name')
    .eq('is_active', true)

  if (!units?.length) {
    return Response.json({ ok: true, processed: 0, message: 'Nenhuma unidade ativa' })
  }

  const currentYear = new Date().getFullYear()
  const years = [currentYear, currentYear + 1] // ano corrente + próximo

  const results: Array<{ unit: string; inserted: number; skipped: number; error?: string }> = []

  for (const unit of units) {
    try {
      const { data: cfg } = await admin
        .from('rm_agent_config')
        .select('city')
        .eq('unit_id', unit.id)
        .maybeSingle()

      const city = cfg?.city ?? null

      const { data: existing } = await admin
        .from('unit_events')
        .select('title, event_date')
        .eq('unit_id', unit.id)

      const existingKeys = new Set(
        (existing ?? []).map((e) => `${e.title}|${e.event_date}`),
      )

      let inserted = 0
      let skipped = 0

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
          }))

        skipped += holidays.length - toInsert.length

        if (toInsert.length) {
          const { error } = await admin.from('unit_events').insert(toInsert)
          if (error) throw error
          inserted += toInsert.length
        }
      }

      results.push({ unit: unit.name, inserted, skipped })
    } catch (e) {
      results.push({
        unit: unit.name,
        inserted: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : 'erro desconhecido',
      })
    }
  }

  return Response.json({ ok: true, years, results })
}
