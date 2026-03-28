import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
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

Retorne SOMENTE um JSON válido no formato:
{
  "rows": [...],
  "canais_encontrados": ["balcao_site", "guia_moteis"],
  "observacoes": "texto opcional com observações relevantes sobre a planilha"
}

Se não encontrar nenhum dos canais listados, retorne rows vazio.
Não inclua texto fora do JSON.

CSV:
${csvContent.slice(0, 8000)}`

    const { text } = await generateText({
      model: anthropic('claude-sonnet-4.6'),
      prompt,
      maxOutputTokens: 2000,
      temperature: 0,
    })

    // Extrair JSON da resposta (pode vir com markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return Response.json({ error: 'Claude não retornou JSON válido', raw: text }, { status: 422 })
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as ParseResponse
      return Response.json(parsed)
    } catch {
      return Response.json({ error: 'Falha ao parsear resposta do Claude', raw: text }, { status: 422 })
    }
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
