import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'edge'

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const unitSlug = request.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return NextResponse.json({ error: 'unitSlug required' }, { status: 400 })

  const admin = adminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  const { data, error } = await admin
    .from('rm_weekly_reports')
    .select('id, period_start, period_end, status, generated_at, error_msg')
    .eq('unit_id', unit.id)
    .order('period_start', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ reports: data })
}
