import { streamText, convertToModelMessages } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchCompanyKPIs,
  fetchBookingsKPIs,
  trailingYear,
} from '@/lib/lhg-analytics/client'
import { buildSystemPrompt } from '@/lib/agente/system-prompt'
import { createClient as createAdminClient } from '@supabase/supabase-js'
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

  // 7. Stream via AI Gateway (Claude primário, Gemini como fallback automático)
  const result = streamText({
    model: PRIMARY_MODEL,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as Parameters<typeof convertToModelMessages>[0]),
    maxOutputTokens: 8192,
    temperature: 0.3,
    providerOptions: gatewayOptions,
  })

  return result.toUIMessageStreamResponse()
}
