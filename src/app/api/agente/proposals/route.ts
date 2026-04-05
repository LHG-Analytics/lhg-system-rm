import { generateText } from 'ai'
import { PRIMARY_MODEL, gatewayOptions } from '@/lib/agente/model'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { trailingYear } from '@/lib/kpis/period'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { buildSystemPrompt, type PriceImportForPrompt } from '@/lib/agente/system-prompt'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProposedPriceRow extends ParsedPriceRow {
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
}

export interface ProposalResponse {
  context: string
  rows: ProposedPriceRow[]
}

export interface PriceProposal {
  id: string
  unit_id: string
  created_by: string
  context: string | null
  rows: ProposedPriceRow[]
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function extractProposalJSON(text: string): ProposalResponse | null {
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
    return JSON.parse(candidate.slice(start, end + 1)) as ProposalResponse
  } catch {
    return null
  }
}

// ─── GET: lista propostas da unidade ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data: proposals, error } = await supabase
    .from('price_proposals')
    .select('*')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(proposals as unknown as PriceProposal[])
}

// ─── POST: gera nova proposta via IA ─────────────────────────────────────────

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

  const body = await req.json() as { unitSlug: string }
  const { unitSlug } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin
    .from('units')
    .select('id, name, slug')
    .eq('slug', unitSlug)
    .eq('is_active', true)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (profile.role !== 'super_admin' && profile.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  // Buscar KPIs + tabela de preços ativa em paralelo
  const kpiParams = trailingYear()

  const [companyResult, priceImportsResult] = await Promise.allSettled([
    fetchCompanyKPIsFromAutomo(unit.slug, kpiParams.startDate, kpiParams.endDate),
    admin.from('price_imports').select('parsed_data, valid_from, valid_until').eq('unit_id', unit.id).order('valid_from', { ascending: false }),
  ])

  const company = companyResult.status === 'fulfilled' ? companyResult.value : null
  const bookings = null
  const priceImports: PriceImportForPrompt[] =
    priceImportsResult.status === 'fulfilled' && priceImportsResult.value.data
      ? priceImportsResult.value.data.map((imp) => ({
          rows: imp.parsed_data ? (imp.parsed_data as unknown as ParsedPriceRow[]) : [],
          valid_from: imp.valid_from,
          valid_until: imp.valid_until,
        }))
      : []

  if (!priceImports.some((i) => i.rows.length > 0)) {
    return Response.json(
      { error: 'Nenhuma tabela de preços importada. Importe uma tabela de preços antes de gerar propostas.' },
      { status: 422 }
    )
  }

  // Montar contexto resumido para geração de proposta
  const kpiContext = buildSystemPrompt(unit.name, { period: kpiParams, company, bookings }, priceImports)

  const prompt = `${kpiContext}

---

TAREFA: Gere uma proposta de ajuste de preços baseada nos dados acima.

Aplique o framework de Revenue Management:
- Analise giro, ocupação e ticket por categoria
- Proponha apenas ajustes justificados pelos dados
- Variação máxima: ±30% por item
- Priorize ajustes com maior impacto no RevPAR

Retorne SOMENTE JSON minificado (sem texto antes ou depois) no formato:
{"context":"análise resumida em 2-3 frases explicando a lógica geral da proposta","rows":[{"canal":"balcao_site|site_programada|guia_moteis","categoria":"nome","periodo":"3h|6h|12h|Pernoite","dia_tipo":"semana|fds_feriado|todos","preco_atual":0.00,"preco_proposto":0.00,"variacao_pct":0.0,"justificativa":"razão objetiva em 1 frase"}]}

Regras do JSON:
- variacao_pct = ((preco_proposto - preco_atual) / preco_atual * 100) arredondado para 1 decimal
- Se não há dados suficientes para justificar ajuste em um item, omita-o
- JSON minificado, sem indentação`

  const { text } = await generateText({
    model: PRIMARY_MODEL,
    providerOptions: gatewayOptions,
    prompt,
    maxOutputTokens: 4000,
    temperature: 0.2,
  })

  const parsed = extractProposalJSON(text)
  if (!parsed || !Array.isArray(parsed.rows)) {
    console.error('[proposals] Resposta não parseável:', text.slice(0, 500))
    return Response.json(
      { error: 'O modelo não retornou JSON válido. Tente novamente.', preview: text.slice(0, 300) },
      { status: 422 }
    )
  }

  // Salvar no banco como proposta pendente
  const { data: saved, error } = await supabase
    .from('price_proposals')
    .insert({
      unit_id: unit.id,
      created_by: user.id,
      context: parsed.context ?? null,
      rows: parsed.rows as unknown as Database['public']['Tables']['price_proposals']['Insert']['rows'],
      status: 'pending',
    })
    .select('*')
    .single()

  if (error) {
    console.error('[proposals] Erro ao salvar:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(saved as unknown as PriceProposal)
}

// ─── PATCH: aprovar ou rejeitar proposta ──────────────────────────────────────

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

  const body = await req.json() as { id: string; status: 'approved' | 'rejected' }
  const { id, status } = body

  if (!id || !['approved', 'rejected'].includes(status)) {
    return new Response('id e status obrigatórios', { status: 400 })
  }

  // Busca a proposta completa para poder criar o price_import ao aprovar
  const { data: proposal, error: fetchErr } = await supabase
    .from('price_proposals')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !proposal) return Response.json({ error: 'Proposta não encontrada' }, { status: 404 })

  const { data: updated, error } = await supabase
    .from('price_proposals')
    .update({
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Ao aprovar: clona a tabela ativa, aplica os preços propostos e insere como nova versão
  if (status === 'approved') {
    const proposedRows = (proposal.rows as unknown as ProposedPriceRow[]) ?? []
    const today = new Date().toISOString().slice(0, 10)
    const admin = getAdminClient()

    // Chave de identificação única de um item de preço
    const rowKey = (r: ParsedPriceRow) => `${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`

    // Mapa dos preços propostos: chave → preco_proposto
    const proposedMap = new Map<string, number>()
    for (const r of proposedRows) {
      proposedMap.set(rowKey(r), r.preco_proposto)
    }

    // 1. Busca o snapshot ativo atual (base para o clone)
    const { data: activeImport } = await admin
      .from('price_imports')
      .select('id, parsed_data, canals')
      .eq('unit_id', proposal.unit_id)
      .is('valid_until', null)
      .lte('valid_from', today)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    // 2. Monta o novo snapshot: clone da base + upsert dos preços propostos
    const baseRows: ParsedPriceRow[] = activeImport
      ? (activeImport.parsed_data as unknown as ParsedPriceRow[]) ?? []
      : []

    // Clona cada linha da base; substitui o preço se havia proposta para aquela chave
    const remainingProposed = new Map(proposedMap)
    const newRows: ParsedPriceRow[] = baseRows.map((r) => {
      const key = rowKey(r)
      const newPrice = remainingProposed.get(key)
      if (newPrice !== undefined) {
        remainingProposed.delete(key) // marcado como aplicado
        return { ...r, preco: newPrice }
      }
      return { ...r }
    })

    // Linhas da proposta sem correspondência na base (itens novos): adiciona ao final
    for (const [key, preco] of remainingProposed) {
      const src = proposedRows.find((r) => rowKey(r) === key)
      if (src) {
        newRows.push({ canal: src.canal, categoria: src.categoria, periodo: src.periodo, dia_tipo: src.dia_tipo, preco })
      }
    }

    const newCanais = [...new Set(newRows.map((r) => r.canal))]

    // 3. Encerra a vigência do registro ativo anterior (valid_until = ontem)
    if (activeImport) {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await admin
        .from('price_imports')
        .update({ valid_until: yesterday.toISOString().slice(0, 10) })
        .eq('id', activeImport.id)
    }

    // 4. Insere o novo snapshot como tabela ativa (valid_from = hoje, valid_until = null)
    await admin
      .from('price_imports')
      .insert({
        unit_id:     proposal.unit_id,
        imported_by: user.id,
        raw_content: `[Agente RM — proposta ${id} aprovada em ${today}]`,
        parsed_data: newRows as unknown as Database['public']['Tables']['price_imports']['Insert']['parsed_data'],
        canals:      newCanais,
        is_active:   true,
        valid_from:  today,
        valid_until: null,
      })
  }

  return Response.json(updated as unknown as PriceProposal)
}
