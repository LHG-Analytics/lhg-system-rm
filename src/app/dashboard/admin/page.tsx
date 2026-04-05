import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { UsersManager } from './_components/users-manager'

export const metadata = { title: 'Usuários — LHG Revenue Manager' }

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (profile?.role !== 'super_admin') redirect('/dashboard')

  const admin = getAdminClient()

  const [profilesResult, authUsersResult, unitsResult] = await Promise.allSettled([
    admin.from('profiles').select('user_id, role, unit_id, created_at').order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('units').select('id, name').eq('is_active', true).order('name'),
  ])

  const profiles  = profilesResult.status  === 'fulfilled' ? (profilesResult.value.data  ?? []) : []
  const authUsers = authUsersResult.status === 'fulfilled' ? (authUsersResult.value.data?.users ?? []) : []
  const unitsData = unitsResult.status     === 'fulfilled' ? (unitsResult.value.data     ?? []) : []

  const emailMap    = new Map(authUsers.map((u) => [u.id, u.email        ?? '']))
  const invitedMap  = new Map(authUsers.map((u) => [u.id, u.invited_at   ?? null]))
  const lastSignMap = new Map(authUsers.map((u) => [u.id, u.last_sign_in_at ?? null]))

  const users = profiles.map((p) => ({
    user_id:    p.user_id,
    email:      emailMap.get(p.user_id)    ?? '',
    role:       p.role,
    unit_id:    p.unit_id,
    created_at: p.created_at,
    invited_at: invitedMap.get(p.user_id)  ?? null,
    last_sign_in: lastSignMap.get(p.user_id) ?? null,
  }))

  return (
    <UsersManager
      initialUsers={users}
      units={unitsData ?? []}
      currentUserId={user.id}
    />
  )
}
