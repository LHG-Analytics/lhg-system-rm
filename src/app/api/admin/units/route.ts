import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { invalidateUnitCache } from '@/lib/automo/unit-config'
import { invalidatePool } from '@/lib/automo/client'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) return null
  return profile
}

// GET /api/admin/units — lista todas as unidades
export async function GET() {
  const profile = await requireAdmin()
  if (!profile) return Response.json({ error: 'Sem permissão' }, { status: 403 })

  const admin = getAdmin()
  const { data, error } = await admin
    .from('units')
    .select('id, name, slug, city, state, is_active, automo_env_key, automo_category_ids, period_type, logo_path, created_at')
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ units: data })
}

// POST /api/admin/units — cria nova unidade (só super_admin)
export async function POST(req: NextRequest) {
  const profile = await requireAdmin()
  if (!profile) return Response.json({ error: 'Sem permissão' }, { status: 403 })
  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) return Response.json({ error: 'Apenas super_admin pode criar unidades' }, { status: 403 })

  const body = await req.json()
  const { name, slug, city, state, automo_env_key, automo_category_ids, period_type, logo_path } = body

  if (!name || !slug) return Response.json({ error: 'name e slug são obrigatórios' }, { status: 400 })

  const admin = getAdmin()
  const { data, error } = await admin
    .from('units')
    .insert({
      name,
      slug,
      city: city || null,
      state: state || null,
      automo_env_key: automo_env_key || null,
      automo_category_ids: automo_category_ids ?? [],
      period_type: period_type ?? 'standard',
      logo_path: logo_path || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ unit: data }, { status: 201 })
}

// PATCH /api/admin/units — atualiza unidade existente (só super_admin)
export async function PATCH(req: NextRequest) {
  const profile = await requireAdmin()
  if (!profile) return Response.json({ error: 'Sem permissão' }, { status: 403 })
  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) return Response.json({ error: 'Apenas super_admin pode editar unidades' }, { status: 403 })

  const body = await req.json()
  const { id, ...updates } = body

  if (!id) return Response.json({ error: 'id é obrigatório' }, { status: 400 })

  // Campos permitidos para update
  const allowed = ['name', 'slug', 'city', 'state', 'is_active', 'automo_env_key', 'automo_category_ids', 'period_type', 'logo_path']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) patch[key] = updates[key]
  }

  const admin = getAdmin()
  const { data, error } = await admin
    .from('units')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Invalida caches para a unidade editada
  if (data?.slug) {
    invalidateUnitCache(data.slug)
    invalidatePool(data.slug)
  }

  return Response.json({ unit: data })
}
