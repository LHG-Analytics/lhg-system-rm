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

export interface BudgetSyncResult {
  receita_locacoes: number | null
  month: number
  year: number
  synced_at: string
}

// ─── Estrutura da DRE (planilha padronizada) ─────────────────────────────────
// Col B  = labels
// Para mês M (1=jan): coluna de Orçamento = índice 4 * M (D=4, H=8, L=12...)
// Row 11 = RECEITA BRUTA DE LOCAÇÕES → unit_goals.receita_mensal

const RECEITA_LOCACOES_ROW = 11   // RECEITA BRUTA DE LOCAÇÕES
const RECEITA_OPERACIONAL_ROW = 9 // RECEITA OPERACIONAL BRUTA (fallback para validação)

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

// ─── Coluna de Orçamento para o mês M (1-indexed) ────────────────────────────
// Layout: col D(4)=Jan Orç, col H(8)=Fev Orç, col L(12)=Mar Orç ...

function colLetter(n: number): string {
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

function orcamentoCol(month: number): string {
  return colLetter(4 * month)
}

// ─── Extrai spreadsheet ID da URL ─────────────────────────────────────────────

export function extractSpreadsheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : urlOrId
}

// ─── Fetch de célula única na planilha ────────────────────────────────────────

async function fetchCell(
  token: string,
  spreadsheetId: string,
  tab: string,
  col: string,
  row: number,
): Promise<number | null> {
  const range = encodeURIComponent(`${tab}!${col}${row}`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sheets API ${res.status}: ${text}`)
  }
  const data = await res.json() as { values?: (string | number)[][] }
  const raw = data.values?.[0]?.[0]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return isFinite(n) ? n : null
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
    .select('unit_goals, budget_sheet_url, budget_sheet_tab')
    .eq('unit_id', unitId)
    .single()

  if (!config?.budget_sheet_url) throw new Error('URL da planilha não configurada para esta unidade')

  const spreadsheetId = extractSpreadsheetId(config.budget_sheet_url)
  const tab = config.budget_sheet_tab ?? 'DRE'

  const now = new Date()
  const month = now.getMonth() + 1
  const year  = now.getFullYear()
  const col   = orcamentoCol(month)

  const token = await getAccessToken(creds)

  // Busca RECEITA BRUTA DE LOCAÇÕES (row 11) + RECEITA OPERACIONAL BRUTA (row 9) para validação
  const [receitaLocacoes, receitaOperacional] = await Promise.all([
    fetchCell(token, spreadsheetId, tab, col, RECEITA_LOCACOES_ROW),
    fetchCell(token, spreadsheetId, tab, col, RECEITA_OPERACIONAL_ROW),
  ])

  if (receitaLocacoes == null && receitaOperacional == null) {
    throw new Error(`Nenhum valor encontrado na coluna ${col} da aba "${tab}" (linhas ${RECEITA_LOCACOES_ROW} e ${RECEITA_OPERACIONAL_ROW}). Verifique se a estrutura da planilha está correta.`)
  }

  // Usa receita de locações; fallback para operacional se a linha de locações estiver vazia
  const receita = receitaLocacoes ?? receitaOperacional!

  // Atualiza unit_goals.receita_mensal preservando os outros campos
  const existingGoals = (config.unit_goals ?? {}) as UnitGoals
  const updatedGoals: UnitGoals = { ...existingGoals, receita_mensal: Math.round(receita) }

  const syncedAt = new Date().toISOString()
  await admin
    .from('rm_agent_config')
    .update({
      unit_goals: updatedGoals as unknown as Database['public']['Tables']['rm_agent_config']['Update']['unit_goals'],
      budget_last_sync: syncedAt,
    })
    .eq('unit_id', unitId)

  return { receita_locacoes: Math.round(receita), month, year, synced_at: syncedAt }
}
