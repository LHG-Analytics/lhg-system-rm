import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export const runtime = 'edge'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireAdminRole() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const, user: null, role: null }
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single()
  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) {
    return { error: 'Acesso negado', status: 403 as const, user: null, role: null }
  }
  return { error: null, status: 200 as const, user, role: profile!.role }
}

// ─── POST: convida um novo usuário por email ──────────────────────────────────

export async function POST(req: NextRequest) {
  const { error, status, user, role } = await requireAdminRole()
  if (error || !user) return new Response(error, { status })

  const body = await req.json() as { email: string; role: string; unit_id?: string }
  const { email, role: targetRole, unit_id } = body

  if (!email || !targetRole) return new Response('email e role são obrigatórios', { status: 400 })

  // Apenas super_admin pode criar outros super_admins
  if (targetRole === 'super_admin' && role !== 'super_admin') {
    return new Response('Apenas super_admin pode criar outros super_admins', { status: 403 })
  }

  const admin = getAdminClient()

  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const alreadyExists = existingUsers?.users?.some((u) => u.email === email)
  if (alreadyExists) return Response.json({ error: 'Este email já possui acesso.' }, { status: 409 })

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: targetRole, unit_id: unit_id ?? null },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lhg-system-rm.vercel.app'}/auth/callback`,
  })

  if (inviteError) return Response.json({ error: inviteError.message }, { status: 500 })

  // O trigger on_auth_user_created já cria um profile com role='viewer' quando o
  // usuário é adicionado em auth.users. Usar upsert para sobrescrever com o role correto.
  // Nota: profiles não tem coluna email — não incluir ou o upsert falha silenciosamente.
  await admin.from('profiles').upsert(
    {
      user_id: invited.user.id,
      role: targetRole as Database['public']['Enums']['user_role'],
      unit_id: unit_id ?? null,
    },
    { onConflict: 'user_id' }
  )

  return Response.json({ ok: true, user_id: invited.user.id })
}

// ─── PATCH: atualiza role e/ou unit_id de um usuário existente ───────────────

export async function PATCH(req: NextRequest) {
  const { error, status, user, role } = await requireAdminRole()
  if (error || !user) return new Response(error, { status })

  const body = await req.json() as { userId: string; role?: string; unit_id?: string | null }
  const { userId, role: targetRole, unit_id } = body

  if (!userId) return new Response('userId obrigatório', { status: 400 })
  if (userId === user.id) return Response.json({ error: 'Não é possível editar seu próprio perfil aqui.' }, { status: 400 })

  // Apenas super_admin pode atribuir role super_admin
  if (targetRole === 'super_admin' && role !== 'super_admin') {
    return new Response('Apenas super_admin pode atribuir esse perfil', { status: 403 })
  }

  const admin = getAdminClient()
  const update: Record<string, unknown> = {}
  if (targetRole !== undefined) update.role = targetRole
  if (unit_id !== undefined) update.unit_id = unit_id ?? null

  if (Object.keys(update).length === 0) return new Response('Nenhum campo para atualizar', { status: 400 })

  const { error: err } = await admin.from('profiles').update(update).eq('user_id', userId)
  if (err) return Response.json({ error: err.message }, { status: 500 })

  return Response.json({ ok: true })
}

// ─── GET: lista usuários com seus perfis ─────────────────────────────────────

export async function GET() {
  const { error, status } = await requireAdminRole()
  if (error) return new Response(error, { status })

  const admin = getAdminClient()

  const [{ data: profiles }, { data: authUsers }] = await Promise.all([
    admin.from('profiles').select('user_id, role, unit_id, created_at, units(name)').order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const emailMap = new Map(authUsers?.users?.map((u) => [u.id, u.email ?? '']) ?? [])

  const result = (profiles ?? []).map((p) => ({
    ...p,
    email: emailMap.get(p.user_id) ?? '',
    invited_at: authUsers?.users?.find((u) => u.id === p.user_id)?.invited_at ?? null,
    last_sign_in: authUsers?.users?.find((u) => u.id === p.user_id)?.last_sign_in_at ?? null,
  }))

  return Response.json(result)
}

// ─── DELETE: remove acesso de um usuário ─────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { error, status, user, role } = await requireAdminRole()
  if (error || !user) return new Response(error, { status })

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return new Response('userId obrigatório', { status: 400 })

  if (userId === user.id) {
    return Response.json({ error: 'Não é possível remover seu próprio acesso.' }, { status: 400 })
  }

  // admin não pode deletar super_admins
  const admin = getAdminClient()
  const { data: targetProfile } = await admin.from('profiles').select('role').eq('user_id', userId).single()
  if (targetProfile?.role === 'super_admin' && role !== 'super_admin') {
    return Response.json({ error: 'Apenas super_admin pode remover outros super_admins.' }, { status: 403 })
  }

  await admin.from('profiles').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId)

  return Response.json({ ok: true })
}
