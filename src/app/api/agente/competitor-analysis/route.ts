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

// pageFunction injetada no browser via apify/playwright-scraper
// Estratégia: clica no ícone de calendário, navega para terça (semana) e sábado (FDS)
// usando índices de coluna da tabela de calendário (Dom=0 Seg=1 Ter=2 Qua=3 Qui=4 Sex=5 Sab=6)
function buildPlaywrightPageFunction(): string {
  return `
async function pageFunction({ page, log }) {
  await page.waitForTimeout(3000);
  const results = [];

  const extractPrices = async (label) => {
    const data = await page.evaluate(() => {
      const allInputs = document.querySelectorAll('input');
      const dateVal = allInputs[0] ? allInputs[0].value : '';
      const priceTable = document.querySelectorAll('table')[0];
      if (!priceTable) return { dateVal, rows: [] };
      const rows = Array.from(priceTable.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()).join(' | ')
      ).filter(r => r.trim());
      return { dateVal, rows };
    });
    log.info('Preços ' + label + ' (' + data.dateVal + '): ' + data.rows.length + ' linhas');
    return { label, text: 'Data: ' + data.dateVal + '\\n' + data.rows.join('\\n') };
  };

  try {
    // Abre o calendário de preços clicando no ícone
    await page.evaluate(() => {
      const calIcon = document.querySelector('img[alt="Escolha a Data"]');
      if (calIcon) calIcon.click();
    });
    await page.waitForTimeout(800);

    // Clica numa terça-feira (col 2) para preços de dia de semana
    // Fallback: segunda, quarta, quinta
    const weekdayClicked = await page.evaluate(() => {
      const calTable = document.querySelectorAll('table')[1];
      if (!calTable) return false;
      const rows = Array.from(calTable.querySelectorAll('tbody tr'));
      for (const colIdx of [2, 1, 3, 4]) {
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          const cell = cells[colIdx];
          if (cell) {
            const link = cell.querySelector('a');
            if (link) { link.click(); return true; }
          }
        }
      }
      return false;
    });

    if (weekdayClicked) {
      await page.waitForTimeout(1200);
      results.push(await extractPrices('dia de semana'));
    }

    // Clica num sábado (col 6) para preços de FDS
    // Fallback: domingo (col 0)
    const weekendClicked = await page.evaluate(() => {
      const calTable = document.querySelectorAll('table')[1];
      if (!calTable) return false;
      const rows = Array.from(calTable.querySelectorAll('tbody tr'));
      for (const colIdx of [6, 0]) {
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          const cell = cells[colIdx];
          if (cell) {
            const link = cell.querySelector('a');
            if (link) { link.click(); return true; }
          }
        }
      }
      return false;
    });

    if (weekendClicked) {
      await page.waitForTimeout(1200);
      results.push(await extractPrices('final de semana'));
    }

    if (results.length === 0) {
      log.info('Calendário não interagido — capturando texto geral');
      const t = await page.evaluate(() => document.body.innerText);
      results.push({ label: 'preços gerais', text: t.slice(0, 8000) });
    }
  } catch(e) {
    log.info('Erro: ' + String(e));
    const t = await page.evaluate(() => document.body.innerText);
    results.push({ label: 'preços (fallback)', text: t.slice(0, 8000) });
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
    ? '\nO texto foi coletado em dois momentos: "DIA DE SEMANA" e "FINAL DE SEMANA". Use essas seções para preencher corretamente o campo dia_tipo (semana ou fds_feriado).'
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

  // ─── Playwright: run assíncrono (requer Apify) ───────────────────────────
  if (mode === 'playwright') {
    const APIFY_TOKEN = process.env.APIFY_API_TOKEN
    if (!APIFY_TOKEN) return new Response('APIFY_API_TOKEN não configurado', { status: 500 })
    const pageFunction = buildPlaywrightPageFunction()

    console.log('[competitor-analysis] Iniciando run Playwright para', competitorUrl)
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

  // ─── Jina.ai Reader: scraping gratuito e sem configuração ───────────────
  let rawText = ''
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${competitorUrl}`, {
      headers: { 'Accept': 'text/markdown' },
      signal: AbortSignal.timeout(20000),
    })

    if (!jinaRes.ok) {
      return Response.json({ error: `Erro ao acessar o site: HTTP ${jinaRes.status}` }, { status: 502 })
    }

    rawText = (await jinaRes.text()).slice(0, 15000)
    console.log('[competitor-analysis] Jina.ai:', rawText.length, 'chars de', competitorUrl)
  } catch (e) {
    console.error('[competitor-analysis] Jina.ai error:', e)
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
