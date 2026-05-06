import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface LessonCheckpoint {
  checkpoint_days: 7 | 14 | 28
  verdict:          'success' | 'neutral' | 'failure'
  delta_revpar_pct: number | null
  delta_giro_pct:   number | null
  delta_ocupacao_pp: number | null
  delta_ticket_pct: number | null
  attributed_pricing_pct: number | null
}

export interface ProposalPerformance {
  id:           string
  created_at:   string
  reviewed_at:  string | null
  context:      string | null
  n_changes:    number   // linhas com variacao_pct != 0
  checkpoints:  LessonCheckpoint[]
  best_checkpoint: LessonCheckpoint | null
}

export interface CategoryInsight {
  categoria:        string
  periodo:          string
  dia_tipo:         string
  n_changes:        number
  avg_delta_revpar: number | null
  avg_variacao_pct: number | null
  successes:        number
  failures:         number
}

export interface PerformanceData {
  total_approved:      number
  total_rejected:      number
  lessons_total:       number
  success_count:       number
  neutral_count:       number
  failure_count:       number
  success_rate:        number | null  // (success+neutral)/total
  avg_delta_revpar:    number | null
  avg_delta_giro:      number | null
  proposals:           ProposalPerformance[]
  top_categories:      CategoryInsight[]   // top 5 por Δ RevPAR
  worst_categories:    CategoryInsight[]   // bottom 5 por Δ RevPAR
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()

  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  // Buscar propostas aprovadas + rejeitadas (últimas 90 dias) e lições em paralelo
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [proposalsResult, lessonsResult] = await Promise.all([
    admin
      .from('price_proposals')
      .select('id, created_at, reviewed_at, context, rows, status, rejection_reason_type')
      .eq('unit_id', unit.id)
      .in('status', ['approved', 'rejected'])
      .gte('created_at', since90d)
      .order('created_at', { ascending: false }),
    admin
      .from('rm_pricing_lessons')
      .select('proposal_id, checkpoint_days, verdict, delta_revpar_pct, delta_giro_pct, delta_ocupacao_pp, delta_ticket_pct, attributed_pricing_pct, categoria, periodo, dia_tipo, variacao_pct')
      .eq('unit_id', unit.id)
      .gte('observed_at', since90d),
  ])

  const proposals = proposalsResult.data ?? []
  const lessons   = lessonsResult.data ?? []

  // Agrupar lições por proposal_id
  type LessonRaw = typeof lessons[number]
  const lessonsByProposal = new Map<string, LessonRaw[]>()
  for (const l of lessons) {
    if (!l.proposal_id) continue
    const list = lessonsByProposal.get(l.proposal_id) ?? []
    list.push(l)
    lessonsByProposal.set(l.proposal_id, list)
  }

  // Métricas globais das lições (somente checkpoint 28d quando disponível, senão 14d, senão 7d)
  function bestLesson(ls: LessonRaw[]): LessonRaw | null {
    if (!ls.length) return null
    return ls.sort((a, b) => b.checkpoint_days - a.checkpoint_days)[0]
  }

  const approvedProposals = proposals.filter((p) => p.status === 'approved')
  const rejectedProposals = proposals.filter((p) => p.status === 'rejected')

  let success_count = 0, neutral_count = 0, failure_count = 0
  const revparDeltas: number[] = []
  const giroDeltas: number[] = []

  const proposalPerformance: ProposalPerformance[] = approvedProposals.map((p) => {
    const pLessons = lessonsByProposal.get(p.id) ?? []
    const checkpoints: LessonCheckpoint[] = [7, 14, 28].map((days) => {
      const l = pLessons.find((x) => x.checkpoint_days === days)
      return l ? {
        checkpoint_days:        days as 7 | 14 | 28,
        verdict:                l.verdict as 'success' | 'neutral' | 'failure',
        delta_revpar_pct:       l.delta_revpar_pct,
        delta_giro_pct:         l.delta_giro_pct,
        delta_ocupacao_pp:      l.delta_ocupacao_pp,
        delta_ticket_pct:       l.delta_ticket_pct,
        attributed_pricing_pct: l.attributed_pricing_pct,
      } : null
    }).filter(Boolean) as LessonCheckpoint[]

    const best = checkpoints.length
      ? checkpoints.sort((a, b) => b.checkpoint_days - a.checkpoint_days)[0]
      : null

    if (best) {
      if (best.verdict === 'success')  success_count++
      if (best.verdict === 'neutral')  neutral_count++
      if (best.verdict === 'failure')  failure_count++
      if (best.delta_revpar_pct != null) revparDeltas.push(best.delta_revpar_pct)
      if (best.delta_giro_pct != null)   giroDeltas.push(best.delta_giro_pct)
    }

    type RowLike = { variacao_pct?: number }
    const rows = (p.rows as unknown as RowLike[]) ?? []
    const n_changes = rows.filter((r) => Math.abs(r.variacao_pct ?? 0) >= 0.5).length

    return {
      id:              p.id,
      created_at:      p.created_at,
      reviewed_at:     p.reviewed_at,
      context:         p.context,
      n_changes,
      checkpoints,
      best_checkpoint: best,
    }
  })

  const lessons_total  = success_count + neutral_count + failure_count
  const success_rate   = lessons_total > 0 ? (success_count + neutral_count) / lessons_total : null
  const avg_delta_revpar = revparDeltas.length ? revparDeltas.reduce((s, v) => s + v, 0) / revparDeltas.length : null
  const avg_delta_giro   = giroDeltas.length   ? giroDeltas.reduce((s, v) => s + v, 0)   / giroDeltas.length   : null

  // Insights por categoria — agrega todas as lições disponíveis
  type CatKey = string
  const catMap = new Map<CatKey, {
    categoria: string; periodo: string; dia_tipo: string
    revpars: number[]; variacoes: number[]
    successes: number; failures: number; n: number
  }>()

  for (const l of lessons) {
    const key = `${l.categoria}|${l.periodo}|${l.dia_tipo}`
    const entry = catMap.get(key) ?? {
      categoria: l.categoria, periodo: l.periodo, dia_tipo: l.dia_tipo ?? '',
      revpars: [], variacoes: [], successes: 0, failures: 0, n: 0,
    }
    if (l.delta_revpar_pct != null) entry.revpars.push(l.delta_revpar_pct)
    entry.variacoes.push(l.variacao_pct)
    if (l.verdict === 'success') entry.successes++
    if (l.verdict === 'failure') entry.failures++
    entry.n++
    catMap.set(key, entry)
  }

  const categoryInsights: CategoryInsight[] = [...catMap.values()].map((e) => ({
    categoria:        e.categoria,
    periodo:          e.periodo,
    dia_tipo:         e.dia_tipo,
    n_changes:        e.n,
    avg_delta_revpar: e.revpars.length ? e.revpars.reduce((s, v) => s + v, 0) / e.revpars.length : null,
    avg_variacao_pct: e.variacoes.length ? e.variacoes.reduce((s, v) => s + v, 0) / e.variacoes.length : null,
    successes:        e.successes,
    failures:         e.failures,
  }))

  const sorted = categoryInsights
    .filter((c) => c.avg_delta_revpar != null)
    .sort((a, b) => (b.avg_delta_revpar ?? 0) - (a.avg_delta_revpar ?? 0))

  const result: PerformanceData = {
    total_approved:   approvedProposals.length,
    total_rejected:   rejectedProposals.length,
    lessons_total,
    success_count,
    neutral_count,
    failure_count,
    success_rate,
    avg_delta_revpar,
    avg_delta_giro,
    proposals:        proposalPerformance,
    top_categories:   sorted.slice(0, 5),
    worst_categories: sorted.slice(-5).reverse(),
  }

  return Response.json(result)
}
