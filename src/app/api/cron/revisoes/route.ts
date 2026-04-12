import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { trailingYear } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildSystemPrompt } from '@/lib/agente/system-prompt'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import type { KPIPeriod } from '@/lib/agente/system-prompt'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  // ── 1. Autenticação do cron ────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const now = new Date()

  // ── 2. Buscar revisões pendentes cujo scheduled_at já passou ──────────────
  // Busca tudo pendente até agora (timestamptz <= now)
  const { data: reviews, error: fetchError } = await admin
    .from('scheduled_reviews')
    .select('id, unit_id, created_by, note, scheduled_at, proposal_id')
    .lte('scheduled_at', now.toISOString())
    .eq('status', 'pending')

  if (fetchError) {
    console.error('[cron/revisoes] Erro ao buscar revisões:', fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!reviews || reviews.length === 0) {
    return NextResponse.json({ ok: true, executed: 0, message: 'Nenhuma revisão pendente.' })
  }

  const results: { reviewId: string; status: 'done' | 'failed'; convId?: string; error?: string }[] = []

  for (const review of reviews) {
    try {
      // ── 3. Marcar como running ──────────────────────────────────────────
      await admin.from('scheduled_reviews').update({ status: 'running' }).eq('id', review.id)

      // ── 4. Resolver unidade ────────────────────────────────────────────
      const { data: unit } = await admin
        .from('units').select('id, name, slug').eq('id', review.unit_id).single()
      if (!unit) throw new Error(`Unidade ${review.unit_id} não encontrada`)

      // ── 5. Buscar import de preços ativo ──────────────────────────────
      const { data: importsData } = await admin
        .from('price_imports')
        .select('id, parsed_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .order('valid_from', { ascending: false })
        .limit(2)

      const priceImports = (importsData ?? []).map((imp) => ({
        rows: (imp.parsed_data as unknown as ParsedPriceRow[]) ?? [],
        valid_from: imp.valid_from,
        valid_until: imp.valid_until,
      }))

      // ── 6. Buscar proposta que gerou este agendamento ─────────────────
      let proposalContext = ''
      if (review.proposal_id) {
        const { data: proposal } = await admin
          .from('price_proposals')
          .select('context, created_at')
          .eq('id', review.proposal_id)
          .single()
        if (proposal?.context) {
          const approvedDate = new Date(proposal.created_at).toLocaleDateString('pt-BR')
          proposalContext = `\n\nContexto da proposta aprovada em ${approvedDate}: ${proposal.context}`
        }
      }

      // ── 7. Buscar KPIs: 7 dias desde vigência + trailing 12 meses ─────
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start7d = new Date(end)
      start7d.setDate(start7d.getDate() - 6)

      const fmt = (d: Date) => d.toLocaleDateString('pt-BR')
      const kpiPeriod7d = { startDate: fmt(start7d), endDate: fmt(end) }
      const kpiPeriodTrailing = trailingYear()

      const [c7d, cTrail] = await Promise.allSettled([
        fetchCompanyKPIsFromAutomo(unit.slug, kpiPeriod7d.startDate, kpiPeriod7d.endDate),
        fetchCompanyKPIsFromAutomo(unit.slug, kpiPeriodTrailing.startDate, kpiPeriodTrailing.endDate),
      ])

      const kpiPeriods: KPIPeriod[] = [
        {
          label: `Últimos 7 dias — monitoramento (${kpiPeriod7d.startDate} a ${kpiPeriod7d.endDate})`,
          period: kpiPeriod7d,
          company: c7d.status === 'fulfilled' ? c7d.value : null,
          bookings: null,
        },
        {
          label: `Trailing 12 meses — contexto histórico (${kpiPeriodTrailing.startDate} a ${kpiPeriodTrailing.endDate})`,
          period: kpiPeriodTrailing,
          company: cTrail.status === 'fulfilled' ? cTrail.value : null,
          bookings: null,
        },
      ]

      // ── 8. Montar system prompt + mensagem de revisão ──────────────────
      const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports)

      const scheduledLabel = new Date(review.scheduled_at).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })

      const noteContext = review.note ? `\n\nFoco desta revisão: ${review.note}` : ''

      const userMessage = `Esta é uma revisão automática de Revenue Management agendada para ${scheduledLabel}.${proposalContext}${noteContext}

Por favor, realize uma análise completa de acompanhamento:
1. Diagnóstico dos últimos 7 dias vs histórico de 12 meses
2. Identifique tendências e anomalias desde a última mudança de tabela
3. Avalie se os preços atuais estão calibrados para a demanda observada
4. Proponha ajustes se necessário (tabela markdown obrigatória)
5. Indique próximos passos e métricas a monitorar`

      // ── 9. Gerar análise via AI Gateway ───────────────────────────────
      const agentResult = await generateText({
        model: PRIMARY_MODEL,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: {
          placeholder: tool({
            description: 'Placeholder — não usar nesta revisão automática.',
            inputSchema: z.object({ _: z.string().optional() }),
            execute: async () => ({ ok: true }),
          }),
        },
        maxOutputTokens: 2500,
        temperature: 0.3,
        providerOptions: gatewayOptions,
      })

      const analysisText = agentResult.text ?? '(análise sem conteúdo)'

      // ── 10. Salvar conversa com flag is_scheduled_review ───────────────
      const convTitle = `📅 Revisão agendada — ${scheduledLabel} · ${unit.name}`

      const messages = [
        { id: `cron-user-${review.id}`,      role: 'user',      content: userMessage,  parts: [{ type: 'text', text: userMessage  }] },
        { id: `cron-assistant-${review.id}`, role: 'assistant', content: analysisText, parts: [{ type: 'text', text: analysisText }] },
      ]

      const { data: conv, error: convError } = await admin
        .from('rm_conversations')
        .insert({
          unit_id:  unit.id,
          user_id:  review.created_by,
          title:    convTitle,
          messages: JSON.parse(JSON.stringify(messages)),
        })
        .select('id')
        .single()

      if (convError) throw new Error(`Erro ao salvar conversa: ${convError.message}`)

      // ── 11. Notificação in-app ────────────────────────────────────────
      await admin.from('notifications').insert({
        user_id: review.created_by,
        type:    'revisao_concluida',
        title:   `📅 Revisão de RM concluída — ${unit.name}`,
        body:    `A revisão agendada para ${scheduledLabel} foi executada. Confira a análise no histórico do Agente RM.`,
        link:    `/dashboard/agente?unit=${unit.slug}&conv=${conv.id}`,
      })

      // ── 12. Marcar review como done ───────────────────────────────────
      await admin
        .from('scheduled_reviews')
        .update({ status: 'done', conv_id: conv.id, executed_at: new Date().toISOString() })
        .eq('id', review.id)

      results.push({ reviewId: review.id, status: 'done', convId: conv.id })

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/revisoes] Erro na revisão ${review.id}:`, message)
      await admin
        .from('scheduled_reviews')
        .update({ status: 'failed', executed_at: new Date().toISOString() })
        .eq('id', review.id)
      results.push({ reviewId: review.id, status: 'failed', error: message })
    }
  }

  const done   = results.filter((r) => r.status === 'done').length
  const failed = results.filter((r) => r.status === 'failed').length

  return NextResponse.json({ ok: true, executed: results.length, done, failed, results })
}
