import { streamText, convertToModelMessages, tool } from 'ai'
import { z } from 'zod'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchCompanyKPIs,
  fetchBookingsKPIs,
  trailingYear,
} from '@/lib/lhg-analytics/client'
import { buildSystemPrompt, buildKPIContext } from '@/lib/agente/system-prompt'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
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
  let unit: { id: string; name: string; slug: string; api_base_url: string | null } | null = null

  if (unitSlug) {
    const { data } = await admin
      .from('units')
      .select('id, name, slug, api_base_url')
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
      .select('id, name, slug, api_base_url')
      .eq('id', profile.unit_id)
      .single()
    unit = data
  }

  if (!unit && profile.role === 'super_admin') {
    const { data } = await admin
      .from('units')
      .select('id, name, slug, api_base_url')
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
  const lhgUnit = { slug: unit.slug, apiBaseUrl: unit.api_base_url ?? '' }
  const isComparison = priceAnalysisPeriods?.length === 2

  // Imports query: por IDs específicos (modo comparativo) ou todos da unidade
  const importsQuery = priceImportIds?.length
    ? admin.from('price_imports').select('id, parsed_data, valid_from, valid_until').in('id', priceImportIds)
    : admin.from('price_imports').select('id, parsed_data, valid_from, valid_until').eq('unit_id', unit.id).order('valid_from', { ascending: false })

  let kpiPeriods: KPIPeriod[]
  let rawImports: { id: string; parsed_data: unknown; valid_from: string; valid_until: string | null }[] = []

  if (isComparison && unit.api_base_url) {
    // Modo comparativo: busca KPIs de cada período separadamente (4 fetches paralelos)
    const [cA, bA, cB, bB, importsResult] = await Promise.allSettled([
      fetchCompanyKPIs(lhgUnit, priceAnalysisPeriods![0]),
      fetchBookingsKPIs(lhgUnit, priceAnalysisPeriods![0]),
      fetchCompanyKPIs(lhgUnit, priceAnalysisPeriods![1]),
      fetchBookingsKPIs(lhgUnit, priceAnalysisPeriods![1]),
      importsQuery,
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    kpiPeriods = [
      {
        label: `Período A — Tabela anterior (${priceAnalysisPeriods![0].startDate} a ${priceAnalysisPeriods![0].endDate})`,
        period: priceAnalysisPeriods![0],
        company: cA.status === 'fulfilled' ? cA.value : null,
        bookings: bA.status === 'fulfilled' ? bA.value : null,
      },
      {
        label: `Período B — Tabela atual (${priceAnalysisPeriods![1].startDate} a ${priceAnalysisPeriods![1].endDate})`,
        period: priceAnalysisPeriods![1],
        company: cB.status === 'fulfilled' ? cB.value : null,
        bookings: bB.status === 'fulfilled' ? bB.value : null,
      },
    ]
  } else {
    // Modo simples: único período
    const kpiParams = (startDate && endDate) ? { startDate, endDate } : trailingYear()
    const [companyResult, bookingsResult, importsResult] = await Promise.allSettled([
      unit.api_base_url ? fetchCompanyKPIs(lhgUnit, kpiParams) : Promise.reject('no api url'),
      unit.api_base_url ? fetchBookingsKPIs(lhgUnit, kpiParams) : Promise.reject('no api url'),
      importsQuery,
    ])
    rawImports = importsResult.status === 'fulfilled' ? (importsResult.value.data ?? []) : []
    kpiPeriods = [{
      period: kpiParams,
      company: companyResult.status === 'fulfilled' ? companyResult.value : null,
      bookings: bookingsResult.status === 'fulfilled' ? bookingsResult.value : null,
    }]
  }

  // Montar PriceImportForPrompt com os períodos de análise como vigência de referência
  const priceImports: PriceImportForPrompt[] = rawImports.map((imp) => {
    const analysisPeriod = priceImportIds?.length
      ? priceAnalysisPeriods?.[priceImportIds.indexOf(imp.id)]
      : undefined
    return {
      rows: imp.parsed_data ? (imp.parsed_data as unknown as ParsedPriceRow[]) : [],
      valid_from: analysisPeriod ? analysisPeriod.startDate : imp.valid_from,
      valid_until: analysisPeriod ? analysisPeriod.endDate : imp.valid_until,
    }
  })

  // 6. Montar system prompt com KPIs (por período) + tabelas
  const systemPrompt = buildSystemPrompt(unit.name, kpiPeriods, priceImports)

  // 7. Definir tools (fecham sobre `unit` e `lhgUnit`)
  const lhgUnitForTools = { slug: unit.slug, apiBaseUrl: unit.api_base_url ?? '' }

  const agentTools = {
    buscar_kpis_periodo: tool({
      description:
        'Busca KPIs operacionais completos (giro, RevPAR, ticket médio, ocupação, canal digital, tabelas semanais) ' +
        'para qualquer período específico via LHG Analytics. ' +
        'Use sempre que o usuário mencionar datas específicas, pedir monitoramento de uma semana, ' +
        'ou quando os dados do contexto não cobrirem o período solicitado. ' +
        'Nunca diga que não tem acesso — use este tool.',
      inputSchema: z.object({
        startDate: z.string().describe('Data inicial no formato DD/MM/YYYY, ex: "01/04/2026"'),
        endDate:   z.string().describe('Data final no formato DD/MM/YYYY, ex: "07/04/2026"'),
      }),
      execute: async ({ startDate, endDate }) => {
        if (!unit.api_base_url) {
          return 'API de analytics não configurada para esta unidade. Solicite ao administrador que configure api_base_url.'
        }
        const [companyResult, bookingsResult] = await Promise.allSettled([
          fetchCompanyKPIs(lhgUnitForTools, { startDate, endDate }),
          fetchBookingsKPIs(lhgUnitForTools, { startDate, endDate }),
        ])
        const company  = companyResult.status  === 'fulfilled' ? companyResult.value  : null
        const bookings = bookingsResult.status === 'fulfilled' ? bookingsResult.value : null
        if (!company) return `Falha ao buscar KPIs para ${startDate} a ${endDate}. Verifique se o período é válido.`
        return buildKPIContext(unit.name, { startDate, endDate }, company, bookings)
      },
    }),

    buscar_dados_automo: tool({
      description:
        'Consulta diretamente o ERP Automo para obter giro, total de locações e número de suítes por categoria ' +
        'em qualquer período. Use quando precisar de dados granulares por categoria ou quando a API de analytics ' +
        'não estiver disponível.',
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
    maxOutputTokens: 8192,
    temperature: 0.3,
    providerOptions: gatewayOptions,
  })

  return result.toUIMessageStreamResponse()
}
