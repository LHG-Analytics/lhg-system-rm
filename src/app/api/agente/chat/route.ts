import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { trailingYear } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildSystemPrompt, buildKPIContext } from '@/lib/agente/system-prompt'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow, ParsedDiscountRow } from '@/app/api/agente/import-prices/route'
import type { PriceImportForPrompt, KPIPeriod, VigenciaInfo } from '@/lib/agente/system-prompt'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// YYYY-MM-DD → DD/MM/YYYY (formato esperado pelo fetchCompanyKPIsFromAutomo)
function isoToApi(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

// Diferença em dias entre dois YYYY-MM-DD
function daysBetween(a: string, b: string): number {
  const da = new Date(a)
  const db = new Date(b)
  return Math.max(0, Math.round(Math.abs(db.getTime() - da.getTime()) / 86400000))
}

// min/max entre dois YYYY-MM-DD strings
function minDate(a: string, b: string) { return a < b ? a : b }
function maxDate(a: string, b: string) { return a > b ? a : b }

export async function POST(req: NextRequest) {
  // 1. Autenticação
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Não autorizado', { status: 401 })
  }

  // 2. Perfil e permissões
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return new Response('Perfil não encontrado', { status: 403 })
  }

  // 3. Payload
  const body = await req.json() as {
    messages: unknown[]
    unitSlug?: string
    /** ID da conversa em rm_conversations — usado pelo onFinish para salvar
     *  resultado e notificar quando o cliente desconecta antes do término */
    convId?: string
    // Legado: DD/MM/YYYY (cron/revisoes e outras rotas)
    startDate?: string
    endDate?: string
  }
  const { messages, unitSlug, convId, startDate, endDate } = body

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response('messages inválido', { status: 400 })
  }

  // 4. Resolver unidade
  const admin = getAdminClient()
  let unit: { id: string; name: string; slug: string } | null = null

  if (unitSlug) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('slug', unitSlug)
      .eq('is_active', true)
      .single()
    unit = data

    // Verificar se o usuário tem acesso a essa unidade
    if (unit && profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
      return new Response('Sem acesso a essa unidade', { status: 403 })
    }
  }

  if (!unit && profile.unit_id) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('id', profile.unit_id)
      .single()
    unit = data
  }

  if (!unit && profile.role === 'super_admin') {
    const { data } = await admin
      .from('units')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('name')
      .limit(1)
      .single()
    unit = data
  }

  if (!unit) {
    return new Response('Nenhuma unidade disponível', { status: 400 })
  }

  // 5. Resolver imports e KPIs
  type RawImport = { id: string; parsed_data: unknown; discount_data: unknown; valid_from: string; valid_until: string | null }

  let kpiPeriods: KPIPeriod[]
  let rawImports: RawImport[] = []
  let vigenciaInfo: Parameters<typeof buildSystemPrompt>[3] = undefined

  // Hoje em YYYY-MM-DD (corte operacional 06:00 — usa data de ontem se < 06h)
  const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000) // UTC-3
  const todayIso = nowBRT.toISOString().slice(0, 10)

  if (startDate && endDate) {
    // ── Modo legado: DD/MM/YYYY (cron/revisoes) ────────────────────────────────
    const [companyResult, importsResult] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unit.slug, startDate, endDate),
      admin
        .from('price_imports')
        .select('id, parsed_data, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'prices')
        .order('valid_from', { ascending: false }),
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    kpiPeriods = [{
      period: { startDate, endDate },
      company: companyResult.status === 'fulfilled' ? companyResult.value : null,
      bookings: null,
    }]
  } else {
    // ── Modo automático: backend detecta tabelas e monta contexto ─────────────
    // Busca as 2 tabelas de preços mais recentes + tabela de descontos ativa
    const [priceImpsResult, discountImpResult] = await Promise.allSettled([
      admin
        .from('price_imports')
        .select('id, parsed_data, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'prices')
        .order('valid_from', { ascending: false })
        .limit(2),
      admin
        .from('price_imports')
        .select('id, discount_data, valid_from, valid_until')
        .eq('unit_id', unit.id)
        .filter('import_type', 'eq', 'discounts')
        .lte('valid_from', todayIso)
        .or(`valid_until.is.null,valid_until.gte.${todayIso}`)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const priceImps = priceImpsResult.status === 'fulfilled' ? (priceImpsResult.value.data ?? []) : []
    const discountImp = discountImpResult.status === 'fulfilled' ? discountImpResult.value.data : null

    if (priceImps.length === 0) {
      // Sem tabela importada — usa trailing year
      const kpiParams = trailingYear()
      const [companyResult] = await Promise.allSettled([
        fetchCompanyKPIsFromAutomo(unit.slug, kpiParams.startDate, kpiParams.endDate),
      ])
      kpiPeriods = [{
        period: kpiParams,
        company: companyResult.status === 'fulfilled' ? companyResult.value : null,
        bookings: null,
      }]
    } else if (priceImps.length === 1) {
      // Uma tabela: desde valid_from até hoje
      const imp = priceImps[0]
      rawImports = [imp]
      const apiFrom = isoToApi(imp.valid_from)
      const apiTo   = isoToApi(todayIso)
      const [companyResult] = await Promise.allSettled([
        fetchCompanyKPIsFromAutomo(unit.slug, apiFrom, apiTo),
      ])
      kpiPeriods = [{
        period: { startDate: apiFrom, endDate: apiTo },
        company: companyResult.status === 'fulfilled' ? companyResult.value : null,
        bookings: null,
      }]
    } else {
      // Duas tabelas: importA = anterior, importB = atual (mais recente)
      const importB = priceImps[0]  // atual
      const importA = priceImps[1]  // anterior

      // Período A: valid_from do anterior → dia antes do valid_from do atual
      const endA = importB.valid_from
        ? (() => {
            const d = new Date(importB.valid_from)
            d.setDate(d.getDate() - 1)
            return d.toISOString().slice(0, 10)
          })()
        : todayIso
      // Período B: valid_from do atual → hoje
      const startB = importB.valid_from

      const apiFromA  = isoToApi(importA.valid_from)
      const apiEndA   = isoToApi(endA)
      const apiStartB = isoToApi(startB)
      const apiToB    = isoToApi(todayIso)

      const [cA, cB] = await Promise.allSettled([
        fetchCompanyKPIsFromAutomo(unit.slug, apiFromA, apiEndA),
        fetchCompanyKPIsFromAutomo(unit.slug, apiStartB, apiToB),
      ])

      rawImports = [importA, importB]

      const daysA = daysBetween(importA.valid_from, endA)
      const daysB = daysBetween(startB, todayIso)

      kpiPeriods = [
        {
          label: `Tabela anterior — ${apiFromA} a ${apiEndA} (${daysA} dias)`,
          period: { startDate: apiFromA, endDate: apiEndA },
          company: cA.status === 'fulfilled' ? cA.value : null,
          bookings: null,
        },
        {
          label: `Tabela atual — ${apiStartB} a ${apiToB} (${daysB} dias)`,
          period: { startDate: apiStartB, endDate: apiToB },
          company: cB.status === 'fulfilled' ? cB.value : null,
          bookings: null,
        },
      ]

      vigenciaInfo = {
        importA: { valid_from: apiFromA, valid_until: importA.valid_until ? isoToApi(importA.valid_until) : null, analysis_days: daysA },
        importB: { valid_from: apiStartB, valid_until: importB.valid_until ? isoToApi(importB.valid_until) : null, analysis_days: daysB },
        is_asymmetric: Math.abs(daysA - daysB) > 7,
      }
    }

    // Injeta descontos no import mais recente se disponível
    if (discountImp?.discount_data && rawImports.length > 0) {
      const mainImport = rawImports[rawImports.length - 1]
      if (!mainImport.discount_data) {
        mainImport.discount_data = discountImp.discount_data
      }
    }
  }

  // Montar PriceImportForPrompt
  const priceImports: PriceImportForPrompt[] = rawImports.map((imp) => ({
    rows: imp.parsed_data ? (imp.parsed_data as unknown as ParsedPriceRow[]) : [],
    discount_data: imp.discount_data ? (imp.discount_data as unknown as ParsedDiscountRow[]) : null,
    valid_from: imp.valid_from,
    valid_until: imp.valid_until,
  }))

  // 6. Montar system prompt com KPIs (por período) + tabelas + vigência
  const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports, vigenciaInfo)

  const agentTools = {
    buscar_kpis_periodo: tool({
      description:
        'Busca KPIs operacionais completos (giro, RevPAR, ticket médio, ocupação, tabelas semanais) ' +
        'para qualquer período específico via ERP Automo. ' +
        'Use sempre que o usuário mencionar datas específicas, pedir monitoramento de uma semana, ' +
        'ou quando os dados do contexto não cobrirem o período solicitado. ' +
        'Nunca diga que não tem acesso — use este tool.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato DD/MM/YYYY, ex: "01/04/2026"'),
        endDate:   z.string().describe('Data final no formato DD/MM/YYYY, ex: "07/04/2026"'),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const company = await fetchCompanyKPIsFromAutomo(unit.slug, startDate, endDate)
          return buildKPIContext(unit.name, { startDate, endDate }, company, null)
        } catch {
          return `Falha ao buscar KPIs no Automo para ${startDate} a ${endDate}. Verifique o período e se a conexão ERP está configurada.`
        }
      },
    }),

    gerar_heatmap: tool({
      description:
        'Gera um mapa de calor de ocupação ou giro por hora × dia da semana diretamente no chat. ' +
        'Use quando o usuário pedir "mapa de calor", "heatmap", "calor de giro", ' +
        '"como está a ocupação por hora" ou variações. ' +
        'Retorna os parâmetros para renderização visual — NÃO tente descrever os dados em texto.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato YYYY-MM-DD, ex: "2026-03-23"'),
        endDate:   z.string().describe('Data final no formato YYYY-MM-DD, ex: "2026-03-29"'),
        metric: z.enum(['giro', 'ocupacao', 'revpar', 'trevpar']).optional().describe('Métrica: "giro" (padrão), "ocupacao", "revpar" ou "trevpar"'),
        label: z.string().optional().describe('Rótulo descritivo do período, ex: "últimos 7 dias"'),
      }),
      execute: async ({ startDate, endDate, metric = 'giro', label }) => {
        const pool = getAutomPool(unit.slug)
        if (!pool) return { error: `Conexão Automo não configurada para ${unit.slug}.` }
        const rangeLabel = label ?? `${startDate} a ${endDate}`
        return { startDate, endDate, metric, rangeLabel, unitSlug: unit.slug }
      },
    }),

    salvar_proposta: tool({
      description:
        'Salva a proposta de ajuste de preços no sistema para registro e revisão pelo gerente. ' +
        'Chame IMEDIATAMENTE ao concluir a tabela de proposta — não espere o usuário aprovar. ' +
        'A aprovação final acontece na aba Propostas, nunca no chat. ' +
        'Após salvar, NÃO repita "a proposta foi salva" no texto — isso já aparece como chip de confirmação. ' +
        'Apenas use sugerir_respostas com as opções de próximos passos.',
      inputSchema: z.object({
        context: z.string().describe('Resumo em 2–3 frases da lógica geral da proposta'),
        rows: z.array(z.object({
          canal:          z.enum(['balcao_site', 'site_programada', 'guia_moteis']),
          categoria:      z.string(),
          periodo:        z.string(),
          dia_tipo:       z.enum(['semana', 'fds_feriado', 'todos']),
          preco_atual:    z.number(),
          preco_proposto: z.number(),
          variacao_pct:   z.number(),
          justificativa:  z.string(),
        })).describe('Linhas da proposta exatamente como apresentadas na tabela'),
      }),
      execute: async ({ context, rows }) => {
        const { data, error } = await supabase
          .from('price_proposals')
          .insert({
            unit_id:    unit.id,
            created_by: user.id,
            context,
            rows: rows as unknown as Database['public']['Tables']['price_proposals']['Insert']['rows'],
            status:     'pending',
          })
          .select('id')
          .single()
        if (error) return { success: false, error: error.message }
        return { success: true, proposalId: data.id }
      },
    }),

    sugerir_respostas: tool({
      description:
        'Exibe botões de resposta rápida clicáveis para o usuário no chat. ' +
        'Use SEMPRE após: (1) apresentar uma proposta de preços — inclua opções de análise, "Ajustar item", "Ir à aba Propostas" (texto vazio); ' +
        '(2) fazer uma pergunta de sim/não ou múltipla escolha; (3) oferecer próximos passos. ' +
        'Sempre inclua uma opção com texto vazio (label "Outra resposta") para o usuário digitar livremente.',
      inputSchema: z.object({
        opcoes: z.array(z.object({
          label: z.string().describe('Rótulo curto do botão (≤ 35 chars)'),
          texto: z.string().describe('Texto completo enviado ao clicar. String vazia = abre campo para digitar livremente.'),
        })).min(2).max(6),
      }),
      execute: async ({ opcoes }) => ({ opcoes }),
    }),

    buscar_dados_automo: tool({
      description:
        'Consulta diretamente o ERP Automo para obter giro, total de locações e número de suítes por categoria ' +
        'em qualquer período. Use quando precisar de dados granulares por categoria ou para cruzar com os KPIs agregados.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato YYYY-MM-DD, ex: "2026-04-01"'),
        endDate:   z.string().describe('Data final no formato YYYY-MM-DD, ex: "2026-04-07"'),
      }),
      execute: async ({ startDate, endDate }) => {
        const pool = getAutomPool(unit.slug)
        if (!pool) return `Conexão Automo não configurada para ${unit.slug}.`

        const categoryIds = UNIT_CATEGORY_IDS[unit.slug]
        if (!categoryIds?.length) return 'IDs de categoria não configurados para esta unidade.'

        const idList = categoryIds.join(',')
        const sql = `
          WITH category_suites AS (
            SELECT ca.id, ca.descricao AS nome, COUNT(a.id) AS suites
            FROM apartamento a
            INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
            WHERE ca.id IN (${idList}) AND a.dataexclusao IS NULL
            GROUP BY ca.id, ca.descricao
          ),
          period_info AS (
            SELECT ('${endDate}'::date - '${startDate}'::date + 1) AS n_days
          ),
          locacoes AS (
            SELECT ca.id, COUNT(*) AS total_locacoes
            FROM locacaoapartamento la
            INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
            INNER JOIN apartamento a ON aps.id_apartamento = a.id
            INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
            WHERE la.datainicialdaocupacao >= '${startDate}'::date
              AND la.datainicialdaocupacao < ('${endDate}'::date + INTERVAL '1 day')
              AND la.fimocupacaotipo = 'FINALIZADA'
              AND ca.id IN (${idList})
            GROUP BY ca.id
          )
          SELECT
            cs.nome AS categoria,
            COALESCE(l.total_locacoes, 0) AS total_locacoes,
            cs.suites::int AS suites,
            pi.n_days::int AS dias_periodo,
            ROUND(COALESCE(l.total_locacoes, 0)::numeric / cs.suites / pi.n_days, 3) AS giro_diario
          FROM category_suites cs
          LEFT JOIN locacoes l ON l.id = cs.id
          CROSS JOIN period_info pi
          ORDER BY cs.nome
        `

        try {
          const result = await pool.query<{
            categoria: string; total_locacoes: number; suites: number
            dias_periodo: number; giro_diario: number
          }>(sql)

          if (!result.rows.length) return 'Nenhuma locação encontrada no período informado.'

          const header = `Dados Automo — ${unit.name} | ${startDate} a ${endDate}\n\n`
          const table = [
            '| Categoria | Locações | Suítes | Giro diário |',
            '|-----------|----------|--------|-------------|',
            ...result.rows.map((r) =>
              `| ${r.categoria} | ${r.total_locacoes} | ${r.suites} | ${r.giro_diario.toFixed(3)} |`
            ),
          ].join('\n')

          const total = result.rows.reduce((acc, r) => acc + r.total_locacoes, 0)
          const totalSuites = result.rows.reduce((acc, r) => acc + r.suites, 0)
          const days = result.rows[0]?.dias_periodo ?? 1
          const giroGeral = (total / totalSuites / days).toFixed(3)
          const summary = `\n\n**Total**: ${total} locações | ${totalSuites} suítes | Giro geral: ${giroGeral}`

          return header + table + summary
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[agente/automo] Erro query (${unit.slug}):`, msg)
          return `Erro ao consultar Automo: ${msg}`
        }
      },
    }),
  }

  // 8. Stream via AI Gateway com tools
  const result = streamText({
    model: PRIMARY_MODEL,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as Parameters<typeof convertToModelMessages>[0]),
    tools: agentTools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 2500,
    temperature: 0.3,
    providerOptions: gatewayOptions,

    // onFinish é chamado quando o modelo termina a geração — MESMO se o cliente
    // desconectou (SSE fechado). No Vercel, a função continua executando até
    // concluir ou atingir o timeout. Quando convId está presente e o cliente
    // desconectou, salvamos as mensagens e criamos notificação in-app.
    onFinish: async ({ text }) => {
      // Só age se o cliente desconectou E há uma conversa para salvar
      if (!req.signal.aborted) return
      if (!convId || typeof convId !== 'string') return
      if (!text) return

      try {
        // Busca mensagens existentes (inclui a mensagem do usuário salva no submit)
        const { data: conv } = await admin
          .from('rm_conversations')
          .select('messages')
          .eq('id', convId)
          .single()

        const existing = (conv?.messages ?? []) as Array<{ role: string; parts: unknown[] }>
        const assistantMsg = {
          id: Math.random().toString(36).slice(2, 12),
          role: 'assistant',
          parts: [{ type: 'text', text }],
        }

        await admin
          .from('rm_conversations')
          .update({ messages: JSON.parse(JSON.stringify([...existing, assistantMsg])) })
          .eq('id', convId)

        // Notificação in-app com link direto para a conversa
        await admin
          .from('notifications')
          .insert({
            user_id: user.id,
            type: 'info',
            title: 'Agente RM respondeu',
            body: 'Sua consulta foi processada. Clique para ver a resposta.',
            link: `/dashboard/agente?conv=${convId}`,
          })
      } catch (err) {
        console.error('[chat/onFinish] Erro ao salvar resposta em background:', err)
      }
    },
  })

  return result.toUIMessageStreamResponse()
}
