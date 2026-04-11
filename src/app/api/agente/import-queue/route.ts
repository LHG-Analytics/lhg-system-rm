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

  const importType = req.nextUrl.searchParams.get('importType') // null = todos

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  // NOTE: import_type was added via migration; database.types.ts needs regeneration for full type support
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (auth.supabase! as any)
    .from('price_import_jobs')
    .select('id, file_name, valid_from, valid_until, status, error_msg, result_id, created_at, started_at, finished_at, import_type')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (importType === 'prices' || importType === 'discounts') {
    query = query.eq('import_type', importType)
  }

  const { data, error } = await query

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// ─── POST: enfileira arquivos ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as {
    unitSlug: string
    importType?: 'prices' | 'discounts'
    files: Array<{
      fileName: string
      csvContent: string
      validFrom: string
      validUntil?: string | null
    }>
  }

  const { unitSlug, files, importType: bodyImportType } = body
  if (!unitSlug || !files?.length) {
    return new Response('unitSlug e files[] são obrigatórios', { status: 400 })
  }

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (auth.profile!.role !== 'super_admin' && auth.profile!.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const importTypeValue = bodyImportType ?? 'prices'

  // NOTE: import_type added via migration; cast needed until database.types.ts is regenerated
  const inserts = files.map((f) => ({
    unit_id: unit.id,
    created_by: auth.user!.id,
    file_name: f.fileName,
    csv_content: f.csvContent,
    valid_from: f.validFrom,
    valid_until: f.validUntil ?? null,
    status: 'pending' as const,
    import_type: importTypeValue,
  }))

  const { data: jobs, error } = await (admin as any)
    .from('price_import_jobs')
    .insert(inserts)
    .select('id, file_name, valid_from, valid_until, status, created_at, import_type')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(jobs)
}

// ─── PATCH: processa próximo job pendente | confirma | rejeita ────────────────

export async function PATCH(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as {
    unitSlug: string
    retryJobId?: string
    action?: 'confirm' | 'reject'
    jobId?: string
  }
  const { unitSlug, retryJobId, action, jobId } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  // ── CONFIRMAR importação ──────────────────────────────────────────────────
  if (action === 'confirm' && jobId) {
    const { data: job } = await admin
      .from('price_import_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('unit_id', unit.id)
      .single()

    if (!job) return new Response('Job não encontrado', { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preview = (job as any).parsed_preview as {
      rows: ParsedPriceRow[]
      discount_rows: ParsedDiscountRow[]
      canais_encontrados: string[]
    } | null

    if (!preview) return Response.json({ error: 'Sem dados para confirmar' }, { status: 400 })

    const jobImportType: 'prices' | 'discounts' = (job as any).import_type === 'discounts' ? 'discounts' : 'prices'

    let canais: string[]
    let parsedDataToSave: ParsedPriceRow[]
    let discountDataToSave: ParsedDiscountRow[] | null

    if (jobImportType === 'discounts') {
      canais = ['guia_moteis']
      parsedDataToSave = []
      discountDataToSave = preview.discount_rows
    } else {
      canais = [...new Set(preview.rows.map((r) => r.canal))]
      parsedDataToSave = preview.rows
      discountDataToSave = null
    }

    const { data: importRecord, error: importError } = await (admin as any)
      .from('price_imports')
      .insert({
        unit_id: unit.id,
        imported_by: auth.user!.id,
        raw_content: job.csv_content,
        parsed_data: parsedDataToSave as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        discount_data: discountDataToSave as unknown as Database['public']['Tables']['price_imports']['Insert']['discount_data'],
        canals: canais,
        is_active: true,
        valid_from: job.valid_from,
        valid_until: job.valid_until ?? null,
        import_type: jobImportType,
      })
      .select('id')
      .single()

    if (importError) throw new Error(importError.message)

    await admin
      .from('price_import_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), result_id: importRecord.id })
      .eq('id', jobId)

    const resumo = jobImportType === 'discounts'
      ? `${preview.discount_rows.length} descontos`
      : `${preview.rows.length} preços`

    await admin.from('notifications').insert({
      user_id: auth.user!.id,
      title: 'Planilha importada',
      body: `"${job.file_name}" foi confirmada e importada com sucesso (${resumo}).`,
      type: 'success',
    })

    return Response.json({ success: true })
  }

  // ── REJEITAR importação ───────────────────────────────────────────────────
  if (action === 'reject' && jobId) {
    await admin
      .from('price_import_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error_msg: 'Rejeitado pelo usuário' })
      .eq('id', jobId)
      .eq('unit_id', unit.id)

    return Response.json({ success: true })
  }

  // ── RETRY ─────────────────────────────────────────────────────────────────
  if (retryJobId) {
    await admin
      .from('price_import_jobs')
      .update({ status: 'pending', error_msg: null, started_at: null, finished_at: null })
      .eq('id', retryJobId)
      .eq('unit_id', unit.id)
  }

  // Bloqueia processamento se houver jobs aguardando confirmação
  const { count: reviewCount } = await (admin as any)
    .from('price_import_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', unit.id)
    .eq('status', 'needs_review')

  if (reviewCount && reviewCount > 0) {
    return Response.json({ done: true, message: 'Aguardando confirmação de importação' })
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

  // job.import_type may be undefined for legacy rows — default to 'prices'
  const jobImportType: 'prices' | 'discounts' = (job as any).import_type === 'discounts' ? 'discounts' : 'prices'

  try {
    // Prompt varia por tipo de importação
    const prompt = jobImportType === 'discounts'
      ? `Você receberá o conteúdo de uma planilha de política de descontos de motel exportada como CSV.

POLÍTICA DE DESCONTOS (Guia de Motéis)
Extraia UMA linha por combinação única de: categoria × período × dia_semana × faixa_horaria.

Campos de cada linha:
- canal: sempre "guia_moteis"
- categoria: nome exato da suíte (ex: "Lush POP", "Lush", "Lush Hidro")
- periodo: "3h" | "6h" | "12h" | "pernoite"
- dia_semana: "domingo" | "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "todos"
- faixa_horaria: ex "06:00-23:59", "00:00-17:59", "00:00-23:59"
- tipo_desconto: "percentual" | "absoluto"
- valor: número (ex: 10 para 10%)
- condicao: omitir se vazio

Regras:
- "3h, 6h e 12h" → gerar 3 linhas separadas por período
- Se valores DIFERENTES por período (ex: 30% no 3h e 15% no 6h e 12h) → gerar 3 linhas com valores corretos
- Incluir TODOS os dias que aparecem na planilha (domingo, segunda, terca, quarta, quinta, sexta, sabado)
- Se um dia aparece em dois horários (ex: 00:00-17:59 e 18:00-23:59) com O MESMO desconto → gerar UMA linha com faixa_horaria "00:00-23:59"
- Se um dia aparece em dois horários com descontos DIFERENTES → manter 2 linhas separadas
- Células vazias ou com "-" → ignorar

Retorne SOMENTE JSON minificado, sem texto antes ou depois:
{"rows":[],"canais_encontrados":["guia_moteis"],"discount_rows":[{"canal":"guia_moteis","categoria":"Lush POP","periodo":"3h","dia_semana":"segunda","faixa_horaria":"00:00-23:59","tipo_desconto":"percentual","valor":30},{"canal":"guia_moteis","categoria":"Lush POP","periodo":"6h","dia_semana":"segunda","faixa_horaria":"00:00-23:59","tipo_desconto":"percentual","valor":15}]}

CSV:
${job.csv_content.slice(0, 24000)}`
      : `Você receberá o conteúdo de uma planilha de tabela de preços de motel exportada como CSV.

Extraia as tarifas dos seguintes canais (ignore qualquer outro):
1. **balcao_site** — Tarifa Balcão (presencial) e Site imediato
2. **site_programada** — Reserva Antecipada pelo site
3. **guia_moteis** — Guia de Motéis (aplicativo/site externo)

Para cada tarifa: canal, categoria, periodo, dia_tipo ("semana"|"fds_feriado"|"todos"), preco (numérico)

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

    if (!parsed) {
      console.error('[import-queue] Resposta bruta do modelo (primeiros 1000 chars):', text.slice(0, 1000))
      throw new Error(`O modelo não retornou JSON válido. Preview: ${text.slice(0, 200)}`)
    }

    // Normalização
    parsed.rows = Array.isArray(parsed.rows) ? parsed.rows : []
    parsed.discount_rows = Array.isArray(parsed.discount_rows) ? parsed.discount_rows : []

    // Fallback: modelo às vezes coloca descontos em "rows" em vez de "discount_rows"
    if (jobImportType === 'discounts' && parsed.discount_rows.length === 0 && parsed.rows.length > 0) {
      console.log('[QUEUE PARSE] fallback: movendo rows → discount_rows para import de descontos')
      parsed.discount_rows = parsed.rows as unknown as ParsedDiscountRow[]
      parsed.rows = []
    }

    console.log('[QUEUE PARSE] import_type:', jobImportType, '| rows:', parsed.rows.length, '| discounts:', parsed.discount_rows.length)

    // Validação por tipo — não lança erro, vai para needs_review para usuário decidir
    if (jobImportType === 'prices' && parsed.rows.length === 0) {
      throw new Error('O modelo não retornou preços válidos.')
    }

    // Salva resultado da análise para revisão — NÃO salva em price_imports ainda
    const resumo = jobImportType === 'discounts'
      ? `${parsed.discount_rows.length} descontos`
      : `${parsed.rows.length} preços`

    await (admin as any)
      .from('price_import_jobs')
      .update({
        status: 'needs_review',
        parsed_preview: {
          rows: parsed.rows,
          discount_rows: parsed.discount_rows,
          canais_encontrados: parsed.canais_encontrados,
        },
      })
      .eq('id', job.id)

    await admin.from('notifications').insert({
      user_id: auth.user!.id,
      title: 'Planilha analisada — confirme a importação',
      body: `"${job.file_name}" foi analisada (${resumo}). Acesse Preços para confirmar.`,
      type: 'info',
    })

    return Response.json({
      done: false,
      jobId: job.id,
      fileName: job.file_name,
      status: 'needs_review',
      rowsParsed: parsed.rows.length + parsed.discount_rows.length,
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

// ─── DELETE: remove job do histórico ─────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const auth = await requireManager()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: job } = await admin
    .from('price_import_jobs')
    .select('id, unit_id, status')
    .eq('id', id)
    .single()

  if (!job) return new Response('Job não encontrado', { status: 404 })

  if (auth.profile!.role !== 'super_admin' && auth.profile!.unit_id !== job.unit_id) {
    return new Response('Sem acesso', { status: 403 })
  }

  if (job.status === 'processing') {
    return Response.json({ error: 'Não é possível excluir um job em processamento.' }, { status: 409 })
  }

  const { error } = await admin.from('price_import_jobs').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
