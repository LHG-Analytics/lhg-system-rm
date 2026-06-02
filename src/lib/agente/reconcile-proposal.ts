/**
 * Reconcilia uma proposta gerada pelo chat (formato livre dias[]+hora) contra a
 * ESTRUTURA da tabela de preços ativa, garantindo cobertura total:
 *   - todos os canais da tabela (ex: balcao_site E site_programada)
 *   - todos os dia_tipo (semana/fds_feriado/todos) e períodos
 *   - mantém o formato legado da tabela → a grade preenche AMBAS as faixas (06–18 / 18–06)
 *     com o mesmo preço quando a tabela não distingue horário.
 *
 * O LLM frequentemente cobre só alguns canais/dias; aqui aplicamos as alterações dele
 * sobre o esqueleto completo da tabela, mantendo o preço atual onde ele não mexeu.
 */
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'

export interface ReconcileLlmRow {
  canal: string
  categoria: string
  periodo: string
  dias?: string[]
  dia_tipo?: string
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
}

export interface ReconciledRow {
  canal: string
  categoria: string
  periodo: string
  dia_tipo: string
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
}

const SEMANA_SET = new Set(['domingo', 'segunda', 'terca', 'quarta', 'quinta'])
const FDS_SET    = new Set(['sexta', 'sabado'])

function norm(s: string) {
  return (s ?? '').trim().toLowerCase()
}

/** Quais dia_tipo da tabela legada esta linha do LLM afeta. */
function tiposAfetados(row: ReconcileLlmRow): string[] {
  const dias = (row.dias ?? []).map(norm)
  if (!dias.length || dias.includes('todos')) return ['semana', 'fds_feriado']
  const tipos = new Set<string>()
  for (const d of dias) {
    if (SEMANA_SET.has(d)) tipos.add('semana')
    if (FDS_SET.has(d))    tipos.add('fds_feriado')
  }
  return tipos.size ? [...tipos] : ['semana', 'fds_feriado']
}

/** A tabela ativa é "legada" (estrutura por dia_tipo, sem dias[]/faixa)? */
export function isLegacyTable(activeRows: ParsedPriceRow[]): boolean {
  return activeRows.length > 0 &&
    activeRows.every((r) => !!r.dia_tipo && !((r as { dias?: string[] }).dias?.length))
}

/**
 * Retorna a proposta com cobertura total no formato da tabela ativa, ou `null` se a tabela
 * não for legada (nesse caso o chamador mantém as linhas do LLM como estão).
 */
export function reconcileProposalToActiveTable(
  llmRows: ReconcileLlmRow[],
  activeRows: ParsedPriceRow[],
): ReconciledRow[] | null {
  if (!isLegacyTable(activeRows)) return null

  // Mapa de alterações propostas pelo LLM: canal|categoria|periodo|dia_tipo → preço/justificativa
  const changeMap = new Map<string, { preco_proposto: number; justificativa: string }>()
  for (const row of llmRows) {
    for (const tipo of tiposAfetados(row)) {
      const key = `${norm(row.canal)}|${norm(row.categoria)}|${norm(row.periodo)}|${tipo}`
      // Só registra se houve alteração real (evita sobrescrever um ajuste com uma manutenção)
      const isChange = Math.abs(row.preco_proposto - row.preco_atual) > 0.001
      if (isChange || !changeMap.has(key)) {
        changeMap.set(key, { preco_proposto: row.preco_proposto, justificativa: row.justificativa })
      }
    }
  }

  // Cobertura total: uma linha por entrada da tabela ativa
  return activeRows.map((src) => {
    const precoAtual = Number(src.preco) || 0
    const key   = `${norm(src.canal)}|${norm(src.categoria)}|${norm(src.periodo)}|${norm(src.dia_tipo)}`
    const keyAll = `${norm(src.canal)}|${norm(src.categoria)}|${norm(src.periodo)}|todos`
    const change = changeMap.get(key) ?? changeMap.get(keyAll)
    const precoProposto = change ? change.preco_proposto : precoAtual
    const variacao = precoAtual > 0 ? +((precoProposto - precoAtual) / precoAtual * 100).toFixed(1) : 0
    return {
      canal:          src.canal,
      categoria:      src.categoria,
      periodo:        src.periodo,
      dia_tipo:       src.dia_tipo,
      preco_atual:    precoAtual,
      preco_proposto: precoProposto,
      variacao_pct:   variacao,
      justificativa:  change?.justificativa ?? 'Mantido — fora do escopo do ajuste',
    }
  })
}
