import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getRealtimeOccupancyByCategory } from '@/lib/automo/realtime-occupancy'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const unitSlug = new URL(request.url).searchParams.get('unitSlug') ?? ''
  if (!unitSlug) return NextResponse.json({ error: 'unitSlug obrigatório' }, { status: 400 })

  // Verifica acesso do usuário à unidade
  const admin = getAdminClient()
  const { data: profile } = await supabase.from('profiles').select('role, unit_id').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 403 })

  const { data: unit } = await admin.from('units').select('id, slug').eq('slug', unitSlug).eq('is_active', true).single()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id && profile.unit_id !== null) {
    return NextResponse.json({ error: 'Sem acesso a essa unidade' }, { status: 403 })
  }

  const rows = await getRealtimeOccupancyByCategory(unitSlug).catch(() => [])

  return NextResponse.json({
    rows,
    fetchedAt: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
