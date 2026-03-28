import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import {
  fetchCompanyKPIs,
  fetchRestaurantKPIs,
  fetchBookingsKPIs,
  todayOperational,
  toApiDate,
} from '@/lib/lhg-analytics/client'
import type { Database } from '@/types/database.types'
import type { UnitKPIData, KPIQueryParams } from '@/lib/lhg-analytics/types'

function getAdminClient() {
  return createSupabaseAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ unitSlug: string }> }
) {
  const { unitSlug } = await params

  // Resolve unit from DB
  const supabase = getAdminClient()
  const { data: unit, error } = await supabase
    .from('units')
    .select('slug, api_base_url')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (error || !unit?.api_base_url) {
    return NextResponse.json(
      { error: `Unit not found or has no API URL: ${unitSlug}` },
      { status: 404 }
    )
  }

  // Date params: use query string or default to today's operational day
  const searchParams = request.nextUrl.searchParams
  let kpiParams: KPIQueryParams

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (startDate && endDate) {
    kpiParams = { startDate, endDate }
  } else {
    const month = searchParams.get('month') // YYYY-MM
    if (month) {
      const [year, m] = month.split('-').map(Number)
      const firstDay = new Date(year, m - 1, 1)
      const lastDay = new Date(year, m, 0)
      kpiParams = { startDate: toApiDate(firstDay), endDate: toApiDate(lastDay) }
    } else {
      kpiParams = todayOperational()
    }
  }

  const lhgUnit = { slug: unit.slug, apiBaseUrl: unit.api_base_url }

  // Fetch all three endpoints in parallel — restaurant and bookings failures are non-fatal
  const [companyResult, restaurantResult, bookingsResult] = await Promise.allSettled([
    fetchCompanyKPIs(lhgUnit, kpiParams),
    fetchRestaurantKPIs(lhgUnit, kpiParams),
    fetchBookingsKPIs(lhgUnit, kpiParams),
  ])

  if (companyResult.status === 'rejected') {
    console.error(`[KPIs] Company fetch failed for ${unitSlug}:`, companyResult.reason)
    return NextResponse.json(
      { error: 'Failed to fetch company KPIs', detail: String(companyResult.reason) },
      { status: 502 }
    )
  }

  const data: UnitKPIData = {
    company: companyResult.value,
    restaurant: restaurantResult.status === 'fulfilled' ? restaurantResult.value : null,
    bookings: bookingsResult.status === 'fulfilled' ? bookingsResult.value : null,
    fetchedAt: new Date().toISOString(),
  }

  if (restaurantResult.status === 'rejected') {
    console.warn(`[KPIs] Restaurant fetch failed for ${unitSlug}:`, restaurantResult.reason)
  }
  if (bookingsResult.status === 'rejected') {
    console.warn(`[KPIs] Bookings fetch failed for ${unitSlug}:`, bookingsResult.reason)
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store', // real-time data
    },
  })
}
