import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface CompetitorUrlEntry {
  url: string
  label?: string
}

export interface CompetitorUrl {
  name: string
  /** Múltiplas URLs para o mesmo concorrente (cada categoria pode ter URL própria) */
  urls: CompetitorUrlEntry[]
  mode?: 'cheerio' | 'playwright' | 'guia'
  /** @deprecated Use urls[] */
  url?: string
}

export interface PricingThresholds {
  giro_high?: number | null
  giro_low?: number | null
  ocupacao_high?: number | null
  ocupacao_low?: number | null
  adjustment_pct?: number | null
}

export interface UnitGoals {
  revpar?: number | null
  trevpar?: number | null
  ocupacao?: number | null
  receita_mensal?: number | null
  giro?: number | null
  ticket?: number | null
}

export interface AgentConfig {
  id: string
  unit_id: string
  pricing_strategy: 'conservador' | 'moderado' | 'agressivo'
  max_variation_pct: number
  focus_metric: 'balanceado' | 'agressivo' | 'revpar' | 'giro' | 'ocupacao' | 'ticket' | 'trevpar' | 'tmo'
  is_active: boolean
  competitor_urls: CompetitorUrl[]
  city: string
  timezone: string
  postal_code: string | null
  /** Comodidades por categoria: { "CLUB": ["Piscina", "Hidro", ...] } */
  suite_amenities: Record<string, string[]>
  /** Contexto estratégico compartilhado entre todos os usuários da unidade — injetado em toda conversa */
  shared_context: string | null
  /** Regras de ajuste dinâmico por faixa de giro/ocupação */
  pricing_thresholds: PricingThresholds | null
  /** Metas de desempenho da unidade — injetadas no contexto do agente */
  unit_goals: UnitGoals | null
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

  const SELECT_FIELDS = 'id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls, city, timezone, postal_code, suite_amenities, shared_context, pricing_thresholds, unit_goals'

  const { data, error: err } = await admin
    .from('rm_agent_config')
    .select(SELECT_FIELDS)
    .eq('unit_id', unit.id)
    .maybeSingle()

  if (err) return Response.json({ error: err.message }, { status: 500 })

  // Cria config padrão se não existir
  if (!data) {
    const { data: created } = await admin.from('rm_agent_config').insert({
      unit_id: unit.id, pricing_strategy: 'moderado', max_variation_pct: 20, focus_metric: 'balanceado', is_active: true,
    }).select(SELECT_FIELDS).single()
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
    city?: string
    timezone?: string
    postal_code?: string | null
    suite_amenities?: Record<string, string[]>
    shared_context?: string | null
    pricing_thresholds?: PricingThresholds | null
    unit_goals?: UnitGoals | null
  }
  const { unit_id, competitor_urls, suite_amenities, shared_context, pricing_thresholds, unit_goals, ...rest } = body
  if (!unit_id) return new Response('unit_id obrigatório', { status: 400 })

  type DbUpdate = import('@/types/database.types').Database['public']['Tables']['rm_agent_config']['Update']
  const fields: DbUpdate = {
    ...rest,
    ...(competitor_urls    !== undefined ? { competitor_urls:    competitor_urls    as unknown as DbUpdate['competitor_urls']    } : {}),
    ...(suite_amenities    !== undefined ? { suite_amenities:    suite_amenities    as unknown as DbUpdate['suite_amenities']    } : {}),
    ...(shared_context     !== undefined ? { shared_context                                                                     } : {}),
    ...(pricing_thresholds !== undefined ? { pricing_thresholds: pricing_thresholds as unknown as DbUpdate['pricing_thresholds'] } : {}),
    ...(unit_goals         !== undefined ? { unit_goals:         unit_goals         as unknown as DbUpdate['unit_goals']         } : {}),
  }

  const SELECT_FIELDS = 'id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls, city, timezone, postal_code, suite_amenities, shared_context, pricing_thresholds, unit_goals'
  const admin = getAdminClient()
  const { data, error: err } = await admin
    .from('rm_agent_config')
    .update(fields)
    .eq('unit_id', unit_id)
    .select(SELECT_FIELDS)
    .single()

  if (err) return Response.json({ error: err.message }, { status: 500 })
  return Response.json(data as unknown as AgentConfig)
}
