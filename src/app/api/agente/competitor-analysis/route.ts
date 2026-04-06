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

// Próxima sexta-feira a partir de hoje
function nextFridayDate(): Date {
  const today = new Date()
  const daysUntil = ((5 - today.getDay()) + 7) % 7 || 7
  const friday = new Date(today)
  friday.setDate(today.getDate() + daysUntil)
  return friday
}

// pageFunction injetada no browser via apify/playwright-scraper
// Captura preços do dia atual e tenta navegar o calendário até a próxima sexta
function buildPlaywrightPageFunction(fridayDate: Date): string {
  const fridayDay = fridayDate.getDate()
  const fridayMonth = fridayDate.getMonth() // 0-based
  const fridayYear = fridayDate.getFullYear()

  return `
async function pageFunction({ page, log }) {
  // Aguarda conteúdo dinâmico carregar
  await page.waitForTimeout(3000);

  const todayText = await page.evaluate(() => document.body.innerText);
  const results = [{ label: 'hoje (dia de semana)', text: todayText.slice(0, 7000) }];

  // Próxima sexta-feira alvo
  const fridayDay = ${fridayDay};
  const fridayMonth = ${fridayMonth};
  const fridayYear = ${fridayYear};

  try {
    // Tenta clicar no gatilho do calendário (input, ícone ou wrapper com data)
    const triggers = [
      'input[type="date"]',
      '[class*="calendar"] input',
      '[class*="datepicker"] input',
      '[class*="date"] input',
      '[class*="calendario"]',
      'input[class*="date"]',
    ];
    let clicked = false;
    for (const sel of triggers) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          await el.click({ timeout: 2000 });
          clicked = true;
          log.info('Clicou no calendário via: ' + sel);
          break;
        }
      } catch(e) { /* tenta próximo */ }
    }

    if (!clicked) {
      log.info('Nenhum gatilho de calendário encontrado');
      return results;
    }

    await page.waitForTimeout(1200);

    // Navega o calendário para o mês correto (até 2 cliques em "próximo mês")
    for (let attempt = 0; attempt < 2; attempt++) {
      const visibleMonth = await page.evaluate(() => {
        const el = document.querySelector('[class*="month"], [class*="mes"], .ui-datepicker-month, .flatpickr-month');
        return el ? el.textContent : null;
      });
      log.info('Mês visível: ' + visibleMonth);

      // Tenta encontrar e clicar a célula com o dia da sexta
      const dateCell = page.locator(
        \`[data-date*="\${fridayYear}-\${String(fridayMonth+1).padStart(2,'0')}-\${String(fridayDay).padStart(2,'0')}"], \` +
        \`td[data-day="\${fridayDay}"]:not(.disabled):not(.flatpickr-disabled), \` +
        \`[class*="day"]:not(.disabled):not(.prev):not(.next) >> text="\${fridayDay}"\`
      ).first();

      if (await dateCell.count() > 0) {
        await dateCell.click({ timeout: 2000 });
        log.info('Clicou no dia ' + fridayDay);
        await page.waitForTimeout(2500);

        const fridayText = await page.evaluate(() => document.body.innerText);
        results.push({ label: 'sexta-feira (final de semana)', text: fridayText.slice(0, 7000) });
        break;
      }

      // Avança para o próximo mês
      try {
        const nextBtn = page.locator(
          '[class*="next"], [class*="proximo"], [class*="arrow-right"], .ui-datepicker-next, button[aria-label*="next"], button[aria-label*="próximo"]'
        ).first();
        if (await nextBtn.count() > 0) {
          await nextBtn.click({ timeout: 2000 });
          await page.waitForTimeout(800);
        } else {
          break;
        }
      } catch(e) { break; }
    }
  } catch(e) {
    log.info('Erro na interação do calendário: ' + e.message);
  }

  return results;
}
`
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
    mode?: 'cheerio' | 'playwright'
  }

  const { unitSlug, competitorName, competitorUrl, ourCategories = [], mode = 'cheerio' } = body
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

  // ─── Scraping via Apify ───────────────────────────────────────────────────
  let rawText = ''

  if (mode === 'playwright') {
    // Playwright: renderiza JS + tenta interagir com calendário para pegar semana E FDS
    const friday = nextFridayDate()
    const pageFunction = buildPlaywrightPageFunction(friday)

    try {
      console.log('[competitor-analysis] Modo playwright — sexta alvo:', friday.toISOString().slice(0, 10))
      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/apify~playwright-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=55&memory=1024`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startUrls: [{ url: competitorUrl }],
            pageFunction,
            maxCrawlPages: 1,
          }),
          signal: AbortSignal.timeout(58000),
        }
      )

      if (!apifyRes.ok) {
        const errText = await apifyRes.text()
        console.error('[competitor-analysis] Apify playwright error:', apifyRes.status, errText.slice(0, 300))
        return Response.json({ error: `Erro no Playwright: ${apifyRes.statusText}` }, { status: 502 })
      }

      // playwright-scraper retorna array onde cada item é o retorno da pageFunction
      const items = await apifyRes.json() as Array<Array<{ label: string; text: string }>>
      const sections = items.flat().filter((s) => s?.label && s?.text)
      rawText = sections
        .map((s) => `=== ${s.label.toUpperCase()} ===\n${s.text}`)
        .join('\n\n')
        .slice(0, 20000)

      console.log('[competitor-analysis] Playwright: capturas', sections.map((s) => s.label))
    } catch (e) {
      console.error('[competitor-analysis] Playwright timeout/error:', e)
      return Response.json({ error: 'Tempo excedido no Playwright. O site pode ser muito lento ou bloquear automação.' }, { status: 504 })
    }
  } else {
    // Cheerio: scraping estático rápido (sem JS)
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
        console.error('[competitor-analysis] Apify cheerio error:', apifyRes.status, errText.slice(0, 200))
        return Response.json({ error: `Erro ao acessar o site: ${apifyRes.statusText}` }, { status: 502 })
      }

      const items = await apifyRes.json() as Array<{ text?: string; markdown?: string }>
      rawText = items
        .map((item) => item.text ?? item.markdown ?? '')
        .filter(Boolean)
        .join('\n\n---\n\n')
        .slice(0, 15000)

      console.log('[competitor-analysis] Cheerio: extraídos', items.length, 'páginas, total', rawText.length, 'chars')
    } catch (e) {
      console.error('[competitor-analysis] Cheerio timeout/error:', e)
      return Response.json({ error: 'Tempo limite excedido ao acessar o site. Tente novamente ou verifique a URL.' }, { status: 504 })
    }
  }

  if (!rawText.trim()) {
    return Response.json({ error: 'Nenhum conteúdo extraído do site.' }, { status: 422 })
  }

  // ─── Extração de preços via Claude ────────────────────────────────────────
  const categoriesHint = ourCategories.length > 0
    ? `\nNossas categorias de suíte: ${ourCategories.join(', ')}`
    : ''

  const modeHint = mode === 'playwright'
    ? '\nO texto foi coletado em dois momentos: "HOJE (DIA DE SEMANA)" e "SEXTA-FEIRA (FINAL DE SEMANA)". Use essas seções para preencher corretamente o campo dia_tipo.'
    : ''

  const extractionPrompt = `Você é um especialista em análise de preços de motéis. Analise o texto abaixo extraído do site de um motel concorrente e extraia as informações de preços.${categoriesHint}${modeHint}

Períodos comuns em motéis brasileiros: 3h (curta duração), 6h (meia diária ~6h), 12h (meia diária longa), pernoite (diária noturna).

Texto extraído do site (${competitorUrl}):
\`\`\`
${rawText}
\`\`\`

Instruções:
1. Identifique todas as suítes/categorias e seus preços por período
2. Mapeie cada categoria para a mais próxima das nossas (se fornecidas) ou deixe null
3. Identifique se o preço é para semana, FDS/feriado ou ambos (use "todos" quando não diferenciado)
4. Ignore taxas de serviço, descontos promocionais pontuais e preços de eventos especiais
5. Se houver preços diferentes para semana e FDS, crie DUAS entradas para cada item (uma por dia_tipo)

Retorne SOMENTE este JSON minificado (sem texto antes ou depois):
{"prices":[{"categoria_concorrente":"nome exato no site","categoria_nossa":"nome mais próximo ou null","periodo":"3h|6h|12h|pernoite","preco":0.00,"dia_tipo":"semana|fds_feriado|todos","notas":"observação opcional ou omita"}]}

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
