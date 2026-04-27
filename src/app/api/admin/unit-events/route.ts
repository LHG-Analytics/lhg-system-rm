import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type EventType = 'positivo' | 'negativo' | 'neutro'

export interface UnitEvent {
  id: string
  unit_id: string
  title: string
  event_date: string
  event_end_date: string | null
  event_type: EventType
  impact_description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── GET: lista eventos da unidade ────────────────────────────────────────────

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

  const admin = getAdminClient()
  const { data, error } = await (admin as any)
    .from('unit_events')
    .select('id, unit_id, title, event_date, event_end_date, event_type, impact_description, created_by, created_at, updated_at')
    .eq('unit_id', unit.id)
    .order('event_date', { ascending: false })
    .limit(100)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// ─── POST: cria evento ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão insuficiente', { status: 403 })
  }

  const body = await req.json() as {
    unitSlug: string
    title: string
    event_date: string
    event_end_date?: string | null
    event_type: EventType
    impact_description?: string | null
  }

  const { unitSlug, title, event_date, event_type } = body
  if (!unitSlug || !title || !event_date || !event_type) {
    return new Response('unitSlug, title, event_date e event_type são obrigatórios', { status: 400 })
  }
  if (!['positivo', 'negativo', 'neutro'].includes(event_type)) {
    return new Response('event_type inválido', { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const admin = getAdminClient()
  const { data, error } = await (admin as any)
    .from('unit_events')
    .insert({
      unit_id: unit.id,
      title,
      event_date,
      event_end_date: body.event_end_date ?? null,
      event_type,
      impact_description: body.impact_description ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// ─── PATCH: atualiza evento ───────────────────────────────────────────────────

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
    return new Response('Permissão insuficiente', { status: 403 })
  }

  const body = await req.json() as {
    id: string
    title?: string
    event_date?: string
    event_end_date?: string | null
    event_type?: EventType
    impact_description?: string | null
  }

  if (!body.id) return new Response('id obrigatório', { status: 400 })

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title             !== undefined) fields.title              = body.title
  if (body.event_date        !== undefined) fields.event_date         = body.event_date
  if (body.event_end_date    !== undefined) fields.event_end_date     = body.event_end_date
  if (body.event_type        !== undefined) fields.event_type         = body.event_type
  if (body.impact_description !== undefined) fields.impact_description = body.impact_description

  const admin = getAdminClient()
  const { data, error } = await (admin as any)
    .from('unit_events')
    .update(fields)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// ─── DELETE: remove evento ────────────────────────────────────────────────────

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
    return new Response('Apenas admins podem remover eventos', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { error } = await (admin as any)
    .from('unit_events')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
