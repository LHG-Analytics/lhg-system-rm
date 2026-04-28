import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET: lista capacity + channel_costs da unidade ──────────────────────────

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

  const [capacityResult, channelCostsResult] = await Promise.all([
    supabase
      .from('unit_capacity')
      .select('id, categoria, custo_variavel_locacao, notes')
      .eq('unit_id', unit.id)
      .order('categoria'),
    supabase
      .from('unit_channel_costs')
      .select('id, canal, comissao_pct, taxa_fixa, notes')
      .eq('unit_id', unit.id)
      .order('canal'),
  ])

  // Disponibilidade vem do Automo (descontando bloqueios)
  const { getSuiteAvailabilityByCategory } = await import('@/lib/automo/suite-availability')
  const availability = await getSuiteAvailabilityByCategory(unitSlug).catch(() => [])

  return Response.json({
    capacity: capacityResult.data ?? [],
    channelCosts: channelCostsResult.data ?? [],
    availability,
  })
}

// ─── POST: cria/atualiza capacity (upsert por unit+categoria) ────────────────

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
    return new Response('Apenas admins podem configurar capacidade', { status: 403 })
  }

  const body = await req.json() as {
    unitSlug: string
    categoria: string
    custo_variavel_locacao?: number
    notes?: string
  }

  const { unitSlug, categoria } = body
  const custo_variavel_locacao = body.custo_variavel_locacao ?? 0

  if (!unitSlug || !categoria) {
    return new Response('unitSlug e categoria são obrigatórios', { status: 400 })
  }
  if (typeof custo_variavel_locacao !== 'number' || custo_variavel_locacao < 0) {
    return new Response('custo_variavel_locacao deve ser número não-negativo', { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id && profile.unit_id !== null) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const { data, error } = await supabase
    .from('unit_capacity')
    .upsert(
      {
        unit_id: unit.id,
        categoria,
        custo_variavel_locacao,
        notes: body.notes ?? null,
        created_by: user.id,
      },
      { onConflict: 'unit_id,categoria' }
    )
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// ─── DELETE: remove capacity por id ──────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return new Response('Apenas admins podem remover capacidade', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const { error } = await supabase
    .from('unit_capacity')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
