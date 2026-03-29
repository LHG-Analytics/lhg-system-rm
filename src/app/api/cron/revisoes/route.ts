import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { fetchCompanyKPIs, fetchBookingsKPIs, trailingYear } from '@/lib/lhg-analytics/client'
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
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  // ── 2. Buscar revisões pendentes de hoje ──────────────────────────────────
  const { data: reviews, error: fetchError } = await admin
    .from('scheduled_reviews')
    .select('id, unit_id, created_by, note')
    .eq('scheduled_at', today)
    .eq('status', 'pending')

  if (fetchError) {
    console.error('[cron/revisoes] Erro ao buscar revisões:', fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!reviews || reviews.length === 0) {
    return NextResponse.json({ ok: true, executed: 0, message: 'Nenhuma revisão agendada para hoje.' })
  }

  const results: { reviewId: string; status: 'done' | 'failed'; convId?: string; error?: string }[] = []

  for (const review of reviews) {
    try {
      // ── 3. Marcar como running ──────────────────────────────────────────
      await admin
        .from('scheduled_reviews')
        .update({ status: 'running' })
        .eq('id', review.id)

      // ── 4. Resolver unidade ────────────────────────────────────────────
      const { data: unit } = await admin
        .from('units')
        .select('id, name, slug, api_base_url')
        .eq('id', review.unit_id)
        .single()

      if (!unit) throw new Error(`Unidade ${review.unit_id} não encontrada`)

      // ── 5. Buscar import de preços mais recente ────────────────────────
      const { data: importsData } = await admin
        .from('price_imports')
        .select('id, parsed_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .order('valid_from', { ascending: false })
        .limit(1)

      const priceImports = (importsData ?? []).map((imp) => ({
        rows: (imp.parsed_data as unknown as ParsedPriceRow[]) ?? [],
        valid_from: imp.valid_from,
        valid_until: imp.valid_until,
      }))

      // ── 6. Buscar KPIs dos últimos 7 dias (monitoramento pós-mudança) ──
      const lhgUnit = { slug: unit.slug, apiBaseUrl: unit.api_base_url ?? '' }
      const kpiPeriod7d = (() => {
        const end = new Date()
        end.setDate(end.getDate() - 1)
        const start = new Date(end)
        start.setDate(start.getDate() - 6)
        return {
          startDate: start.toLocaleDateString('pt-BR'),
          endDate:   end.toLocaleDateString('pt-BR'),
        }
      })()
      const kpiPeriodTrailing = trailingYear()

      let kpiPeriods: KPIPeriod[]
      if (unit.api_base_url) {
        const [c7d, b7d, cTrail, bTrail] = await Promise.allSettled([
          fetchCompanyKPIs(lhgUnit, kpiPeriod7d),
          fetchBookingsKPIs(lhgUnit, kpiPeriod7d),
          fetchCompanyKPIs(lhgUnit, kpiPeriodTrailing),
          fetchBookingsKPIs(lhgUnit, kpiPeriodTrailing),
        ])
        kpiPeriods = [
          {
            label: `Últimos 7 dias — monitoramento (${kpiPeriod7d.startDate} a ${kpiPeriod7d.endDate})`,
            period: kpiPeriod7d,
            company:  c7d.status  === 'fulfilled' ? c7d.value  : null,
            bookings: b7d.status  === 'fulfilled' ? b7d.value  : null,
          },
          {
            label: `Trailing 12 meses — contexto histórico (${kpiPeriodTrailing.startDate} a ${kpiPeriodTrailing.endDate})`,
            period: kpiPeriodTrailing,
            company:  cTrail.status  === 'fulfilled' ? cTrail.value  : null,
            bookings: bTrail.status  === 'fulfilled' ? bTrail.value  : null,
          },
        ]
      } else {
        kpiPeriods = [{
          period: kpiPeriodTrailing,
          company: null,
          bookings: null,
        }]
      }

      // ── 7. Montar system prompt + mensagem de revisão ──────────────────
      const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports)

      const noteContext = review.note
        ? `\n\nFoco desta revisão: ${review.note}`
        : ''

      const userMessage = `Esta é uma revisão automática de Revenue Management agendada para ${today}. ${noteContext}

Por favor, realize uma análise completa seguindo o framework padrão:
1. Diagnóstico dos últimos 7 dias vs histórico
2. Identifique tendências e anomalias
3. Avalie se os preços atuais estão calibrados para a demanda observada
4. Proponha ajustes se necessário (tabela markdown obrigatória)
5. Indique próximos passos e métricas a monitorar`

      // ── 8. Gerar análise via AI Gateway ───────────────────────────────
      const agentResult = await generateText({
        model: PRIMARY_MODEL,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: {
          // Tool stub — revisão automática não precisa de ferramentas interativas
          placeholder: tool({
            description: 'Placeholder — não usar nesta revisão automática.',
            inputSchema: z.object({ _: z.string().optional() }),
            execute: async () => ({ ok: true }),
          }),
        },
        maxOutputTokens: 4096,
        temperature: 0.3,
        providerOptions: gatewayOptions,
      })

      const analysisText = agentResult.text ?? '(análise sem conteúdo)'

      // ── 9. Salvar conversa no histórico ───────────────────────────────
      const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
      const convTitle = `Revisão agendada — ${dateLabel} · ${unit.name}`

      const messages = [
        { id: `cron-user-${review.id}`,      role: 'user',      content: userMessage,   parts: [{ type: 'text', text: userMessage }] },
        { id: `cron-assistant-${review.id}`, role: 'assistant', content: analysisText,  parts: [{ type: 'text', text: analysisText }] },
      ]

      const { data: conv, error: convError } = await admin
        .from('rm_conversations')
        .insert({
          unit_id:    unit.id,
          user_id:    review.created_by,
          title:      convTitle,
          messages:   JSON.parse(JSON.stringify(messages)),
        })
        .select('id')
        .single()

      if (convError) throw new Error(`Erro ao salvar conversa: ${convError.message}`)

      // ── 10. Notificação in-app ────────────────────────────────────────
      await admin
        .from('notifications')
        .insert({
          user_id: review.created_by,
          type:    'revisao_concluida',
          title:   `Revisão de RM concluída — ${unit.name}`,
          body:    `A revisão agendada para ${dateLabel} foi executada. Confira a análise no histórico do Agente RM.`,
        })

      // ── 11. Atualizar review como done ────────────────────────────────
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
