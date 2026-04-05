import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface ScheduledReview {
  id: string
  unit_id: string
  created_by: string
  scheduled_at: string   // ISO timestamptz
  note: string | null
  proposal_id: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  conv_id: string | null
  created_at: string
  executed_at: string | null
}

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── GET: lista agendamentos da unidade ───────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units').select('id').eq('slug', unitSlug).eq('is_active', true).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error } = await supabase
    .from('scheduled_reviews')
    .select('*')
    .eq('unit_id', unit.id)
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data as unknown as ScheduledReview[])
}

// ─── PATCH: editar data/nota de agendamento pendente ─────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const body = await req.json() as { id: string; scheduled_at?: string; note?: string }
  const { id, scheduled_at, note } = body
  if (!id) return new Response('id obrigatório', { status: 400 })

  const updates: Record<string, unknown> = {}
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at
  if (note !== undefined) updates.note = note

  if (Object.keys(updates).length === 0) {
    return new Response('Nenhum campo para atualizar', { status: 400 })
  }

  const { data, error } = await supabase
    .from('scheduled_reviews')
    .update(updates)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .single()

  if (error || !data) {
    return Response.json({ error: 'Agendamento não encontrado ou não está pendente' }, { status: 404 })
  }

  return Response.json(data as unknown as ScheduledReview)
}

// ─── DELETE: excluir agendamento ──────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const { error } = await supabase
    .from('scheduled_reviews')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
