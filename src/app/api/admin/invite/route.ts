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

// ─── POST: convida um novo usuário por email ──────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  // Apenas super_admin pode convidar
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    return new Response('Acesso negado', { status: 403 })
  }

  const body = await req.json() as { email: string; role: string; unit_id?: string }
  const { email, role, unit_id } = body

  if (!email || !role) {
    return new Response('email e role são obrigatórios', { status: 400 })
  }

  const admin = getAdminClient()

  // Verifica se já existe usuário com esse email no auth
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const alreadyExists = existingUsers?.users?.some((u) => u.email === email)
  if (alreadyExists) {
    return Response.json({ error: 'Este email já possui acesso.' }, { status: 409 })
  }

  // Envia o invite — Supabase cria o usuário e manda o magic link
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role, unit_id: unit_id ?? null },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lhg-system-rm.vercel.app'}/auth/callback`,
  })

  if (inviteError) {
    return Response.json({ error: inviteError.message }, { status: 500 })
  }

  // Cria o profile imediatamente (antes do usuário aceitar o invite)
  await admin.from('profiles').insert({
    user_id: invited.user.id,
    email,
    role: role as Database['public']['Enums']['user_role'],
    unit_id: unit_id ?? null,
  })

  return Response.json({ ok: true, user_id: invited.user.id })
}

// ─── GET: lista usuários com seus perfis ─────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    return new Response('Acesso negado', { status: 403 })
  }

  const admin = getAdminClient()

  // Busca perfis + usuários auth para cruzar email
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    return new Response('Acesso negado', { status: 403 })
  }

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return new Response('userId obrigatório', { status: 400 })

  // Não permite remover a si mesmo
  if (userId === user.id) {
    return Response.json({ error: 'Não é possível remover seu próprio acesso.' }, { status: 400 })
  }

  const admin = getAdminClient()
  await admin.from('profiles').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId)

  return Response.json({ ok: true })
}
