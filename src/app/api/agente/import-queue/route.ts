/**
 * /api/agente/import-queue
 *
 * GET  ?unitSlug=  — lista jobs da unidade (excluindo csv_content por tamanho)
 * POST             — enfileira um ou mais arquivos para análise em background
 * PATCH            — processa o próximo job pendente (chamado pelo frontend via polling)
 */
import { generateText } from 'ai'
import { ANALYSIS_MODEL, analysisOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow, ParsedDiscountRow } from '@/app/api/agente/import-prices/route'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const, supabase: null, user: null, profile: null }
  const { data: profile } = await supabase.from('profiles').select('role, unit_id').eq('user_id', user.id).single()
  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return { error: 'Acesso negado', status: 403 as const, supabase: null, user: null, profile: null }
  }
  return { error: null, status: 200 as const, supabase, user, profile }
}

// Reutiliza o mesmo extrator robusto de JSON do import-prices
function extractJSON(text: string): { rows: ParsedPriceRow[]; canais_encontrados: string[]; discount_rows?: ParsedDiscountRow[] } | null {
  const clean = text.trim()
  const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = codeBlock ? codeBlock[1] : clean
  const start = candidate.indexOf('{')
  if (start === -1) return null
  let depth = 0, end = -1
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++
    else if (candidate[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch { return null }
}

// ─── GET: lista jobs da unidade ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error } = await auth.supabase!
    .from('price_import_jobs')
    .select('id, file_name, valid_from, valid_until, status, error_msg, result_id, created_at, started_at, finished_at')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// ─── POST: enfileira arquivos ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as {
    unitSlug: string
    files: Array<{
      fileName: string
      csvContent: string
      validFrom: string
      validUntil?: string | null
    }>
  }

  const { unitSlug, files } = body
  if (!unitSlug || !files?.length) {
    return new Response('unitSlug e files[] são obrigatórios', { status: 400 })
  }

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (auth.profile!.role !== 'super_admin' && auth.profile!.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const inserts = files.map((f) => ({
    unit_id: unit.id,
    created_by: auth.user!.id,
    file_name: f.fileName,
    csv_content: f.csvContent,
    valid_from: f.validFrom,
    valid_until: f.validUntil ?? null,
    status: 'pending' as const,
  }))

  const { data: jobs, error } = await admin
    .from('price_import_jobs')
    .insert(inserts)
    .select('id, file_name, valid_from, valid_until, status, created_at')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(jobs)
}

// ─── PATCH: processa próximo job pendente ─────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as { unitSlug: string; retryJobId?: string }
  const { unitSlug, retryJobId } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  // Se for retry: reseta o job específico para pending e continua o fluxo normal
  if (retryJobId) {
    await admin
      .from('price_import_jobs')
      .update({ status: 'pending', error_msg: null, started_at: null, finished_at: null })
      .eq('id', retryJobId)
      .eq('unit_id', unit.id)
  }

  // Busca o próximo job pendente (ou já em processamento por muito tempo — timeout 5min)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: job } = await admin
    .from('price_import_jobs')
    .select('*')
    .eq('unit_id', unit.id)
    .or(`status.eq.pending,and(status.eq.processing,started_at.lt.${fiveMinutesAgo})`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!job) return Response.json({ done: true, message: 'Nenhum job pendente' })

  // Marca como processing
  await admin
    .from('price_import_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', job.id)

  try {
    // Analisa com IA
    const prompt = `Você receberá o conteúdo de uma planilha de tabela de preços de motel exportada como CSV.

PARTE 1 — TARIFAS
Extraia as tarifas dos seguintes canais (ignore qualquer outro):
1. **balcao_site** — Tarifa Balcão (presencial) e Site imediato
2. **site_programada** — Reserva Antecipada pelo site
3. **guia_moteis** — Guia de Motéis (aplicativo/site externo)

Para cada tarifa: canal, categoria, periodo, dia_tipo ("semana"|"fds_feriado"|"todos"), preco (numérico)

PARTE 2 — POLÍTICA DE DESCONTOS (Guia de Motéis)
Se houver tabela de descontos para o Guia de Motéis (com faixas de horário e dias da semana), extraia UMA linha por: categoria × período × dia_semana × faixa_horaria.
Campos: canal ("guia_moteis"), categoria, periodo, dia_semana ("domingo"|"segunda"|"terca"|"quarta"|"quinta"|"sexta"|"sabado"|"todos"), faixa_horaria (ex: "06:00-17:59"), tipo_desconto ("percentual"|"absoluto"), valor (número), condicao (omitir se vazio)

Retorne SOMENTE JSON minificado:
{"rows":[...],"canais_encontrados":[],"discount_rows":[]}

CSV:
${job.csv_content.slice(0, 24000)}`

    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      providerOptions: analysisOptions,
      prompt,
      maxOutputTokens: 8000,
      temperature: 0,
    })

    const parsed = extractJSON(text)
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      throw new Error('O modelo não retornou preços válidos. Verifique o formato do arquivo.')
    }

    const canais = [...new Set(parsed.rows.map((r) => r.canal))]
    const today = new Date().toISOString().slice(0, 10)

    // Salva o price_import
    const { data: importRecord, error: importError } = await admin
      .from('price_imports')
      .insert({
        unit_id: unit.id,
        imported_by: auth.user!.id,
        raw_content: job.csv_content,
        parsed_data: parsed.rows as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        discount_data: (parsed.discount_rows?.length)
          ? parsed.discount_rows as unknown as Database['public']['Tables']['price_imports']['Insert']['discount_data']
          : null,
        canals: canais,
        is_active: true,
        valid_from: job.valid_from,
        valid_until: job.valid_until ?? null,
      })
      .select('id')
      .single()

    if (importError) throw new Error(importError.message)

    // Marca job como done
    await admin
      .from('price_import_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), result_id: importRecord.id })
      .eq('id', job.id)

    // Notificação in-app
    await admin.from('notifications').insert({
      user_id: auth.user!.id,
      title: 'Planilha importada',
      body: `"${job.file_name}" foi analisada e importada com sucesso (${parsed.rows.length} preços).`,
      type: 'success',
    })

    return Response.json({
      done: false,
      jobId: job.id,
      fileName: job.file_name,
      rowsImported: parsed.rows.length,
      importId: importRecord.id,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido'
    console.error('[import-queue] Erro ao processar job', job.id, msg)

    await admin
      .from('price_import_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error_msg: msg })
      .eq('id', job.id)

    // Notificação de erro
    await admin.from('notifications').insert({
      user_id: auth.user!.id,
      title: 'Falha na importação',
      body: `"${job.file_name}": ${msg}`,
      type: 'error',
    })

    return Response.json({ done: false, jobId: job.id, error: msg })
  }
}
