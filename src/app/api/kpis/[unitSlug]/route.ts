import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { todayOperational, toApiDate } from '@/lib/kpis/period'
import type { Database } from '@/types/database.types'
import type { UnitKPIData } from '@/lib/kpis/types'

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

  // Valida que a unidade existe e está ativa
  const supabase = getAdminClient()
  const { data: unit, error } = await supabase
    .from('units')
    .select('slug')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (error || !unit) {
    return NextResponse.json(
      { error: `Unidade não encontrada ou inativa: ${unitSlug}` },
      { status: 404 }
    )
  }

  // Determina o período de consulta
  const searchParams = request.nextUrl.searchParams
  let startDate: string
  let endDate: string

  const qs = searchParams.get('startDate')
  const qe = searchParams.get('endDate')

  if (qs && qe) {
    startDate = qs
    endDate   = qe
  } else {
    const month = searchParams.get('month') // YYYY-MM
    if (month) {
      const [year, m] = month.split('-').map(Number)
      startDate = toApiDate(new Date(year, m - 1, 1))
      endDate   = toApiDate(new Date(year, m, 0))
    } else {
      const today = todayOperational()
      startDate   = today.startDate
      endDate     = today.endDate
    }
  }

  try {
    const company = await fetchCompanyKPIsFromAutomo(unitSlug, startDate, endDate)

    const data: UnitKPIData = {
      company,
      restaurant: null,
      bookings:   null,
      fetchedAt:  new Date().toISOString(),
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error(`[KPIs/Automo] Erro para ${unitSlug}:`, err)
    return NextResponse.json(
      { error: 'Falha ao buscar KPIs do Automo', detail: String(err) },
      { status: 502 }
    )
  }
}
