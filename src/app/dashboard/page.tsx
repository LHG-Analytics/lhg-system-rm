import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolvePreset, toLhgDate, fmtDisplay, toQueryEndDate } from '@/lib/date-range'
import { DashboardKPICards } from '@/components/dashboard/kpi-cards'
import { DashboardCharts } from '@/components/dashboard/charts'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
import { TurnoHeatmap } from '@/components/dashboard/turno-heatmap'
import { DateRangePicker } from '@/components/dashboard/date-range-picker'
import { WeatherWidget } from '@/components/dashboard/weather-widget'
import { AnomaliesWidget } from '@/components/dashboard/anomalies-widget'
import { RealtimeOccupancyWidget } from '@/components/dashboard/realtime-occupancy-widget'
import { CompareButton } from '@/components/dashboard/compare-button'
import { fetchWeatherData } from '@/lib/agente/weather'
import { getWeatherInsight } from '@/lib/agente/weather-insight'
import { cachedCompanyKPIs, cachedChannelKPIs } from '@/lib/automo/cached-kpis'
import type { ChannelKPIRow } from '@/lib/kpis/types'
import type { BudgetYearly } from '@/lib/budget/google-sheets'

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
    weekdays?:   string
  }>
}

/** "0,3,6" → [0,3,6]. Vazio/ausente/inválido → undefined (sem filtro). */
function parseWeekdays(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined
  const days = raw.split(',').map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6)
  return days.length > 0 && days.length < 7 ? days : undefined
}

const VALID_STATUSES = ['FINALIZADA', 'TRANSFERIDA', 'CANCELADA', 'ABERTA', 'TODAS'] as const
type RentalStatus = typeof VALID_STATUSES[number]

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { unit: unitSlug, preset, start, end, startHour: shParam, endHour: ehParam, dateType: dtParam, status: statusParam, weekdays: weekdaysParam } = await searchParams

  const startHour    = Math.min(23, Math.max(0, shParam !== undefined ? (parseInt(shParam) || 0) : 6))
  const endHour      = Math.min(23, Math.max(0, ehParam !== undefined ? (parseInt(ehParam) || 0) : 5))
  const dateType     = (['all', 'checkin', 'checkout'] as const).includes(dtParam as 'all' | 'checkin' | 'checkout')
    ? (dtParam as 'all' | 'checkin' | 'checkout')
    : 'checkin'
  const rentalStatus: RentalStatus = VALID_STATUSES.includes(statusParam as RentalStatus)
    ? (statusParam as RentalStatus)
    : 'FINALIZADA'
  const weekdays = parseWeekdays(weekdaysParam)

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
  const queryEndDate  = toQueryEndDate(dateRange.preset, dateRange.startDate, dateRange.endDate)
  const startDDMMYYYY = toLhgDate(dateRange.startDate)
  const endDDMMYYYY   = toLhgDate(queryEndDate)

  const { data: agentConfig } = await supabase
    .from('rm_agent_config')
    .select('city, budget_yearly')
    .eq('unit_id', activeUnit.id)
    .single()

  const [company, weatherResult, channelKPIsResult] = await Promise.all([
    cachedCompanyKPIs(
      activeUnit.slug,
      startDDMMYYYY,
      endDDMMYYYY,
      startHour,
      endHour,
      rentalStatus,
      dateType,
      weekdays,
    ).catch((e) => {
      console.error(`[Dashboard/KPIs] Falha para ${activeUnit.slug} (${startDDMMYYYY}→${endDDMMYYYY} ${startHour}h-${endHour}h dateType=${dateType} status=${rentalStatus}):`, e)
      return null
    }),
    agentConfig?.city ? fetchWeatherData(agentConfig.city) : Promise.resolve({ status: 'unconfigured' as const }),
    cachedChannelKPIs(activeUnit.slug, startDDMMYYYY, endDDMMYYYY, weekdays).catch(() => [] as ChannelKPIRow[]),
  ])

  // Insight IA clima × demanda — usa cache de 4h; regenera em background se vencido
  const weatherInsight = await getWeatherInsight(activeUnit.id, weatherResult, company)

  const budgetYearly = (agentConfig?.budget_yearly ?? null) as BudgetYearly | null

  // Orçamento do mês atual para os KPI cards (linha "Meta mês")
  const now = new Date()
  const curMonthBudget = budgetYearly?.[String(now.getFullYear())]?.[String(now.getMonth() + 1)] ?? null

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
              weekdays:  weekdays ?? [],
            }}
          />
        </div>
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
      </div>

      <WeatherWidget result={weatherResult} insight={weatherInsight} />
      <RealtimeOccupancyWidget unitSlug={activeUnit.slug} />
      <AnomaliesWidget unitSlug={activeUnit.slug} />
      <DashboardKPICards company={company} budgetMonth={curMonthBudget} />
      <DashboardCharts company={company} channelKPIs={channelKPIsResult} periodMix={company?.BillingRentalType ?? []} />
      <Suspense fallback={null}>
        <OccupancyHeatmap
          unitSlug={activeUnit.slug}
          startDate={dateRange.startDate}
          endDate={queryEndDate}
          rangeLabel={dateRange.label}
        />
      </Suspense>
      <Suspense fallback={null}>
        <TurnoHeatmap
          unitSlug={activeUnit.slug}
          startDate={dateRange.startDate}
          endDate={queryEndDate}
        />
      </Suspense>
    </div>
  )
}
