import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { generateWeeklyReport } from '@/lib/reports/generate-weekly-report'

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { unitSlug, dateFrom, dateTo } = body as {
    unitSlug: string
    dateFrom: string  // YYYY-MM-DD
    dateTo: string    // YYYY-MM-DD
  }

  if (!unitSlug || !dateFrom || !dateTo) {
    return NextResponse.json({ error: 'unitSlug, dateFrom, dateTo required' }, { status: 400 })
  }

  const admin = adminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  // Insert generating row immediately
  const { data: reportRow, error } = await admin
    .from('rm_weekly_reports')
    .upsert({
      unit_id: unit.id,
      period_start: dateFrom,
      period_end: dateTo,
      status: 'generating',
    }, { onConflict: 'unit_id,period_start' })
    .select('id')
    .single()

  if (error || !reportRow) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Fire-and-forget generation (survives client disconnect)
  after(generateWeeklyReport(unitSlug, dateFrom, dateTo))

  return NextResponse.json({ id: reportRow.id, status: 'generating' })
}
