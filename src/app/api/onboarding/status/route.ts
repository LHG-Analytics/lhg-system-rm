import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ completedSteps: [] })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) {
    return NextResponse.json({ completedSteps: [] })
  }

  const unitSlug = new URL(request.url).searchParams.get('unitSlug') ?? ''
  const admin = getAdminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return NextResponse.json({ completedSteps: [] })

  const unitId = unit.id

  const [
    priceImports,
    agentConfig,
    competitorSnaps,
    allProfiles,
    proposals,
    approvedProposals,
    lessons,
    doneSnaps,
  ] = await Promise.allSettled([
    admin.from('price_imports')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .eq('import_type', 'prices'),
    admin.from('rm_agent_config')
      .select('budget_sheet_url')
      .eq('unit_id', unitId)
      .maybeSingle(),
    admin.from('competitor_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId),
    admin.from('profiles')
      .select('user_id', { count: 'exact', head: true }),
    admin.from('price_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId),
    admin.from('price_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .eq('status', 'approved'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from('rm_pricing_lessons')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId),
    admin.from('competitor_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .eq('status', 'done'),
  ])

  const completedSteps: string[] = ['monitor-dashboard']

  if (priceImports.status === 'fulfilled' && (priceImports.value.count ?? 0) > 0)
    completedSteps.push('import-prices')

  const cfg = agentConfig.status === 'fulfilled' ? agentConfig.value.data : null
  if (cfg?.budget_sheet_url) completedSteps.push('budget-sheet')

  if (competitorSnaps.status === 'fulfilled' && (competitorSnaps.value.count ?? 0) > 0)
    completedSteps.push('competitors')

  if (allProfiles.status === 'fulfilled' && (allProfiles.value.count ?? 0) >= 2)
    completedSteps.push('invite-team')

  if (proposals.status === 'fulfilled' && (proposals.value.count ?? 0) > 0)
    completedSteps.push('generate-proposal')

  if (approvedProposals.status === 'fulfilled' && (approvedProposals.value.count ?? 0) > 0)
    completedSteps.push('approve-proposal')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (lessons.status === 'fulfilled' && ((lessons.value as any).count ?? 0) > 0)
    completedSteps.push('agent-performance')

  if (doneSnaps.status === 'fulfilled' && (doneSnaps.value.count ?? 0) > 0)
    completedSteps.push('analyze-competitors')

  return NextResponse.json({ completedSteps })
}
