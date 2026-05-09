import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { bootstrapPricingLessons } from '@/lib/agente/bootstrap-learning'

// POST /api/admin/bootstrap-learning
// { unitSlug?: string } — omitir para rodar em todas as unidades
// Popula rm_pricing_lessons e rm_price_elasticity a partir do histórico de tabelas importadas.
// Admin+ apenas. Safe para chamar repetidamente.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return new Response('Acesso negado', { status: 403 })
  }

  const body = await req.json() as { unitSlug?: string }

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  if (body.unitSlug) {
    const { data: unit } = await admin
      .from('units')
      .select('id, slug')
      .eq('slug', body.unitSlug)
      .single()
    if (!unit) return new Response('Unidade não encontrada', { status: 404 })
    console.log('[bootstrap-learning] Iniciando para unidade:', body.unitSlug)
    try {
      const result = await bootstrapPricingLessons(unit.id, unit.slug)
      console.log('[bootstrap-learning] Concluído:', result)
      return Response.json(result)
    } catch (e) {
      console.error('[bootstrap-learning] Erro:', e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // Todas as unidades em paralelo
  const { data: units } = await admin.from('units').select('id, slug')
  console.log('[bootstrap-learning] Iniciando para todas as unidades:', (units ?? []).map((u) => u.slug))
  const results = await Promise.allSettled(
    (units ?? []).map((u) => bootstrapPricingLessons(u.id, u.slug)),
  )

  return Response.json({
    units: (units ?? []).map((u, i) => ({
      slug: u.slug,
      result: results[i].status === 'fulfilled'
        ? results[i].value
        : { error: String((results[i] as PromiseRejectedResult).reason) },
    })),
  })
}
