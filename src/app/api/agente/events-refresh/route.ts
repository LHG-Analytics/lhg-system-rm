import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { refreshEventsForUnit } from '@/lib/agente/events'

// POST /api/agente/events-refresh
// Body: { unitId: string } — refresh manual do cache de eventos via Apify
export async function POST(req: NextRequest) {
  const { unitId } = await req.json() as { unitId?: string }
  if (!unitId) return NextResponse.json({ error: 'unitId obrigatório' }, { status: 400 })

  // Verifica autenticação via cookie de sessão Supabase
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: cfg } = await supabase
    .from('rm_agent_config')
    .select('city')
    .eq('unit_id', unitId)
    .single()

  if (!cfg?.city) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  const city = (cfg.city as string).split(',')[0].trim()
  const result = await refreshEventsForUnit(unitId, city)

  return NextResponse.json({ ok: true, status: result.status })
}
