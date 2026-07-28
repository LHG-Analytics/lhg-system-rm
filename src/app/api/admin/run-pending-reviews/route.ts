import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPendingReviews } from '@/lib/cron/run-reviews'

// 800s = teto GA do plano Pro (era 60s — menor até que o próprio cron, que já
// tinha 300s; inconsistente e insuficiente para o mesmo processamento).
export const maxDuration = 800

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await runPendingReviews()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
