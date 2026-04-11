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
import type { PriceImportForPrompt, KPIPeriod } from '@/lib/agente/system-prompt'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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
    startDate?: string
    endDate?: string
    priceImportIds?: string[]
    priceAnalysisPeriods?: { startDate: string; endDate: string }[]
  }
  const { messages, unitSlug, startDate, endDate, priceImportIds, priceAnalysisPeriods } = body

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

  // 5. Buscar KPIs e imports em paralelo
  const isComparison = priceAnalysisPeriods?.length === 2

  // Imports query: por IDs específicos (modo comparativo) ou todos da unidade
  const importsQuery = priceImportIds?.length
    ? admin.from('price_imports').select('id, parsed_data, discount_data, valid_from, valid_until').in('id', priceImportIds)
    : admin.from('price_imports').select('id, parsed_data, discount_data, valid_from, valid_until').eq('unit_id', unit.id).order('valid_from', { ascending: false })

  let kpiPeriods: KPIPeriod[]
  let rawImports: { id: string; parsed_data: unknown; discount_data: unknown; valid_from: string; valid_until: string | null }[] = []

  if (isComparison) {
    const [cA, cB, importsResult] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unit.slug, priceAnalysisPeriods![0].startDate, priceAnalysisPeriods![0].endDate),
      fetchCompanyKPIsFromAutomo(unit.slug, priceAnalysisPeriods![1].startDate, priceAnalysisPeriods![1].endDate),
      importsQuery,
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    kpiPeriods = [
      {
        label: `Período A — Tabela anterior (${priceAnalysisPeriods![0].startDate} a ${priceAnalysisPeriods![0].endDate})`,
        period: priceAnalysisPeriods![0],
        company: cA.status === 'fulfilled' ? cA.value : null,
        bookings: null,
      },
      {
        label: `Período B — Tabela atual (${priceAnalysisPeriods![1].startDate} a ${priceAnalysisPeriods![1].endDate})`,
        period: priceAnalysisPeriods![1],
        company: cB.status === 'fulfilled' ? cB.value : null,
        bookings: null,
      },
    ]
  } else {
    const kpiParams = (startDate && endDate) ? { startDate, endDate } : trailingYear()
    const [companyResult, importsResult] = await Promise.allSettled([
      fetchCompanyKPIsFromAutomo(unit.slug, kpiParams.startDate, kpiParams.endDate),
      importsQuery,
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    kpiPeriods = [{
      period: kpiParams,
      company: companyResult.status === 'fulfilled' ? companyResult.value : null,
      bookings: null,
    }]
  }

  // Montar PriceImportForPrompt com os períodos de análise como vigência de referência
  const priceImports: PriceImportForPrompt[] = rawImports.map((imp) => {
    const analysisPeriod = priceImportIds?.length
      ? priceAnalysisPeriods?.[priceImportIds.indexOf(imp.id)]
      : undefined
    return {
      rows: imp.parsed_data ? (imp.parsed_data as unknown as ParsedPriceRow[]) : [],
      discount_data: imp.discount_data ? (imp.discount_data as unknown as ParsedDiscountRow[]) : null,
      valid_from: analysisPeriod ? analysisPeriod.startDate : imp.valid_from,
      valid_until: analysisPeriod ? analysisPeriod.endDate : imp.valid_until,
    }
  })

  // 6. Montar system prompt com KPIs (por período) + tabelas
  const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports)

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
        'Após salvar, sempre oriente: "A proposta foi salva. Acesse a aba Propostas para aprovar, ajustar ou rejeitar."',
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
  })

  return result.toUIMessageStreamResponse()
}
