import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  fetchCompanyKPIs,
  fetchBookingsKPIs,
  yearToDate,
} from '@/lib/lhg-analytics/client'
import { DashboardKPICards } from '@/components/dashboard/kpi-cards'
import { DashboardCharts } from '@/components/dashboard/charts'

interface DashboardPageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, role')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .single()

  if (!profile) redirect('/login')

  // Resolve active unit: prefer URL param, fall back to profile unit
  let activeUnit: { slug: string; api_base_url: string | null; name: string } | null = null

  if (unitSlug) {
    const { data } = await supabase
      .from('units')
      .select('slug, api_base_url, name')
      .eq('slug', unitSlug)
      .eq('is_active', true)
      .single()
    activeUnit = data
  }

  if (!activeUnit && profile.unit_id) {
    const { data } = await supabase
      .from('units')
      .select('slug, api_base_url, name')
      .eq('id', profile.unit_id)
      .single()
    activeUnit = data
  }

  if (!activeUnit) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">Nenhuma unidade disponível.</p>
        </div>
      </div>
    )
  }

  const kpiParams = yearToDate() // acumulado do ano — evita sazonalidade para o agente RM
  const lhgUnit = { slug: activeUnit.slug, apiBaseUrl: activeUnit.api_base_url ?? '' }

  const [companyResult, bookingsResult] = await Promise.allSettled([
    activeUnit.api_base_url ? fetchCompanyKPIs(lhgUnit, kpiParams) : Promise.reject('no api url'),
    activeUnit.api_base_url ? fetchBookingsKPIs(lhgUnit, kpiParams) : Promise.reject('no api url'),
  ])

  const company = companyResult.status === 'fulfilled' ? companyResult.value : null
  const bookings = bookingsResult.status === 'fulfilled' ? bookingsResult.value : null

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{activeUnit.name}</h1>
        <p className="text-sm text-muted-foreground">
          {kpiParams.startDate} — {kpiParams.endDate}
        </p>
      </div>

      <DashboardKPICards company={company} bookings={bookings} />
      <DashboardCharts company={company} />
    </div>
  )
}
