import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { queryChannelKPIs, queryPeriodMix } from '@/lib/automo/channel-kpis'
import { resolvePreset, toLhgDate } from '@/lib/date-range'

const VALID_STATUSES = ['FINALIZADA', 'TRANSFERIDA', 'CANCELADA', 'ABERTA', 'TODAS'] as const
type RentalStatus = typeof VALID_STATUSES[number]

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const unitSlug = sp.get('unitSlug')
  if (!unitSlug) return NextResponse.json({ error: 'unitSlug obrigatório' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  // Confirma que a unidade existe e está ativa
  const { data: unit } = await supabase
    .from('units')
    .select('slug')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  const startHour = Math.min(23, Math.max(0, parseInt(sp.get('startHour') ?? '6') || 6))
  const endHour   = Math.min(23, Math.max(0, parseInt(sp.get('endHour')   ?? '5') || 5))

  const dtParam   = sp.get('dateType')
  const dateType  = (['all', 'checkin', 'checkout'] as const).includes(dtParam as 'all' | 'checkin' | 'checkout')
    ? (dtParam as 'all' | 'checkin' | 'checkout')
    : 'checkin'

  const stParam      = sp.get('status')
  const rentalStatus: RentalStatus = VALID_STATUSES.includes(stParam as RentalStatus)
    ? (stParam as RentalStatus)
    : 'FINALIZADA'

  const dateRange     = resolvePreset(sp.get('preset'), sp.get('start'), sp.get('end'))
  const startDDMMYYYY = toLhgDate(dateRange.startDate)
  const endDDMMYYYY   = toLhgDate(dateRange.endDate)

  try {
    const [company, channelKPIs, periodMix] = await Promise.all([
      fetchCompanyKPIsFromAutomo(
        unitSlug,
        startDDMMYYYY,
        endDDMMYYYY,
        startHour,
        endHour,
        rentalStatus,
        dateType,
      ),
      queryChannelKPIs(unitSlug, startDDMMYYYY, endDDMMYYYY).catch(() => []),
      queryPeriodMix(unitSlug, startDDMMYYYY, endDDMMYYYY, rentalStatus, startHour, endHour, dateType).catch(() => []),
    ])
    return NextResponse.json({ company, channelKPIs, periodMix, dateRange }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[/api/dashboard/kpis]', e)
    return NextResponse.json({ error: 'Falha ao buscar KPIs' }, { status: 502 })
  }
}
