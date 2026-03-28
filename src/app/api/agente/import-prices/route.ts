import { generateText } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
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

export interface ParseResponse {
  rows: ParsedPriceRow[]
  canais_encontrados: string[]
  observacoes?: string
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
  }

  const { action, csvContent, unitSlug, parsedData } = body

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

Extraia APENAS as tarifas dos seguintes canais de venda (ignore qualquer outro):
1. **balcao_site** — Tarifa Balcão (presencial) e Site imediato (mesmo preço)
2. **site_programada** — Reserva Antecipada pelo site (preço pode ser diferente)
3. **guia_moteis** — Guia de Motéis (aplicativo/site externo)

Para cada linha de preço encontrada, retorne um objeto JSON com:
- canal: "balcao_site" | "site_programada" | "guia_moteis"
- categoria: nome da suíte/categoria (ex: "Standard", "Master", "Luxo")
- periodo: período de locação (ex: "3h", "6h", "12h", "Pernoite", "Diária", "Day Use")
- dia_tipo: "semana" (dias úteis/semana), "fds_feriado" (finais de semana e feriados), ou "todos" (se não houver distinção)
- preco: valor numérico em reais (apenas o número, sem R$)

Retorne SOMENTE JSON minificado (sem espaços ou quebras de linha desnecessárias) no formato:
{"rows":[...],"canais_encontrados":["balcao_site"],"observacoes":"opcional"}

Regras:
- JSON minificado — sem indentação, sem espaços extras
- Sem texto antes ou depois do JSON
- Se não encontrar nenhum canal, retorne {"rows":[],"canais_encontrados":[]}

CSV:
${csvContent.slice(0, 8000)}`

    const { text } = await generateText({
      model: PRIMARY_MODEL,
      providerOptions: gatewayOptions,
      prompt,
      maxOutputTokens: 8000,
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

    // Salvar no Supabase (o trigger desativa imports anteriores automaticamente)
    const { data: importRecord, error } = await supabase
      .from('price_imports')
      .insert({
        unit_id: unit.id,
        imported_by: user.id,
        raw_content: csvContent,
        parsed_data: parsedData as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        canals: canais,
        is_active: true,
      })
      .select('id, imported_at')
      .single()

    if (error) {
      console.error('Erro ao salvar price_import:', error)
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, id: importRecord.id, imported_at: importRecord.imported_at })
  }

  return new Response('action inválido', { status: 400 })
}
