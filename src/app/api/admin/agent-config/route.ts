import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
// import type only — google-sheets usa node:crypto, incompatível com Edge Runtime
import type { BudgetConfig } from '@/lib/budget/google-sheets'

export const runtime = 'edge'

export interface CompetitorUrlEntry {
  url: string
  label?: string
}

export interface CompetitorUrl {
  name: string
  /** Múltiplas URLs para o mesmo concorrente (cada categoria pode ter URL própria) */
  urls: CompetitorUrlEntry[]
  mode?: 'cheerio' | 'playwright' | 'guia' | 'manual'
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

export interface CategoryMapEntry {
  competitor_name: string
  competitor_cat:  string  // nome exato da categoria do concorrente
  nossa_cat:       string  // nome exato da nossa categoria
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
  /** URL completa da planilha de orçamento no Google Sheets */
  budget_sheet_url: string | null
  /** Configuração dinâmica das abas e linhas da planilha */
  budget_config: BudgetConfig | null
  /** Timestamp do último sync bem-sucedido com a planilha */
  budget_last_sync: string | null
  /** Mapeamento manual de categorias do concorrente → nossas categorias */
  competitor_category_map: CategoryMapEntry[]
  /** Método de precificação: agent_judgment (LLM livre) | giro_uplift (método determinístico do gestor) */
  pricing_method: 'agent_judgment' | 'giro_uplift'
  /** Teto de reajuste por giro (fração, ex: 0.05 = 5%) */
  giro_uplift_cap: number
  /** Prêmio adicional na faixa de pico (fração) */
  peak_premium: number
  peak_start: number
  peak_end: number
  /** Se true, propostas nunca propõem preço abaixo do atual */
  never_reduce: boolean
  /** Elasticidade preço→giro usada como fallback */
  default_elasticity: number
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
  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) return { error: 'Acesso negado', status: 403 as const, supabase: null }
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

  const SELECT_FIELDS = 'id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls, city, timezone, postal_code, suite_amenities, shared_context, pricing_thresholds, unit_goals, budget_sheet_url, budget_config, budget_last_sync, competitor_category_map, pricing_method, giro_uplift_cap, peak_premium, peak_start, peak_end, never_reduce, default_elasticity'

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
    budget_sheet_url?: string | null
    budget_config?: BudgetConfig | null
    price_sheet_url?: string | null
    competitor_category_map?: CategoryMapEntry[]
    pricing_method?: string
    giro_uplift_cap?: number
    peak_premium?: number
    peak_start?: number
    peak_end?: number
    never_reduce?: boolean
    default_elasticity?: number
  }
  const { unit_id, competitor_urls, suite_amenities, shared_context, pricing_thresholds, unit_goals, budget_sheet_url, budget_config, price_sheet_url, competitor_category_map, ...rest } = body
  if (!unit_id) return new Response('unit_id obrigatório', { status: 400 })

  type DbUpdate = import('@/types/database.types').Database['public']['Tables']['rm_agent_config']['Update']
  const fields: DbUpdate = {
    ...rest,
    ...(competitor_urls         !== undefined ? { competitor_urls:         competitor_urls         as unknown as DbUpdate['competitor_urls']         } : {}),
    ...(suite_amenities         !== undefined ? { suite_amenities:         suite_amenities         as unknown as DbUpdate['suite_amenities']         } : {}),
    ...(shared_context          !== undefined ? { shared_context                                                                                     } : {}),
    ...(pricing_thresholds      !== undefined ? { pricing_thresholds:      pricing_thresholds      as unknown as DbUpdate['pricing_thresholds']      } : {}),
    ...(unit_goals              !== undefined ? { unit_goals:              unit_goals              as unknown as DbUpdate['unit_goals']              } : {}),
    ...(budget_sheet_url        !== undefined ? { budget_sheet_url                                                                                   } : {}),
    ...(budget_config           !== undefined ? { budget_config:           budget_config           as unknown as DbUpdate['budget_config']           } : {}),
  }

  // Fields not yet in generated types — use runtime spread
  const finalFields = {
    ...fields,
    ...(price_sheet_url         !== undefined ? { price_sheet_url         } : {}),
    ...(competitor_category_map !== undefined ? { competitor_category_map } : {}),
  }

  const SELECT_FIELDS = 'id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls, city, timezone, postal_code, suite_amenities, shared_context, pricing_thresholds, unit_goals, budget_sheet_url, budget_config, budget_last_sync, competitor_category_map, pricing_method, giro_uplift_cap, peak_premium, peak_start, peak_end, never_reduce, default_elasticity'
  const admin = getAdminClient()
  const { data, error: err } = await admin
    .from('rm_agent_config')
    .update(finalFields as unknown as DbUpdate)
    .eq('unit_id', unit_id)
    .select(SELECT_FIELDS)
    .single()

  if (err) return Response.json({ error: err.message }, { status: 500 })
  return Response.json(data as unknown as AgentConfig)
}
