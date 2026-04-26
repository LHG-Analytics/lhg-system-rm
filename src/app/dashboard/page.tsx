import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { resolvePreset, toLhgDate, fmtDisplay } from '@/lib/date-range'
import { DashboardKPICards } from '@/components/dashboard/kpi-cards'
import { DashboardCharts } from '@/components/dashboard/charts'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
import { DateRangePicker } from '@/components/dashboard/date-range-picker'
import { WeatherWidget } from '@/components/dashboard/weather-widget'
import { CompareButton } from '@/components/dashboard/compare-button'
import { fetchWeatherData } from '@/lib/agente/weather'
import { getWeatherInsight } from '@/lib/agente/weather-insight'
import { queryChannelKPIs, queryPeriodMix } from '@/lib/automo/channel-kpis'
import type { ChannelKPIRow, BillingRentalTypeItem } from '@/lib/kpis/types'

interface DashboardPageProps {
  searchParams: Promise<{
    unit?:       string
    preset?:     string
    start?:      string
    end?:        string
    startHour?:  string
    endHour?:    string
    dateType?:   string
    status?:     string
  }>
}

const VALID_STATUSES = ['FINALIZADA', 'TRANSFERIDA', 'CANCELADA', 'ABERTA', 'TODAS'] as const
type RentalStatus = typeof VALID_STATUSES[number]

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { unit: unitSlug, preset, start, end, startHour: shParam, endHour: ehParam, dateType: dtParam, status: statusParam } = await searchParams

  const startHour    = Math.min(23, Math.max(0, shParam !== undefined ? (parseInt(shParam) || 0) : 6))
  const endHour      = Math.min(23, Math.max(0, ehParam !== undefined ? (parseInt(ehParam) || 0) : 5))
  const dateType     = (['all', 'checkin', 'checkout'] as const).includes(dtParam as 'all' | 'checkin' | 'checkout')
    ? (dtParam as 'all' | 'checkin' | 'checkout')
    : 'checkin'
  const rentalStatus: RentalStatus = VALID_STATUSES.includes(statusParam as RentalStatus)
    ? (statusParam as RentalStatus)
    : 'FINALIZADA'

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, role')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .single()

  if (!profile) redirect('/login')

  // Resolve active unit
  let activeUnit: { id: string; slug: string; name: string } | null = null

  if (unitSlug) {
    const { data } = await supabase
      .from('units')
      .select('id, slug, name')
      .eq('slug', unitSlug)
      .eq('is_active', true)
      .single()
    activeUnit = data
  }

  if (!activeUnit && profile.unit_id) {
    const { data } = await supabase
      .from('units')
      .select('id, slug, name')
      .eq('id', profile.unit_id)
      .single()
    activeUnit = data
  }

  if (!activeUnit) {
    const { data } = await supabase
      .from('units')
      .select('id, slug, name')
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
  const startDDMMYYYY = toLhgDate(dateRange.startDate)
  const endDDMMYYYY   = toLhgDate(dateRange.endDate)

  const { data: agentConfig } = await supabase
    .from('rm_agent_config')
    .select('city')
    .eq('unit_id', activeUnit.id)
    .single()

  const [company, weatherResult, channelKPIsResult, periodMixResult] = await Promise.all([
    fetchCompanyKPIsFromAutomo(
      activeUnit.slug,
      startDDMMYYYY,
      endDDMMYYYY,
      startHour,
      endHour,
      rentalStatus,
      dateType,
    ).catch((e) => {
      console.error(`[Dashboard/KPIs] Falha para ${activeUnit.slug} (${startDDMMYYYY}→${endDDMMYYYY} ${startHour}h-${endHour}h dateType=${dateType} status=${rentalStatus}):`, e)
      return null
    }),
    agentConfig?.city ? fetchWeatherData(agentConfig.city) : Promise.resolve({ status: 'unconfigured' as const }),
    queryChannelKPIs(activeUnit.slug, startDDMMYYYY, endDDMMYYYY).catch(() => [] as ChannelKPIRow[]),
    queryPeriodMix(activeUnit.slug, startDDMMYYYY, endDDMMYYYY,
      rentalStatus === 'TODAS' ? '' :
      rentalStatus === 'ABERTA' ? 'AND la.fimocupacaotipo IS NULL' :
      `AND la.fimocupacaotipo = '${rentalStatus}'`
    ).catch(() => [] as BillingRentalTypeItem[]),
  ])

  // Insight IA clima × demanda — usa cache de 4h; regenera em background se vencido
  const weatherInsight = await getWeatherInsight(activeUnit.id, weatherResult, company)

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{activeUnit.name}</h1>
            <p className="text-sm text-muted-foreground">
              {dateRange.preset === 'custom'
                ? dateRange.label
                : `${dateRange.label} · ${fmtDisplay(dateRange.startDate)} até ${fmtDisplay(dateRange.endDate)}`
              }
            </p>
          </div>
          <CompareButton
            unitSlug={activeUnit.slug}
            unitName={activeUnit.name}
            filters={{
              preset:    (preset ?? 'this-month') as import('@/lib/date-range').DatePreset,
              startDate: dateRange.startDate,
              endDate:   dateRange.endDate,
              startHour,
              endHour,
              dateType,
              status:    rentalStatus,
            }}
          />
        </div>
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
      </div>

      <WeatherWidget result={weatherResult} insight={weatherInsight} />
      <DashboardKPICards company={company} />
      <DashboardCharts company={company} channelKPIs={channelKPIsResult} periodMix={periodMixResult} />
      <Suspense fallback={null}>
        <OccupancyHeatmap
          unitSlug={activeUnit.slug}
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
          rangeLabel={dateRange.label}
        />
      </Suspense>
    </div>
  )
}
