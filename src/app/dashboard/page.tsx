import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchCompanyKPIs } from '@/lib/lhg-analytics/client'
import { resolvePreset, toLhgDate, fmtDisplay } from '@/lib/date-range'
import { DashboardKPICards } from '@/components/dashboard/kpi-cards'
import { DashboardCharts } from '@/components/dashboard/charts'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
import { DateRangePicker } from '@/components/dashboard/date-range-picker'

interface DashboardPageProps {
  searchParams: Promise<{
    unit?:   string
    preset?: string
    start?:  string
    end?:    string
  }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { unit: unitSlug, preset, start, end } = await searchParams

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, role')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .single()

  if (!profile) redirect('/login')

  // Resolve active unit
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
    const { data } = await supabase
      .from('units')
      .select('slug, api_base_url, name')
      .eq('is_active', true)
      .order('name')
      .limit(1)
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

  // Resolve date range from URL preset / custom dates
  const dateRange  = resolvePreset(preset, start, end)
  const kpiParams  = {
    startDate: toLhgDate(dateRange.startDate),
    endDate:   toLhgDate(dateRange.endDate),
  }
  const lhgUnit = { slug: activeUnit.slug, apiBaseUrl: activeUnit.api_base_url ?? '' }

  const companyResult = await (
    activeUnit.api_base_url ? fetchCompanyKPIs(lhgUnit, kpiParams) : Promise.reject('no api url')
  ).catch(() => null)

  const company = companyResult

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Header com seletor de período */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{activeUnit.name}</h1>
          <p className="text-sm text-muted-foreground">
            {dateRange.label} · {fmtDisplay(dateRange.startDate)} até {fmtDisplay(dateRange.endDate)}
          </p>
        </div>
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
      </div>

      <DashboardKPICards company={company} />
      <DashboardCharts company={company} />
      <OccupancyHeatmap
        unitSlug={activeUnit.slug}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
        rangeLabel={dateRange.label}
      />
    </div>
  )
}
