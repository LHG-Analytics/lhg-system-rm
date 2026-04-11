import { generateText } from 'ai'
import { ANALYSIS_MODEL, analysisOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// Estrutura de cada linha da tabela de preços parseada
export interface ParsedPriceRow {
  canal: 'balcao_site' | 'site_programada' | 'guia_moteis'
  categoria: string
  periodo: string
  dia_tipo: 'semana' | 'fds_feriado' | 'todos'
  preco: number
}

// Política de descontos do Guia de Motéis
export interface ParsedDiscountRow {
  canal: 'guia_moteis'
  categoria: string        // nome da categoria ou "todas"
  periodo: string          // ex: "3h", "6h", "todas"
  dia_tipo: 'semana' | 'fds_feriado' | 'todos'
  tipo_desconto: 'percentual' | 'absoluto'
  valor: number            // ex: 10 para 10% ou 20.00 para R$20
  condicao?: string        // ex: "antecedência 24h", "via app"
  observacao?: string
}

export interface ParseResponse {
  rows: ParsedPriceRow[]
  canais_encontrados: string[]
  observacoes?: string
  discount_rows?: ParsedDiscountRow[]
}

// Extrai JSON da resposta do modelo de forma robusta:
// 1. Tenta extrair de bloco ```json ... ```
// 2. Tenta extrair de bloco ``` ... ```
// 3. Usa busca balanceada de chaves para encontrar o objeto JSON raiz
function extractJSON(text: string): ParseResponse | null {
  // Remover BOM e espaços extras
  const clean = text.trim()

  // Tenta code block ```json ... ``` ou ``` ... ```
  const codeBlock = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = codeBlock ? codeBlock[1] : clean

  // Busca balanceada: localiza o primeiro { e acha o } correspondente
  const start = candidate.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let end = -1
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++
    else if (candidate[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }

  if (end === -1) return null

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ParseResponse
  } catch {
    return null
  }
}

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// PATCH /api/agente/import-prices
// Body: { id: string; validFrom?: string; validUntil?: string | null; isActive?: boolean }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as {
    id: string
    validFrom?: string
    validUntil?: string | null
    isActive?: boolean
  }

  if (!body.id) return new Response('id obrigatório', { status: 400 })

  const admin = getAdminClient()

  // Verificar que o import pertence a uma unidade que o usuário pode acessar
  const { data: existing } = await admin
    .from('price_imports')
    .select('id, unit_id')
    .eq('id', body.id)
    .single()

  if (!existing) return new Response('Import não encontrado', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== existing.unit_id) {
    return new Response('Sem acesso', { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (body.validFrom  !== undefined) update.valid_from  = body.validFrom
  if (body.validUntil !== undefined) update.valid_until = body.validUntil
  if (body.isActive   !== undefined) update.is_active   = body.isActive

  const { error } = await admin
    .from('price_imports')
    .update(update)
    .eq('id', body.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

// DELETE /api/agente/import-prices?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const admin = getAdminClient()

  const { data: existing } = await admin
    .from('price_imports')
    .select('id, unit_id')
    .eq('id', id)
    .single()

  if (!existing) return new Response('Import não encontrado', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== existing.unit_id) {
    return new Response('Sem acesso', { status: 403 })
  }

  const { error } = await admin
    .from('price_imports')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

// GET /api/agente/import-prices?unitSlug=xxx
// Lista todos os imports de uma unidade, do mais recente ao mais antigo
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return new Response('Perfil não encontrado', { status: 403 })
  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const { data: imports, error } = await supabase
    .from('price_imports')
    .select('id, imported_at, canals, is_active, valid_from, valid_until, parsed_data')
    .eq('unit_id', unit.id)
    .order('valid_from', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(imports ?? [])
}

// POST /api/agente/import-prices
// Body: { csvContent: string; unitSlug: string; action: 'parse' | 'confirm'; parsedData?: ParsedPriceRow[] }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    return new Response('Permissão negada', { status: 403 })
  }

  const body = await req.json() as {
    action: 'parse' | 'confirm'
    csvContent?: string
    unitSlug: string
    parsedData?: ParsedPriceRow[]
    discountData?: ParsedDiscountRow[]
    validFrom?: string
    validUntil?: string | null
  }

  const { action, csvContent, unitSlug, parsedData, discountData, validFrom, validUntil } = body

  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  // Verificar acesso à unidade
  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  // ── PARSE: Claude extrai a tabela do CSV ───────────────────────────────────
  if (action === 'parse') {
    if (!csvContent) return new Response('csvContent obrigatório', { status: 400 })

    const prompt = `Você receberá o conteúdo de uma planilha de tabela de preços de motel exportada como CSV.

PARTE 1 — TARIFAS
Extraia as tarifas dos seguintes canais (ignore qualquer outro):
1. **balcao_site** — Tarifa Balcão (presencial) e Site imediato (mesmo preço)
2. **site_programada** — Reserva Antecipada pelo site
3. **guia_moteis** — Guia de Motéis (aplicativo/site externo)

Para cada tarifa, extraia:
- canal: "balcao_site" | "site_programada" | "guia_moteis"
- categoria: nome da suíte (ex: "Standard", "Master", "Luxo")
- periodo: período de locação (ex: "3h", "6h", "12h", "Pernoite")
- dia_tipo: "semana" | "fds_feriado" | "todos"
- preco: valor numérico em reais (sem R$)

PARTE 2 — POLÍTICA DE DESCONTOS (Guia de Motéis)
Se houver seção de descontos, promoções ou condições especiais para o Guia de Motéis, extraia cada regra:
- canal: sempre "guia_moteis"
- categoria: nome da categoria ou "todas"
- periodo: período específico ou "todas"
- dia_tipo: "semana" | "fds_feriado" | "todos"
- tipo_desconto: "percentual" (ex: 10%) ou "absoluto" (ex: R$20)
- valor: número (ex: 10 para 10% ou 20.00 para R$20 de desconto)
- condicao: condição para aplicar (ex: "antecedência 24h", "via app") — omitir se não houver
- observacao: informação adicional — omitir se não houver

Retorne SOMENTE JSON minificado no formato:
{"rows":[...],"canais_encontrados":["balcao_site"],"observacoes":"opcional","discount_rows":[]}

Regras:
- JSON minificado — sem indentação, sem espaços extras
- Sem texto antes ou depois do JSON
- discount_rows pode ser [] se não houver descontos configurados
- Se não encontrar nenhum canal, retorne {"rows":[],"canais_encontrados":[],"discount_rows":[]}

CSV:
${csvContent.slice(0, 24000)}`

    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      providerOptions: analysisOptions,
      prompt,
      maxOutputTokens: 16000,
      temperature: 0,
    })

    // Extrair JSON robusto: tenta code block primeiro, depois busca balanceada
    const parsed = extractJSON(text)
    if (!parsed) {
      console.error('[import-prices] Resposta do modelo não parseável:', text.slice(0, 500))
      return Response.json(
        { error: 'O modelo não retornou JSON válido. Tente novamente.', preview: text.slice(0, 300) },
        { status: 422 }
      )
    }

    return Response.json(parsed)
  }

  // ── CONFIRM: Salva no banco após aprovação do usuário ─────────────────────
  if (action === 'confirm') {
    if (!parsedData || !Array.isArray(parsedData) || parsedData.length === 0) {
      return new Response('parsedData obrigatório', { status: 400 })
    }
    if (!csvContent) return new Response('csvContent obrigatório', { status: 400 })

    const canais = [...new Set(parsedData.map((r) => r.canal))]
    const today = new Date().toISOString().slice(0, 10)

    // Salvar no Supabase
    const { data: importRecord, error } = await supabase
      .from('price_imports')
      .insert({
        unit_id: unit.id,
        imported_by: user.id,
        raw_content: csvContent,
        parsed_data: parsedData as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        discount_data: (discountData && discountData.length > 0)
          ? discountData as unknown as Database['public']['Tables']['price_imports']['Insert']['discount_data']
          : null,
        canals: canais,
        is_active: true,
        valid_from: validFrom ?? today,
        valid_until: validUntil ?? null,
      })
      .select('id, imported_at, valid_from, valid_until')
      .single()

    if (error) {
      console.error('Erro ao salvar price_import:', error)
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, id: importRecord.id, imported_at: importRecord.imported_at, valid_from: importRecord.valid_from, valid_until: importRecord.valid_until })
  }

  return new Response('action inválido', { status: 400 })
}
