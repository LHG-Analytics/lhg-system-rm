import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeSeasonality } from '@/lib/seasonality/compute'

/**
 * Recomputa fatores sazonais para uma unidade. Bypass do cron semanal —
 * útil para validação inicial ou quando o gestor importa muito histórico.
 *
 * Body: { unitSlug: string }
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
    return new Response('Apenas admins podem recomputar sazonalidade', { status: 403 })
  }

  const body = await req.json() as { unitSlug: string }
  if (!body.unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const { data: unit } = await supabase
    .from('units')
    .select('id, slug')
    .eq('slug', body.unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id && profile.unit_id !== null) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const result = await recomputeSeasonality(unit.id, unit.slug)

  if (!result.ok) {
    return Response.json({ error: result.error, days_processed: result.days_processed }, { status: 500 })
  }

  return Response.json({ ok: true, days_processed: result.days_processed })
}
