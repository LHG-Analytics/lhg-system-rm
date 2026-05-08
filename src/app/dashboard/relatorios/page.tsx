import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { Database } from '@/types/database.types'
import { RelatoriosPageClient } from './_components/relatorios-page-client'
import type { ReportMetadata } from '@/lib/reports/types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface RelatoriosPageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function RelatoriosPage({ searchParams }: RelatoriosPageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()

  // Resolve unidade ativa
  let activeUnit: { id: string; slug: string; name: string } | null = null

  if (unitSlug) {
    const { data } = await admin.from('units').select('id, slug, name').eq('slug', unitSlug).eq('is_active', true).single()
    activeUnit = data
  }

  if (!activeUnit) {
    const { data: profile } = await supabase.from('profiles').select('unit_id').eq('user_id', user.id).single()
    if (profile?.unit_id) {
      const { data } = await admin.from('units').select('id, slug, name').eq('id', profile.unit_id).eq('is_active', true).single()
      activeUnit = data
    }
  }

  if (!activeUnit) {
    const { data } = await admin.from('units').select('id, slug, name').eq('is_active', true).limit(1).single()
    activeUnit = data
  }

  if (!activeUnit) redirect('/dashboard')

  // Fetch initial list of reports (metadata only)
  const { data: reports } = await admin
    .from('rm_weekly_reports')
    .select('id, period_start, period_end, status, generated_at, error_msg')
    .eq('unit_id', activeUnit.id)
    .order('period_start', { ascending: false })
    .limit(20)

  return (
    <RelatoriosPageClient
      initialReports={(reports ?? []) as ReportMetadata[]}
      unitSlug={activeUnit.slug}
      unitName={activeUnit.name}
      unitId={activeUnit.id}
    />
  )
}
