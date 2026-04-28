import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CANAIS_VALIDOS = ['balcao_site', 'site_programada', 'guia_moteis', 'booking', 'expedia', 'outros'] as const

// ─── POST: cria/atualiza channel cost (upsert por unit+canal) ────────────────

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
    return new Response('Apenas admins podem configurar comissões', { status: 403 })
  }

  const body = await req.json() as {
    unitSlug: string
    canal: string
    comissao_pct: number
    taxa_fixa?: number
    notes?: string
  }

  const { unitSlug, canal, comissao_pct } = body
  const taxa_fixa = body.taxa_fixa ?? 0

  if (!unitSlug || !canal) {
    return new Response('unitSlug e canal são obrigatórios', { status: 400 })
  }
  if (!CANAIS_VALIDOS.includes(canal as typeof CANAIS_VALIDOS[number])) {
    return new Response(`canal inválido. Use: ${CANAIS_VALIDOS.join(', ')}`, { status: 400 })
  }
  if (typeof comissao_pct !== 'number' || comissao_pct < 0 || comissao_pct > 100) {
    return new Response('comissao_pct deve ser número entre 0 e 100', { status: 400 })
  }
  if (typeof taxa_fixa !== 'number' || taxa_fixa < 0) {
    return new Response('taxa_fixa deve ser número não-negativo', { status: 400 })
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
    .from('unit_channel_costs')
    .upsert(
      {
        unit_id: unit.id,
        canal,
        comissao_pct,
        taxa_fixa,
        notes: body.notes ?? null,
        created_by: user.id,
      },
      { onConflict: 'unit_id,canal' }
    )
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// ─── DELETE: remove channel cost por id ──────────────────────────────────────

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
    return new Response('Apenas admins podem remover comissões', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const { error } = await supabase
    .from('unit_channel_costs')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
