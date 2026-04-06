import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface CompetitorUrl {
  name: string
  url: string
}

export interface AgentConfig {
  id: string
  unit_id: string
  pricing_strategy: 'conservador' | 'moderado' | 'agressivo'
  max_variation_pct: number
  focus_metric: 'balanceado' | 'revpar' | 'ocupacao' | 'ticket'
  is_active: boolean
  competitor_urls: CompetitorUrl[]
}

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const, supabase: null }
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single()
  if (profile?.role !== 'super_admin') return { error: 'Acesso negado', status: 403 as const, supabase: null }
  return { error: null, status: 200 as const, supabase }
}

// ─── GET: busca config da unidade (por slug) ──────────────────────────────────

export async function GET(req: NextRequest) {
  const { error, status } = await requireSuperAdmin()
  if (error) return new Response(error, { status })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error: err } = await admin
    .from('rm_agent_config')
    .select('id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls')
    .eq('unit_id', unit.id)
    .maybeSingle()

  if (err) return Response.json({ error: err.message }, { status: 500 })

  // Cria config padrão se não existir
  if (!data) {
    const { data: created } = await admin.from('rm_agent_config').insert({
      unit_id: unit.id, pricing_strategy: 'moderado', max_variation_pct: 20, focus_metric: 'balanceado', is_active: true,
    }).select('id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls').single()
    return Response.json(created as unknown as AgentConfig)
  }

  return Response.json(data as unknown as AgentConfig)
}

// ─── PATCH: atualiza config da unidade ───────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const { error, status } = await requireSuperAdmin()
  if (error) return new Response(error, { status })

  const body = await req.json() as {
    unit_id: string
    pricing_strategy?: string
    max_variation_pct?: number
    focus_metric?: string
    competitor_urls?: CompetitorUrl[]
  }
  const { unit_id, competitor_urls, ...rest } = body
  if (!unit_id) return new Response('unit_id obrigatório', { status: 400 })

  const fields = {
    ...rest,
    ...(competitor_urls !== undefined ? { competitor_urls: competitor_urls as unknown as import('@/types/database.types').Database['public']['Tables']['rm_agent_config']['Update']['competitor_urls'] } : {}),
  }

  const admin = getAdminClient()
  const { data, error: err } = await admin
    .from('rm_agent_config')
    .update(fields)
    .eq('unit_id', unit_id)
    .select('id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls')
    .single()

  if (err) return Response.json({ error: err.message }, { status: 500 })
  return Response.json(data as unknown as AgentConfig)
}
