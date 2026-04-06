import { generateText } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface MappedPrice {
  categoria_concorrente: string
  categoria_nossa: string | null
  periodo: string
  preco: number
  dia_tipo?: string
  notas?: string
}

export interface CompetitorSnapshot {
  id: string
  competitor_name: string
  competitor_url: string
  mapped_prices: MappedPrice[]
  scraped_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireManagerOrAbove() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const, supabase: null, user: null, profile: null }
  const { data: profile } = await supabase.from('profiles').select('role, unit_id').eq('user_id', user.id).single()
  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return { error: 'Acesso negado', status: 403 as const, supabase: null, user: null, profile: null }
  }
  return { error: null, status: 200 as const, supabase, user, profile }
}

// ─── GET: snapshots recentes de concorrentes da unidade ─────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireManagerOrAbove()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error } = await auth.supabase!
    .from('competitor_snapshots')
    .select('id, competitor_name, competitor_url, mapped_prices, scraped_at')
    .eq('unit_id', unit.id)
    .order('scraped_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data as unknown as CompetitorSnapshot[])
}

// ─── POST: scraping + extração via IA ────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireManagerOrAbove()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as {
    unitSlug: string
    competitorName: string
    competitorUrl: string
    ourCategories?: string[]
  }

  const { unitSlug, competitorName, competitorUrl, ourCategories = [] } = body
  if (!unitSlug || !competitorName || !competitorUrl) {
    return new Response('unitSlug, competitorName e competitorUrl são obrigatórios', { status: 400 })
  }

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (auth.profile!.role !== 'super_admin' && auth.profile!.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN
  if (!APIFY_TOKEN) return new Response('APIFY_API_TOKEN não configurado', { status: 500 })

  // ─── Scraping via Apify (cheerio — rápido, sem JS rendering) ──────────────
  let rawText = ''
  try {
    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=50&memory=256`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: competitorUrl }],
          crawlerType: 'cheerio',
          maxCrawlPages: 5,
          maxCrawlDepth: 1,
          htmlTransformer: 'readableText',
        }),
        signal: AbortSignal.timeout(52000),
      }
    )

    if (!apifyRes.ok) {
      const errText = await apifyRes.text()
      console.error('[competitor-analysis] Apify error:', apifyRes.status, errText.slice(0, 200))
      return Response.json({ error: `Erro ao acessar o site: ${apifyRes.statusText}` }, { status: 502 })
    }

    const items = await apifyRes.json() as Array<{ text?: string; markdown?: string }>
    rawText = items
      .map((item) => item.text ?? item.markdown ?? '')
      .filter(Boolean)
      .join('\n\n---\n\n')
      .slice(0, 15000)

    console.log('[competitor-analysis] Apify: extraídos', items.length, 'páginas, total', rawText.length, 'chars')
  } catch (e) {
    console.error('[competitor-analysis] Apify timeout/error:', e)
    return Response.json({ error: 'Tempo limite excedido ao acessar o site. Tente novamente ou verifique a URL.' }, { status: 504 })
  }

  if (!rawText.trim()) {
    return Response.json({ error: 'Nenhum conteúdo de texto extraído do site. O site pode usar JavaScript pesado (tente a URL de uma página específica de preços).' }, { status: 422 })
  }

  // ─── Extração de preços via Claude ────────────────────────────────────────
  const categoriesHint = ourCategories.length > 0
    ? `\nNossas categorias de suíte: ${ourCategories.join(', ')}`
    : ''

  const extractionPrompt = `Você é um especialista em análise de preços de motéis. Analise o texto abaixo extraído do site de um motel concorrente e extraia as informações de preços.${categoriesHint}

Períodos comuns em motéis brasileiros: 3h (curta duração), 6h (meia diária ~6h), 12h (meia diária longa), pernoite (diária noturna).

Texto extraído do site (${competitorUrl}):
\`\`\`
${rawText}
\`\`\`

Instruções:
1. Identifique todas as suítes/categorias e seus preços por período
2. Mapeie cada categoria para a mais próxima das nossas (se fornecidas) ou deixe null
3. Identifique se o preço é para semana, FDS/feriado ou ambos (use "todos" quando não diferenciado)
4. Ignore taxas de serviço, descontos promocionais e preços de eventos especiais

Retorne SOMENTE este JSON minificado (sem texto antes ou depois):
{"prices":[{"categoria_concorrente":"nome exato no site","categoria_nossa":"nome mais próximo ou null","periodo":"3h","preco":0.00,"dia_tipo":"semana|fds_feriado|todos","notas":"observação opcional ou omita"}]}

Se não encontrar preços estruturados, retorne: {"prices":[],"nota":"motivo breve"}`

  let mappedPrices: MappedPrice[] = []
  let extractionNota = ''
  try {
    const { text } = await generateText({
      model: PRIMARY_MODEL,
      providerOptions: gatewayOptions,
      prompt: extractionPrompt,
      maxOutputTokens: 2000,
      temperature: 0.1,
    })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { prices?: MappedPrice[]; nota?: string }
      mappedPrices = parsed.prices ?? []
      extractionNota = parsed.nota ?? ''
    }
    console.log('[competitor-analysis] Extraídos', mappedPrices.length, 'preços')
  } catch (e) {
    console.error('[competitor-analysis] Erro de extração:', e)
    // Prossegue com prices vazio — rawText salvo para análise posterior
  }

  // ─── Upsert no banco ──────────────────────────────────────────────────────
  const { data: saved, error: saveError } = await admin
    .from('competitor_snapshots')
    .upsert(
      {
        unit_id: unit.id,
        competitor_name: competitorName,
        competitor_url: competitorUrl,
        mapped_prices: mappedPrices as unknown as Database['public']['Tables']['competitor_snapshots']['Insert']['mapped_prices'],
        raw_text: rawText.slice(0, 50000),
        scraped_at: new Date().toISOString(),
      },
      { onConflict: 'unit_id,competitor_url' }
    )
    .select('id, competitor_name, competitor_url, mapped_prices, scraped_at')
    .single()

  if (saveError) return Response.json({ error: saveError.message }, { status: 500 })

  return Response.json({
    ...saved,
    prices_found: mappedPrices.length,
    nota: extractionNota || undefined,
  })
}
