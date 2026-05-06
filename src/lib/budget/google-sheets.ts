import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { UnitGoals } from '@/app/api/admin/agent-config/route'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ServiceAccountCredentials {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
}

export interface BudgetMonthData {
  receita: number | null
  ticket:  number | null
  giro:    number | null
  revpar:  number | null
}

// budget_yearly salvo no banco: { "2026": { "1": {...}, ..., "12": {...} } }
export type BudgetYearly = Record<string, Record<string, BudgetMonthData>>

export interface BudgetSyncResult {
  receita_locacoes:  number | null  // receita só de locações (referência)
  receita_prod_serv: number | null  // receita de produtos e serviços
  receita_total:     number | null  // total = locações + prod/serv
  ticket:            number | null  // ticket total = receita_total / giro
  giro:              number | null
  revpar:            number | null
  month:             number
  year:              number
  months_synced:     number
  synced_at:         string
}

// ─── Estrutura das abas de orçamento ─────────────────────────────────────────
// Colunas C–N = jan–dez (índice 3–14, ou seja índice = 2 + mês)
//
// Aba Locações-Comp:
//   Linha 18 = "Resultado Projetado" → receita de locações
//   Linha 32 = "Ticket Médio"        → ticket médio de locações (NÃO usado — calculado abaixo)
//   Linha 60 = "Giro"                → giro (nº de locações)
//   Linha 74 = "RevPar Médio"        → revpar
//
// Aba Produtos e Serviços-Com:
//   Linha 34 = "TOTAL"              → receita de produtos + serviços
//
// Ticket médio final = (receita_locações + receita_prod_serv) / giro

const COL_FIRST_MONTH = 3   // C = janeiro
const ROWS = { receita: 18, giro: 60, revpar: 74 } as const

const PROD_SERV_TAB = 'Produtos e Serviços-Com'
const PROD_SERV_ROW = 34

// ─── Auth: JWT RS256 para service account ─────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64url(Buffer.from(JSON.stringify({
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  })))

  const signingInput = `${header}.${payload}`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(creds.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const jwt = `${signingInput}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const data = await res.json() as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(`Google auth error: ${data.error ?? JSON.stringify(data)}`)
  return data.access_token
}

// ─── Helpers de coluna ────────────────────────────────────────────────────────

function colLetter(n: number): string {
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

// Retorna letra da coluna do mês M (1-indexed): jan→C, fev→D, ... dez→N
function monthCol(month: number): string {
  return colLetter(COL_FIRST_MONTH - 1 + month)
}

// ─── Extrai spreadsheet ID da URL ─────────────────────────────────────────────

export function extractSpreadsheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : urlOrId
}

// ─── batchGet: busca 3 linhas (receita, giro, revpar) de Locações-Comp ────────

async function fetchYearlyRows(
  token: string,
  spreadsheetId: string,
  tab: string,
): Promise<{ receita: (number | null)[]; giro: (number | null)[]; revpar: (number | null)[] }> {
  const colStart = colLetter(COL_FIRST_MONTH)       // C
  const colEnd   = colLetter(COL_FIRST_MONTH + 11)  // N

  const ranges = Object.values(ROWS).map(
    (row) => `${tab}!${colStart}${row}:${colEnd}${row}`
  )
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sheets API batchGet ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    valueRanges: { values?: (string | number)[][] }[]
  }

  function parseRow(idx: number): (number | null)[] {
    const cells = data.valueRanges[idx]?.values?.[0] ?? []
    return Array.from({ length: 12 }, (_, i) => {
      const raw = cells[i]
      if (raw == null || raw === '') return null
      const n = Number(raw)
      return isFinite(n) && n > 0 ? n : null
    })
  }

  return {
    receita: parseRow(0),
    giro:    parseRow(1),
    revpar:  parseRow(2),
  }
}

// ─── GET linha TOTAL da aba Produtos e Serviços-Com ───────────────────────────

async function fetchProdServRow(
  token: string,
  spreadsheetId: string,
): Promise<(number | null)[] | null> {
  const colStart = colLetter(COL_FIRST_MONTH)
  const colEnd   = colLetter(COL_FIRST_MONTH + 11)
  const range    = `${PROD_SERV_TAB}!${colStart}${PROD_SERV_ROW}:${colEnd}${PROD_SERV_ROW}`
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null  // aba inexistente ou sem acesso — não quebra o sync

  const data = await res.json() as { values?: (string | number)[][] }
  const cells = data.values?.[0] ?? []
  return Array.from({ length: 12 }, (_, i) => {
    const raw = cells[i]
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return isFinite(n) && n > 0 ? n : null
  })
}

// ─── Sync principal ───────────────────────────────────────────────────────────

export async function syncBudgetForUnit(unitId: string): Promise<BudgetSyncResult> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado')

  const creds = JSON.parse(json) as ServiceAccountCredentials

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: config } = await admin
    .from('rm_agent_config')
    .select('unit_goals, budget_sheet_url, budget_sheet_tab, budget_yearly')
    .eq('unit_id', unitId)
    .single()

  if (!config?.budget_sheet_url) throw new Error('URL da planilha não configurada para esta unidade')

  const spreadsheetId = extractSpreadsheetId(config.budget_sheet_url)
  const tab = config.budget_sheet_tab ?? 'Locações-Comp'

  const now   = new Date()
  const month = now.getMonth() + 1  // 1-indexed
  const year  = now.getFullYear()

  const token = await getAccessToken(creds)

  // Busca aba de locações e aba de produtos em paralelo — falha de prod/serv não bloqueia
  const [rows, prodServRow] = await Promise.all([
    fetchYearlyRows(token, spreadsheetId, tab),
    fetchProdServRow(token, spreadsheetId).catch(() => null),
  ])

  // Valida mês atual obrigatório (locações)
  const receitaLocacaoAtual = rows.receita[month - 1]
  if (receitaLocacaoAtual == null || receitaLocacaoAtual === 0) {
    throw new Error(
      `Orçamento não encontrado em ${tab}!${monthCol(month)}${ROWS.receita} (mês ${month}). ` +
      `Verifique se a aba está correta e o valor preenchido.`
    )
  }

  // Monta budget_yearly com todos os meses que têm receita de locações
  const yearStr = String(year)
  const existing = (config.budget_yearly ?? {}) as unknown as BudgetYearly
  const yearData: Record<string, BudgetMonthData> = {}
  let monthsSynced = 0

  for (let m = 1; m <= 12; m++) {
    const receitaLoc = rows.receita[m - 1]
    if (receitaLoc == null) continue

    const prodServ     = prodServRow?.[m - 1] ?? 0
    const receitaTotal = receitaLoc + prodServ
    const giro         = rows.giro[m - 1]
    const revpar       = rows.revpar[m - 1]
    // ticket total = receita total (locações + produtos/serviços) / nº de locações
    const ticket = giro != null && giro > 0 ? receitaTotal / giro : null

    yearData[String(m)] = {
      receita: Math.round(receitaTotal),
      ticket:  ticket != null ? Math.round(ticket * 100) / 100 : null,
      giro:    giro   != null ? Math.round(giro   * 100) / 100 : null,
      revpar:  revpar != null ? Math.round(revpar  * 100) / 100 : null,
    }
    monthsSynced++
  }
  const updatedYearly: BudgetYearly = { ...existing, [yearStr]: yearData }

  // Mês atual para unit_goals
  const prodServAtual    = prodServRow?.[month - 1] ?? 0
  const receitaTotalAtual = receitaLocacaoAtual + prodServAtual
  const giroAtual        = rows.giro[month - 1]
  const revparAtual      = rows.revpar[month - 1]
  const ticketAtual      = giroAtual != null && giroAtual > 0
    ? receitaTotalAtual / giroAtual
    : null

  // Atualiza unit_goals com o mês atual (mantém trevpar/ocupacao que não vêm da planilha)
  const existingGoals = (config.unit_goals ?? {}) as UnitGoals
  const updatedGoals: UnitGoals = {
    ...existingGoals,
    receita_mensal: Math.round(receitaTotalAtual),
    ...(ticketAtual != null ? { ticket: Math.round(ticketAtual * 100) / 100 } : {}),
    ...(giroAtual   != null ? { giro:   Math.round(giroAtual   * 100) / 100 } : {}),
    ...(revparAtual != null ? { revpar: Math.round(revparAtual  * 100) / 100 } : {}),
  }

  const syncedAt = new Date().toISOString()
  await admin
    .from('rm_agent_config')
    .update({
      unit_goals:       updatedGoals as unknown as Database['public']['Tables']['rm_agent_config']['Update']['unit_goals'],
      budget_yearly:    updatedYearly as unknown as Database['public']['Tables']['rm_agent_config']['Update']['budget_yearly'],
      budget_last_sync: syncedAt,
    })
    .eq('unit_id', unitId)

  return {
    receita_locacoes:  Math.round(receitaLocacaoAtual),
    receita_prod_serv: prodServAtual > 0 ? Math.round(prodServAtual) : null,
    receita_total:     Math.round(receitaTotalAtual),
    ticket:            ticketAtual != null ? Math.round(ticketAtual * 100) / 100 : null,
    giro:              giroAtual   != null ? Math.round(giroAtual   * 100) / 100 : null,
    revpar:            revparAtual != null ? Math.round(revparAtual  * 100) / 100 : null,
    month,
    year,
    months_synced: monthsSynced,
    synced_at: syncedAt,
  }
}
