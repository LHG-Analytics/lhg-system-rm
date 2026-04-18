import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { ConfiguracoesPageClient } from './_components/configuracoes-page-client'

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name, notification_preferences, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/login')

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: units }, { data: agentConfigs }] = await Promise.all([
    admin.from('units').select('id, name, slug, city').order('name'),
    admin.from('rm_agent_config').select('unit_id, city, timezone'),
  ])

  const { unit } = await searchParams

  return (
    <ConfiguracoesPageClient
      userEmail={user.email ?? ''}
      userRole={profile.role}
      displayName={profile.display_name}
      notificationPreferences={profile.notification_preferences as Record<string, boolean>}
      units={units ?? []}
      agentConfigs={agentConfigs ?? []}
      activeUnitSlug={unit ?? (units?.[0]?.slug ?? '')}
    />
  )
}
