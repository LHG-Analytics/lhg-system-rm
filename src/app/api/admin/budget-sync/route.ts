import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { syncBudgetForUnit } from '@/lib/budget/google-sheets'
import type { Database } from '@/types/database.types'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single()
  const role = profile?.role
  if (role !== 'super_admin' && role !== 'admin') return { error: 'Acesso negado', status: 403 as const }
  return { error: null, status: 200 as const }
}

// POST /api/admin/budget-sync — dispara sync manual para uma unidade
export async function POST(req: NextRequest) {
  const { error, status } = await requireAdmin()
  if (error) return new Response(error, { status })

  const { unitSlug } = await req.json() as { unitSlug?: string }
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  try {
    const result = await syncBudgetForUnit(unit.id)
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 422 })
  }
}
