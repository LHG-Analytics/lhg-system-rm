import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Dispara o cron de revisões agendadas de forma síncrona, server-to-server,
// usando o CRON_SECRET para autenticação — protegido por auth de admin.
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

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado no servidor.' }, { status: 500 })
  }

  // Chama o cron internamente via URL absoluta
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.VERCEL_URL
    ?? 'http://localhost:3000'

  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`

  const res = await fetch(`${url}/api/cron/revisoes`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json({ error: data.error ?? 'Erro ao executar revisões', detail: data }, { status: res.status })
  }

  return NextResponse.json(data)
}
