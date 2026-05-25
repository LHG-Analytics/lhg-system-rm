import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { computeAndPersistGaps } from '@/lib/competitors/detect-changes'
import type { Database } from '@/types/database.types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) {
    return new Response('Acesso negado', { status: 403 })
  }

  const { unitSlug } = await req.json() as { unitSlug: string }
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  try {
    const result = await computeAndPersistGaps(unit.id, 14)
    return Response.json({ inserted: result.inserted })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
