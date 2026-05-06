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

// Configuração dinâmica das abas e linhas da planilha de orçamento
export interface BudgetConfig {
  // Aba de locações
  locacoes_tab:          string  // ex: 'Locações-Comp'
  locacoes_receita_row:  number  // linha do resultado projetado de locações
  locacoes_total_row:    number  // linha do total de locações (nº absoluto de locações no mês)
  locacoes_giro_row:     number  // linha do giro (taxa diária — locações/suíte/dia)
  locacoes_revpar_row:   number  // linha do RevPAR médio
  // Aba de produtos e serviços
  prod_serv_tab:           string  // ex: 'Produtos e Serviços-Com'
  prod_serv_produtos_row:  number  // linha do resultado de produtos
  prod_serv_servicos_row:  number  // linha do resultado de serviços
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  locacoes_tab:            'Locações-Comp',
  locacoes_receita_row:    18,
  locacoes_total_row:      37,
  locacoes_giro_row:       60,
  locacoes_revpar_row:     74,
  prod_serv_tab:           'Produtos e Serviços-Com',
  prod_serv_produtos_row:  18,
  prod_serv_servicos_row:  26,
}

export interface BudgetSyncResult {
  receita_locacoes:  number | null  // receita só de locações (referência)
  receita_prod_serv: number | null  // receita de produtos e serviços (soma produtos + serviços)
  receita_total:     number | null  // total = locações + prod/serv
  ticket:            number | null  // ticket total = receita_total / giro
  giro:              number | null
  revpar:            number | null
  month:             number
  year:              number
  months_synced:     number
  synced_at:         string
}

// ─── Colunas C–N = jan–dez ────────────────────────────────────────────────────

const COL_FIRST_MONTH = 3   // C = janeiro

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

// ─── Extrai spreadsheet ID da URL ─────────────────────────────────────────────

export function extractSpreadsheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : urlOrId
}

// ─── Helper: parseia uma linha de 12 células como array de número | null ──────

function parseSheetRow(cells: (string | number)[]): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) => {
    const raw = cells[i]
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return isFinite(n) && n > 0 ? n : null
  })
}

// ─── batchGet da aba de Locações — 3 linhas dinâmicas ─────────────────────────

async function fetchLocacoesRows(
  token: string,
  spreadsheetId: string,
  cfg: BudgetConfig,
): Promise<{ receita: (number | null)[]; total: (number | null)[]; giro: (number | null)[]; revpar: (number | null)[] }> {
  const colStart = colLetter(COL_FIRST_MONTH)       // C
  const colEnd   = colLetter(COL_FIRST_MONTH + 11)  // N
  const tab      = cfg.locacoes_tab

  const ranges = [
    `${tab}!${colStart}${cfg.locacoes_receita_row}:${colEnd}${cfg.locacoes_receita_row}`,
    `${tab}!${colStart}${cfg.locacoes_total_row}:${colEnd}${cfg.locacoes_total_row}`,
    `${tab}!${colStart}${cfg.locacoes_giro_row}:${colEnd}${cfg.locacoes_giro_row}`,
    `${tab}!${colStart}${cfg.locacoes_revpar_row}:${colEnd}${cfg.locacoes_revpar_row}`,
  ]
  const qs  = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sheets API batchGet (locações) ${res.status}: ${text}`)
  }

  const data = await res.json() as { valueRanges: { values?: (string | number)[][] }[] }
  return {
    receita: parseSheetRow(data.valueRanges[0]?.values?.[0] ?? []),
    total:   parseSheetRow(data.valueRanges[1]?.values?.[0] ?? []),
    giro:    parseSheetRow(data.valueRanges[2]?.values?.[0] ?? []),
    revpar:  parseSheetRow(data.valueRanges[3]?.values?.[0] ?? []),
  }
}

// ─── batchGet da aba de Produtos e Serviços — 2 linhas dinâmicas ──────────────
// Retorna null silenciosamente se a aba não existir ou der erro.

async function fetchProdServRows(
  token: string,
  spreadsheetId: string,
  cfg: BudgetConfig,
): Promise<{ produtos: (number | null)[]; servicos: (number | null)[] } | null> {
  const colStart = colLetter(COL_FIRST_MONTH)
  const colEnd   = colLetter(COL_FIRST_MONTH + 11)
  const tab      = cfg.prod_serv_tab

  const ranges = [
    `${tab}!${colStart}${cfg.prod_serv_produtos_row}:${colEnd}${cfg.prod_serv_produtos_row}`,
    `${tab}!${colStart}${cfg.prod_serv_servicos_row}:${colEnd}${cfg.prod_serv_servicos_row}`,
  ]
  const qs  = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null  // aba inexistente ou sem acesso — não quebra o sync

  const data = await res.json() as { valueRanges: { values?: (string | number)[][] }[] }
  return {
    produtos: parseSheetRow(data.valueRanges[0]?.values?.[0] ?? []),
    servicos: parseSheetRow(data.valueRanges[1]?.values?.[0] ?? []),
  }
}

// ─── Mescla budget_config do banco com os defaults ────────────────────────────

export function resolveBudgetConfig(raw: unknown): BudgetConfig {
  const d = DEFAULT_BUDGET_CONFIG
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<BudgetConfig>
  return {
    locacoes_tab:            (c.locacoes_tab           as string) || d.locacoes_tab,
    locacoes_receita_row:    Number(c.locacoes_receita_row)   || d.locacoes_receita_row,
    locacoes_total_row:      Number(c.locacoes_total_row)     || d.locacoes_total_row,
    locacoes_giro_row:       Number(c.locacoes_giro_row)      || d.locacoes_giro_row,
    locacoes_revpar_row:     Number(c.locacoes_revpar_row)    || d.locacoes_revpar_row,
    prod_serv_tab:           (c.prod_serv_tab           as string) || d.prod_serv_tab,
    prod_serv_produtos_row:  Number(c.prod_serv_produtos_row) || d.prod_serv_produtos_row,
    prod_serv_servicos_row:  Number(c.prod_serv_servicos_row) || d.prod_serv_servicos_row,
  }
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
    .select('unit_goals, budget_sheet_url, budget_config, budget_yearly')
    .eq('unit_id', unitId)
    .single()

  if (!config?.budget_sheet_url) throw new Error('URL da planilha não configurada para esta unidade')

  const spreadsheetId = extractSpreadsheetId(config.budget_sheet_url)
  const cfg           = resolveBudgetConfig(config.budget_config)

  const now   = new Date()
  const month = now.getMonth() + 1  // 1-indexed
  const year  = now.getFullYear()

  const token = await getAccessToken(creds)

  // Busca as duas abas em paralelo — falha de prod/serv não bloqueia
  const [locRows, prodServ] = await Promise.all([
    fetchLocacoesRows(token, spreadsheetId, cfg),
    fetchProdServRows(token, spreadsheetId, cfg).catch(() => null),
  ])

  // Valida mês atual obrigatório (locações)
  const receitaLocacaoAtual = locRows.receita[month - 1]
  if (receitaLocacaoAtual == null || receitaLocacaoAtual === 0) {
    throw new Error(
      `Orçamento de locações não encontrado em '${cfg.locacoes_tab}'!` +
      `${colLetter(COL_FIRST_MONTH - 1 + month)}${cfg.locacoes_receita_row} (mês ${month}). ` +
      `Verifique se a aba e a linha estão corretas.`
    )
  }

  // Monta budget_yearly com todos os meses que têm receita de locações
  const yearStr  = String(year)
  const existing = (config.budget_yearly ?? {}) as unknown as BudgetYearly
  const yearData: Record<string, BudgetMonthData> = {}
  let monthsSynced = 0

  for (let m = 1; m <= 12; m++) {
    const receitaLoc = locRows.receita[m - 1]
    if (receitaLoc == null) continue

    const receitaProdutos = prodServ?.produtos[m - 1] ?? 0
    const receitaServicos = prodServ?.servicos[m - 1] ?? 0
    const receitaProdServ = receitaProdutos + receitaServicos
    const receitaTotal    = receitaLoc + receitaProdServ
    const totalLoc        = locRows.total[m - 1]
    const giro            = locRows.giro[m - 1]
    const revpar          = locRows.revpar[m - 1]
    // ticket = faturamento total (loc + P&S) / total de locações do mês
    const ticket = (totalLoc != null && totalLoc > 0) ? receitaTotal / totalLoc : null

    yearData[String(m)] = {
      receita: Math.round(receitaTotal),
      ticket:  ticket != null ? Math.round(ticket * 100) / 100 : null,
      giro:    giro   != null ? Math.round(giro   * 100) / 100 : null,
      revpar:  revpar != null ? Math.round(revpar  * 100) / 100 : null,
    }
    monthsSynced++
  }
  const updatedYearly: BudgetYearly = { ...existing, [yearStr]: yearData }

  // Valores do mês atual para unit_goals
  const receitaProdutosAtual = prodServ?.produtos[month - 1] ?? 0
  const receitaServicosAtual = prodServ?.servicos[month - 1] ?? 0
  const receitaProdServAtual = receitaProdutosAtual + receitaServicosAtual
  const receitaTotalAtual    = receitaLocacaoAtual + receitaProdServAtual
  const totalLocAtual        = locRows.total[month - 1]
  const giroAtual            = locRows.giro[month - 1]
  const revparAtual          = locRows.revpar[month - 1]
  // ticket = faturamento total (loc + P&S) / total de locações do mês
  const ticketAtual          = (totalLocAtual != null && totalLocAtual > 0)
    ? receitaTotalAtual / totalLocAtual
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
      unit_goals:       updatedGoals   as unknown as Database['public']['Tables']['rm_agent_config']['Update']['unit_goals'],
      budget_yearly:    updatedYearly  as unknown as Database['public']['Tables']['rm_agent_config']['Update']['budget_yearly'],
      budget_last_sync: syncedAt,
    })
    .eq('unit_id', unitId)

  return {
    receita_locacoes:  Math.round(receitaLocacaoAtual),
    receita_prod_serv: receitaProdServAtual > 0 ? Math.round(receitaProdServAtual) : null,
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
