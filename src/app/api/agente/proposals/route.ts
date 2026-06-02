import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildProposalBaseline, defaultBaselineWindow } from '@/lib/agente/proposal-baseline'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProposedPriceRow extends ParsedPriceRow {
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
  // Impacto esperado na receita calculado via elasticidade-preço (ST1).
  // Null quando não há elasticidade confiável para a combinação.
  expected_revenue_change_pct?: number | null
  // Sinal estruturado quando o clamp por guardrail entrou em ação.
  // Permite UI exibir badge específico em vez de parsear a string da justificativa.
  was_clamped?: boolean
  clamp_info?: {
    original_price: number
    clamp_type: 'min' | 'max'
    guardrail_value: number
  }
}

export interface PriceProposal {
  id: string
  unit_id: string
  created_by: string
  creator_name: string | null
  context: string | null
  rows: ProposedPriceRow[]
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}


// ─── GET: lista propostas da unidade ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: proposals, error } = await admin
    .from('price_proposals')
    .select('*')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Enriquece com nome do criador
  const creatorIds = [...new Set((proposals ?? []).map((p) => p.created_by).filter(Boolean))]
  const { data: profiles } = creatorIds.length
    ? await admin.from('profiles').select('user_id, display_name').in('user_id', creatorIds)
    : { data: [] }
  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]))

  const enriched = (proposals ?? []).map((p) => {
    return { ...p, creator_name: profileMap.get(p.created_by) ?? null }
  })

  return Response.json(enriched as unknown as PriceProposal[])
}

// ─── PATCH: aprovar, rejeitar ou editar proposta ──────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as {
    id: string
    status?: 'approved' | 'rejected'
    rows?: ProposedPriceRow[]
    context?: string
    rejection_reason_type?: string
    rejection_reason_text?: string
    rejected_items?: Array<{ categoria: string; periodo: string; dia_tipo: string; motivo: string }>
  }
  const { id } = body

  if (!id) return new Response('id obrigatório', { status: 400 })

  const VALID_REJECTION_REASONS = [
    'precos_muito_altos', 'precos_muito_baixos', 'estrategia_inadequada',
    'item_especifico_errado', 'momento_inadequado', 'concorrencia_nao_considerada',
    'margem_insuficiente', 'outro',
  ]

  // ─── Edição manual de linhas ─────────────────────────────────────────────
  if (body.rows !== undefined) {
    const { data: updated, error } = await supabase
      .from('price_proposals')
      .update({
        rows: body.rows as unknown as Database['public']['Tables']['price_proposals']['Update']['rows'],
        ...(body.context !== undefined && { context: body.context }),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .single()

    if (error || !updated) {
      return Response.json({ error: 'Proposta não encontrada ou não está pendente' }, { status: 404 })
    }
    return Response.json(updated as unknown as PriceProposal)
  }

  // ─── Aprovação / rejeição ────────────────────────────────────────────────
  const { status } = body
  if (!status || !['approved', 'rejected'].includes(status)) {
    return new Response('status obrigatório (approved/rejected)', { status: 400 })
  }

  if (status === 'rejected') {
    if (!body.rejection_reason_type) {
      return Response.json({ error: 'rejection_reason_type é obrigatório ao rejeitar' }, { status: 422 })
    }
    if (!VALID_REJECTION_REASONS.includes(body.rejection_reason_type)) {
      return Response.json({ error: 'rejection_reason_type inválido' }, { status: 400 })
    }
  }

  const { data: proposal, error: fetchErr } = await supabase
    .from('price_proposals')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !proposal) return Response.json({ error: 'Proposta não encontrada' }, { status: 404 })

  // ─── Capturar KPI baseline ANTES da mudança de tabela (status='approved') ──
  // Janela de 28 dias terminando ontem. Usado pela revisão +7d/+14d/+28d
  // para comparar antes/depois numa janela igual.
  const approvedAt = new Date()
  let kpiBaselineJSON: ReturnType<typeof buildProposalBaseline> | null = null

  if (status === 'approved') {
    try {
      // Buscar slug da unidade
      const adminPre = getAdminClient()
      const [{ data: unitData }, { data: activeImportData }, { data: agentCfgData }] = await Promise.all([
        adminPre.from('units').select('slug').eq('id', proposal.unit_id).single(),
        adminPre
          .from('price_imports')
          .select('id')
          .eq('unit_id', proposal.unit_id)
          .is('valid_until', null)
          .order('valid_from', { ascending: false })
          .limit(1)
          .maybeSingle(),
        adminPre
          .from('rm_agent_config')
          .select('events_cache')
          .eq('unit_id', proposal.unit_id)
          .maybeSingle(),
      ])

      if (unitData?.slug) {
        const win = defaultBaselineWindow(approvedAt)
        const baselineKpi = await fetchCompanyKPIsFromAutomo(
          unitData.slug,
          win.startDDMMYYYY,
          win.endDDMMYYYY,
          6, 5, 'FINALIZADA', 'checkin',
        ).catch(() => null)

        if (baselineKpi) {
          // Eventos ativos na janela do baseline
          const { data: activeEventsData } = await adminPre
            .from('unit_events')
            .select('title')
            .eq('unit_id', proposal.unit_id)
            .lte('event_date', win.endISO)
            .or(`event_end_date.gte.${win.startISO},event_end_date.is.null,and(event_date.gte.${win.startISO},event_date.lte.${win.endISO})`)
            .limit(20)

          // Cache de clima (último valor disponível)
          const eventsCache = (agentCfgData?.events_cache ?? null) as { weather?: { dominantCondition?: string; avgTemp?: number } } | null

          kpiBaselineJSON = buildProposalBaseline(baselineKpi, {
            windowDays: 28,
            startDate: win.startISO,
            endDate: win.endISO,
            weatherCondition: eventsCache?.weather?.dominantCondition ?? null,
            weatherAvgTemp: eventsCache?.weather?.avgTemp ?? null,
            activeEvents: (activeEventsData ?? []).map((e) => e.title),
            activeTableId: activeImportData?.id ?? null,
          })
        }
      }
    } catch (e) {
      console.error('[proposals/approve] failed to build kpi_baseline:', e)
      // Não bloqueia a aprovação — apenas perde-se a possibilidade de comparação justa nessa proposta
    }
  }

  const { data: updated, error } = await supabase
    .from('price_proposals')
    .update({
      status,
      reviewed_by: user.id,
      reviewed_at: approvedAt.toISOString(),
      ...(status === 'approved' ? {
        approved_at: approvedAt.toISOString(),
        effective_from: approvedAt.toISOString().slice(0, 10),
        ...(kpiBaselineJSON ? { kpi_baseline: kpiBaselineJSON as unknown as Database['public']['Tables']['price_proposals']['Update']['kpi_baseline'] } : {}),
      } : {}),
      ...(status === 'rejected' ? {
        rejection_reason_type: body.rejection_reason_type ?? null,
        rejection_reason_text: body.rejection_reason_text ?? null,
        rejected_items: (body.rejected_items ?? null) as unknown as Database['public']['Tables']['price_proposals']['Update']['rejected_items'],
      } : {}),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (status === 'approved') {
    const proposedRows = (proposal.rows as unknown as ProposedPriceRow[]) ?? []
    const today = new Date().toISOString().slice(0, 10)
    const admin = getAdminClient()

    // HV1: auto-agendar 3 revisões em checkpoints +7d, +14d, +28d.
    // Cada uma compara contra kpi_baseline com janela igual e popula
    // rm_pricing_lessons com a decomposição de lift correspondente.
    const checkpointDays = [7, 14, 28] as const
    const reviewInserts = checkpointDays.map((days) => {
      const reviewDate = new Date()
      reviewDate.setDate(reviewDate.getDate() + days)
      reviewDate.setUTCHours(13, 0, 0, 0) // 10:00 BRT
      return {
        unit_id:         proposal.unit_id,
        created_by:      user.id,
        scheduled_at:    reviewDate.toISOString(),
        proposal_id:     proposal.id,
        checkpoint_days: days,
        note:            `Acompanhamento +${days}d — comparação contra baseline congelado (mesma janela de ${days} dias) com decomposição de lift e atribuição ao pricing.`,
        status:          'pending',
      }
    })
    await admin.from('scheduled_reviews').insert(reviewInserts)

    // rowKey suporta formato legado (dia_tipo) e novo (dias[] + hora_inicio/hora_fim)
    const rowKey = (r: ParsedPriceRow) => {
      if (r.dias?.length) {
        return `${r.canal}|${r.categoria}|${r.periodo}|${[...r.dias].sort().join(',')}|${r.hora_inicio ?? ''}`
      }
      return `${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`
    }

    const proposedMap = new Map<string, number>()
    for (const r of proposedRows) {
      proposedMap.set(rowKey(r), r.preco_proposto)
    }

    const { data: activeImport } = await admin
      .from('price_imports')
      .select('id, parsed_data, canals')
      .eq('unit_id', proposal.unit_id)
      .is('valid_until', null)
      .lte('valid_from', today)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const baseRows: ParsedPriceRow[] = activeImport
      ? (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
      : []

    const remainingProposed = new Map(proposedMap)
    const newRows: ParsedPriceRow[] = baseRows.map((r) => {
      const key = rowKey(r)
      const newPrice = remainingProposed.get(key)
      if (newPrice !== undefined) {
        remainingProposed.delete(key)
        return { ...r, preco: newPrice }
      }
      return { ...r }
    })

    for (const [key, preco] of remainingProposed) {
      const src = proposedRows.find((r) => rowKey(r) === key)
      if (src) {
        newRows.push({
          canal: src.canal,
          categoria: src.categoria,
          periodo: src.periodo,
          dia_tipo: src.dia_tipo ?? '',
          ...(src.dias?.length ? { dias: src.dias, hora_inicio: src.hora_inicio, hora_fim: src.hora_fim } : {}),
          preco,
        })
      }
    }

    const newCanais = [...new Set(newRows.map((r) => r.canal))]

    if (activeImport) {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await admin
        .from('price_imports')
        .update({ valid_until: yesterday.toISOString().slice(0, 10) })
        .eq('id', activeImport.id)
    }

    await admin
      .from('price_imports')
      .insert({
        unit_id:     proposal.unit_id,
        imported_by: user.id,
        raw_content: `[Agente RM — proposta ${id} aprovada em ${today}]`,
        parsed_data: newRows as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        canals:      newCanais,
        is_active:   true,
        valid_from:  today,
        valid_until: null,
      })
  }

  return Response.json(updated as unknown as PriceProposal)
}

// ─── DELETE: excluir proposta ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const admin = getAdminClient()

  // Verificar que a proposta existe e pertence a uma unidade acessível
  const { data: existing } = await admin
    .from('price_proposals')
    .select('id, unit_id')
    .eq('id', id)
    .single()

  if (!existing) return new Response('Proposta não encontrada', { status: 404 })

  if (!(['super_admin', 'admin'].includes(profile.role ?? '') && !profile.unit_id) && profile.unit_id !== existing.unit_id) {
    return new Response('Sem acesso', { status: 403 })
  }

  // Deleta agendas vinculadas à proposta antes de removê-la
  await admin.from('scheduled_reviews').delete().eq('proposal_id', id)

  const { error } = await admin
    .from('price_proposals')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

