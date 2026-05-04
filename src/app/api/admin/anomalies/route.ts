import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: lista anomalias da unidade (últimos 14 dias) — todos podem ler
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('rm_anomalies')
    .select('id, detected_at, metric, scope, current_value, baseline_mean, baseline_stddev, z_score, direction, status, conv_id, notes')
    .eq('unit_id', unit.id)
    .gte('detected_at', cutoff)
    .order('detected_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// PATCH: marca como acknowledged ou resolved
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as { id: string; status: 'acknowledged' | 'resolved'; notes?: string }
  if (!body.id || !['acknowledged', 'resolved'].includes(body.status)) {
    return new Response('id e status obrigatórios', { status: 400 })
  }

  const { error } = await supabase
    .from('rm_anomalies')
    .update({ status: body.status, notes: body.notes ?? null })
    .eq('id', body.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
