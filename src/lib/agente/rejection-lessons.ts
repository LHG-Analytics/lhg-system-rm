import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Bloco de "Lições de rejeições recentes" injetado no system prompt.
 * Lê últimas N propostas rejeitadas (últimos 90 dias) com motivo estruturado
 * e expõe ao agente para que ele evite repetir os mesmos tipos de erro.
 *
 * Sem isso, o agente trata cada conversa como tabula rasa e propõe novamente
 * mudanças que o gerente já rejeitou no passado próximo — frustrante e caro.
 */

const REASON_LABEL_PRICE: Record<string, string> = {
  precos_muito_altos:           'Preços muito altos',
  precos_muito_baixos:          'Preços muito baixos',
  estrategia_inadequada:        'Estratégia inadequada',
  item_especifico_errado:       'Item(ns) específico(s) errado(s)',
  momento_inadequado:           'Momento inadequado',
  concorrencia_nao_considerada: 'Concorrência não considerada',
  margem_insuficiente:          'Margem insuficiente',
  outro:                        'Outro',
}

const REASON_LABEL_DISCOUNT: Record<string, string> = {
  desconto_alto_demais:  'Desconto alto demais',
  desconto_baixo_demais: 'Desconto baixo demais',
  condicao_inadequada:   'Condição inadequada',
  momento_inadequado:    'Momento inadequado',
  outro:                 'Outro',
}

interface RejectionRecord {
  reviewed_at: string | null
  rejection_reason_type: string | null
  rejection_reason_text: string | null
  rejected_items: unknown
  kind: 'price' | 'discount'
}

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function buildRejectionLessonsBlock(unitId: string): Promise<string> {
  const admin = getAdminClient()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: priceRej }, { data: discRej }] = await Promise.all([
    admin
      .from('price_proposals')
      .select('reviewed_at, rejection_reason_type, rejection_reason_text, rejected_items')
      .eq('unit_id', unitId)
      .eq('status', 'rejected')
      .not('rejection_reason_type', 'is', null)
      .gte('reviewed_at', ninetyDaysAgo)
      .order('reviewed_at', { ascending: false })
      .limit(5),
    admin
      .from('discount_proposals')
      .select('reviewed_at, rejection_reason_type, rejection_reason_text, rejected_items')
      .eq('unit_id', unitId)
      .eq('status', 'rejected')
      .not('rejection_reason_type', 'is', null)
      .gte('reviewed_at', ninetyDaysAgo)
      .order('reviewed_at', { ascending: false })
      .limit(3),
  ])

  const records: RejectionRecord[] = [
    ...(priceRej ?? []).map((r) => ({ ...r, kind: 'price' as const })),
    ...(discRej ?? []).map((r) => ({ ...r, kind: 'discount' as const })),
  ].sort((a, b) => (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? ''))

  if (!records.length) return ''

  const lines = records.slice(0, 6).map((r) => {
    const date = r.reviewed_at
      ? new Date(r.reviewed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '?'
    const labels = r.kind === 'price' ? REASON_LABEL_PRICE : REASON_LABEL_DISCOUNT
    const reason = r.rejection_reason_type ? labels[r.rejection_reason_type] ?? r.rejection_reason_type : '?'
    const kindLabel = r.kind === 'price' ? 'Preço' : 'Desconto'
    const detail = r.rejection_reason_text ? `\n  Detalhes: "${r.rejection_reason_text}"` : ''
    let itemsBlock = ''
    if (Array.isArray(r.rejected_items) && r.rejected_items.length) {
      const items = (r.rejected_items as Array<Record<string, unknown>>).slice(0, 5)
        .map((i) => `${i.categoria ?? ''} ${i.periodo ?? ''} ${i.dia_tipo ?? i.dia_semana ?? ''}: ${i.motivo ?? ''}`.trim())
        .filter(Boolean)
        .join('; ')
      if (items) itemsBlock = `\n  Itens problemáticos: ${items}`
    }
    return `- ${date} — ${kindLabel} rejeitado: **${reason}**${detail}${itemsBlock}`
  }).join('\n')

  return `## Lições de rejeições recentes (evite repetir)

${lines}

> Use estas lições para calibrar a nova proposta — não repita o mesmo padrão pelo qual o gerente já rejeitou recentemente.`
}
