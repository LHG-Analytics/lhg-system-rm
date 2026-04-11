import { generateText } from 'ai'
import { ANALYSIS_MODEL, analysisOptions } from '@/lib/agente/model'
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
  status: 'processing' | 'done' | 'failed'
  apify_run_id: string | null
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
function buildPlaywrightPageFunction(fridayDate: Date): string {
  const fridayDay = fridayDate.getDate()
  const fridayMonth = fridayDate.getMonth()
  const fridayYear = fridayDate.getFullYear()
  const fridayPadded = `${fridayYear}-${String(fridayMonth + 1).padStart(2, '0')}-${String(fridayDay).padStart(2, '0')}`

  return `
async function pageFunction({ page, log }) {
  await page.waitForTimeout(5000);

  const todayText = await page.evaluate(() => document.body.innerText);
  log.info('Tamanho conteúdo inicial: ' + todayText.length);
  const results = [{ label: 'hoje (dia de semana)', text: todayText.slice(0, 8000) }];

  const fridayDay   = ${fridayDay};
  const fridayIso   = '${fridayPadded}';
  const fridayPt    = '${String(fridayDay).padStart(2, '0')}/${String(fridayMonth + 1).padStart(2, '0')}/${fridayYear}';

  try {
    const dateInput = await page.$('input[type="date"]');
    if (dateInput) {
      await dateInput.fill(fridayIso);
      await dateInput.dispatchEvent('change');
      await dateInput.dispatchEvent('input');
      await page.waitForTimeout(3000);
      const t = await page.evaluate(() => document.body.innerText);
      results.push({ label: 'sexta-feira (final de semana)', text: t.slice(0, 8000) });
      log.info('Estratégia date input bem-sucedida');
      return results;
    }

    const triggerSelectors = [
      '[class*="datepicker"]','[class*="date-picker"]','[class*="calendar-input"]',
      '[class*="calendario"]','[class*="data-busca"]','input[placeholder*="data"]',
      'input[placeholder*="Data"]','.input-group [class*="calendar"]',
      '[data-toggle="datepicker"]','button[class*="date"]',
    ];

    let calendarOpened = false;
    for (const sel of triggerSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await page.waitForTimeout(1500);
          const popup = await page.$('.datepicker, .flatpickr-calendar, .pika-single, [class*="calendar-popup"], [class*="datepicker-dropdown"]');
          if (popup) { calendarOpened = true; log.info('Calendário aberto via: ' + sel); break; }
        }
      } catch(e) { /* tenta próximo */ }
    }

    if (!calendarOpened) { log.info('Nenhum calendário interativo encontrado'); return results; }

    let fridayClicked = false;
    for (let pass = 0; pass < 2 && !fridayClicked; pass++) {
      const cellSelectors = [
        \`[data-date="\${fridayIso}"]\`,\`[data-date="\${fridayPt}"]\`,
        \`td[data-day="\${fridayDay}"]:not([class*="disabled"]):not([class*="prev"]):not([class*="next"])\`,
        \`td:not([class*="disabled"]) >> text="\${fridayDay}"\`,
      ];
      for (const cellSel of cellSelectors) {
        try {
          const cell = await page.$(cellSel);
          if (cell) {
            await cell.click();
            await page.waitForTimeout(3000);
            const t = await page.evaluate(() => document.body.innerText);
            if (t !== todayText) {
              results.push({ label: 'sexta-feira (final de semana)', text: t.slice(0, 8000) });
              fridayClicked = true;
              log.info('Sexta selecionada via: ' + cellSel);
            }
            break;
          }
        } catch(e) { /* tenta próximo */ }
      }
      if (!fridayClicked && pass === 0) {
        try {
          const nextBtn = await page.$('.datepicker--nav-action[data-action="next"], .pika-next, .flatpickr-next-month, [class*="next-month"]');
          if (nextBtn) { await nextBtn.click(); await page.waitForTimeout(1000); }
        } catch(e) { /* ignora */ }
      }
    }
    if (!fridayClicked) log.info('Não conseguiu selecionar sexta-feira');
  } catch(e) {
    log.info('Erro na interação do calendário: ' + String(e));
  }
  return results;
}
`
}

// Extrai preços do texto via IA e salva/atualiza no banco
async function extractAndSave({
  rawText, competitorUrl, competitorName, ourCategories, mode, unitId,
}: {
  rawText: string
  competitorUrl: string
  competitorName: string
  ourCategories: string[]
  mode: string
  unitId: string
}): Promise<CompetitorSnapshot> {
  const admin = getAdminClient()
  const categoriesHint = ourCategories.length > 0
    ? `\nNossas categorias de suíte: ${ourCategories.join(', ')}`
    : ''
  const modeHint = mode === 'playwright'
    ? '\nO texto foi coletado em dois momentos: "HOJE (DIA DE SEMANA)" e "SEXTA-FEIRA (FINAL DE SEMANA)". Use essas seções para preencher corretamente o campo dia_tipo.'
    : ''

  const extractionPrompt = `Você é um especialista em análise de preços de motéis. Analise o texto abaixo extraído do site de um motel concorrente e extraia as informações de preços.${categoriesHint}${modeHint}

Períodos comuns em motéis brasileiros: 3h, 6h, 12h, pernoite.

Texto extraído do site (${competitorUrl}):
\`\`\`
${rawText.slice(0, 15000)}
\`\`\`

Instruções:
1. Identifique todas as suítes/categorias e seus preços por período
2. Mapeie cada categoria para a mais próxima das nossas (se fornecidas) ou deixe null
3. Identifique se o preço é para semana, FDS/feriado ou ambos ("todos" quando não diferenciado)
4. Ignore taxas de serviço, descontos promocionais pontuais e preços de eventos especiais
5. Se houver preços diferentes para semana e FDS, crie DUAS entradas por item

Retorne SOMENTE este JSON minificado:
{"prices":[{"categoria_concorrente":"nome exato","categoria_nossa":"nome próximo ou null","periodo":"3h|6h|12h|pernoite","preco":0.00,"dia_tipo":"semana|fds_feriado|todos","notas":"omitir se vazio"}]}

Se não encontrar preços estruturados, retorne: {"prices":[],"nota":"motivo breve"}`

  let mappedPrices: MappedPrice[] = []
  try {
    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      providerOptions: analysisOptions,
      prompt: extractionPrompt,
      maxOutputTokens: 2000,
      temperature: 0.1,
    })
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { prices?: MappedPrice[] }
      mappedPrices = parsed.prices ?? []
    }
    console.log('[competitor-analysis] Extraídos', mappedPrices.length, 'preços de', competitorUrl)
  } catch (e) {
    console.error('[competitor-analysis] Erro de extração:', e)
  }

  const { data: saved, error: saveError } = await admin
    .from('competitor_snapshots')
    .upsert(
      {
        unit_id: unitId,
        competitor_name: competitorName,
        competitor_url: competitorUrl,
        mapped_prices: mappedPrices as unknown as Database['public']['Tables']['competitor_snapshots']['Insert']['mapped_prices'],
        raw_text: rawText.slice(0, 50000),
        scraped_at: new Date().toISOString(),
        status: 'done',
        apify_run_id: null,
      },
      { onConflict: 'unit_id,competitor_url' }
    )
    .select('id, competitor_name, competitor_url, mapped_prices, scraped_at, status, apify_run_id')
    .single()

  if (saveError) throw new Error(saveError.message)
  return saved as unknown as CompetitorSnapshot
}

// ─── GET: snapshots recentes OU polling de run Playwright ───────────────────

export async function GET(req: NextRequest) {
  const auth = await requireManagerOrAbove()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const { searchParams } = req.nextUrl
  const runId = searchParams.get('runId')

  // ── Polling: verificar status de run Playwright assíncrono ─────────────────
  if (runId) {
    const unitSlug       = searchParams.get('unitSlug') ?? ''
    const competitorUrl  = searchParams.get('competitorUrl') ?? ''
    const competitorName = searchParams.get('competitorName') ?? ''
    const ourCategories  = searchParams.get('ourCategories')?.split(',').filter(Boolean) ?? []

    const APIFY_TOKEN = process.env.APIFY_API_TOKEN
    if (!APIFY_TOKEN) return Response.json({ error: 'APIFY_API_TOKEN não configurado' }, { status: 500 })

    try {
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!statusRes.ok) return Response.json({ status: 'failed', error: 'Erro ao verificar status do run' }, { status: 502 })

      const statusData = await statusRes.json() as { data: { status: string } }
      const runStatus = statusData.data?.status

      if (['RUNNING', 'READY', 'CREATED'].includes(runStatus)) {
        return Response.json({ status: 'processing' })
      }

      if (runStatus !== 'SUCCEEDED') {
        console.error('[competitor-analysis] Run falhou:', runStatus)
        // Marca o snapshot como failed no banco
        const admin = getAdminClient()
        const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
        if (unit) {
          await admin.from('competitor_snapshots')
            .update({ status: 'failed' })
            .eq('unit_id', unit.id)
            .eq('competitor_url', competitorUrl)
        }
        return Response.json({ status: 'failed', error: `Run terminou com status: ${runStatus}` })
      }

      // Run bem-sucedido — busca os resultados
      const admin = getAdminClient()
      const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
      if (!unit) return Response.json({ status: 'failed', error: 'Unidade não encontrada' })

      const itemsRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (!itemsRes.ok) return Response.json({ status: 'failed', error: 'Erro ao buscar resultados do run' }, { status: 502 })

      const items = await itemsRes.json() as Array<Array<{ label: string; text: string }>>
      const sections = items.flat().filter((s) => s?.label && s?.text)
      const rawText = sections
        .map((s) => `=== ${s.label.toUpperCase()} ===\n${s.text}`)
        .join('\n\n')
        .slice(0, 20000)

      console.log('[competitor-analysis] Playwright concluído, capturas:', sections.map((s) => s.label))

      if (!rawText.trim()) {
        return Response.json({ status: 'failed', error: 'Nenhum conteúdo extraído pelo Playwright.' })
      }

      const snapshot = await extractAndSave({
        rawText, competitorUrl, competitorName, ourCategories, mode: 'playwright', unitId: unit.id,
      })
      return Response.json(snapshot)
    } catch (e) {
      console.error('[competitor-analysis] Erro ao verificar run:', e)
      return Response.json({ status: 'failed', error: 'Tempo excedido ao verificar status do run.' })
    }
  }

  // ── Listagem normal de snapshots ───────────────────────────────────────────
  const unitSlug = searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error } = await auth.supabase!
    .from('competitor_snapshots')
    .select('id, competitor_name, competitor_url, mapped_prices, scraped_at, status, apify_run_id')
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
    competitorLabel?: string
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

  // ─── Playwright: run assíncrono ───────────────────────────────────────────
  if (mode === 'playwright') {
    const friday = nextFridayDate()
    const pageFunction = buildPlaywrightPageFunction(friday)

    console.log('[competitor-analysis] Iniciando run Playwright — sexta alvo:', friday.toISOString().slice(0, 10))
    try {
      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/apify~playwright-scraper/runs?token=${APIFY_TOKEN}&timeout=180&memory=1024`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startUrls: [{ url: competitorUrl }],
            pageFunction,
            maxCrawlPages: 1,
          }),
          signal: AbortSignal.timeout(15000),
        }
      )

      if (!apifyRes.ok) {
        const errText = await apifyRes.text()
        console.error('[competitor-analysis] Apify playwright start error:', apifyRes.status, errText.slice(0, 200))
        return Response.json({ error: `Erro ao iniciar análise: ${apifyRes.statusText}` }, { status: 502 })
      }

      const runData = await apifyRes.json() as { data: { id: string; status: string } }
      const runId = runData.data?.id
      console.log('[competitor-analysis] Run Playwright iniciado:', runId)

      // Pré-cria snapshot com status 'processing' para sobreviver a navegações
      await admin.from('competitor_snapshots').upsert(
        {
          unit_id: unit.id,
          competitor_name: competitorName,
          competitor_url: competitorUrl,
          mapped_prices: [] as unknown as Database['public']['Tables']['competitor_snapshots']['Insert']['mapped_prices'],
          scraped_at: new Date().toISOString(),
          status: 'processing',
          apify_run_id: runId,
        },
        { onConflict: 'unit_id,competitor_url' }
      )

      return Response.json({
        status: 'processing',
        runId,
        competitorUrl,
        message: 'Análise iniciada. O Playwright está acessando o site (~1-2 min).',
      })
    } catch (e) {
      console.error('[competitor-analysis] Erro ao iniciar run Playwright:', e)
      return Response.json({ error: 'Erro ao iniciar análise Playwright. Verifique o token Apify.' }, { status: 502 })
    }
  }

  // ─── Cheerio: scraping estático (síncrono) ────────────────────────────────
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
          maxCrawlPages: 3,
        }),
        signal: AbortSignal.timeout(55000),
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

    console.log('[competitor-analysis] Cheerio:', items.length, 'páginas,', rawText.length, 'chars')
  } catch (e) {
    console.error('[competitor-analysis] Cheerio timeout/error:', e)
    return Response.json({ error: 'Tempo limite excedido ao acessar o site. Tente novamente ou verifique a URL.' }, { status: 504 })
  }

  if (!rawText.trim()) {
    return Response.json({ error: 'Nenhum conteúdo extraído do site.' }, { status: 422 })
  }

  const snapshot = await extractAndSave({
    rawText, competitorUrl, competitorName, ourCategories, mode, unitId: unit.id,
  })
  return Response.json(snapshot)
}
