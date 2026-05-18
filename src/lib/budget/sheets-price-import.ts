/**
 * Google Sheets → price_import_jobs integration.
 *
 * Reads date-named tabs from a Google Sheets price table, parses each tab
 * with AI, and returns structured ParsedPriceRow[] per tab with computed
 * valid_from / valid_until dates.
 *
 * Tab name formats supported:
 *   - DDMMYYYY  (e.g. "01092024")
 *   - DD/MM/YY  (e.g. "27/02/26")
 * All other tab names (campaign tabs like "San Valentin") are skipped.
 */

import * as crypto from 'crypto'
import { generateText } from 'ai'
import { ANALYSIS_MODEL, analysisOptions } from '@/lib/agente/model'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'

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

// ─── Google OAuth2 via JWT RS256 (shared pattern with google-sheets.ts) ───────

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

// ─── Tab date parsing ──────────────────────────────────────────────────────────

/**
 * Parses a sheet tab name into a YYYY-MM-DD string.
 * Returns null for non-date tabs (campaign names, etc.).
 */
export function parseTabDate(name: string): string | null {
  const t = name.trim()

  // DDMMYYYY — exactly 8 digits
  if (/^\d{8}$/.test(t)) {
    const dd = t.slice(0, 2), mm = t.slice(2, 4), yyyy = t.slice(4, 8)
    const d = parseInt(dd), m = parseInt(mm), y = parseInt(yyyy)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2020) return `${yyyy}-${mm}-${dd}`
    return null
  }

  // DD/MM/YY
  const m2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m2) {
    const dd = m2[1].padStart(2, '0'), mm = m2[2].padStart(2, '0')
    const yy = parseInt(m2[3])
    const yyyy = yy >= 50 ? `19${String(yy).padStart(2, '0')}` : `20${String(yy).padStart(2, '0')}`
    const d = parseInt(dd), m = parseInt(mm)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${yyyy}-${mm}-${dd}`
    return null
  }

  // DD/MM/YYYY
  const m4 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m4) {
    const dd = m4[1].padStart(2, '0'), mm = m4[2].padStart(2, '0'), yyyy = m4[3]
    const d = parseInt(dd), m = parseInt(mm), y = parseInt(yyyy)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2020) return `${yyyy}-${mm}-${dd}`
    return null
  }

  return null
}

// ─── Sheets API ────────────────────────────────────────────────────────────────

export interface SheetTab {
  name: string
  sheetId: number
}

export async function listSheetTabs(spreadsheetId: string, token: string): Promise<SheetTab[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheets listTabs ${res.status}: ${await res.text()}`)
  const data = await res.json() as { sheets: { properties: { title: string; sheetId: number } }[] }
  return (data.sheets ?? []).map((s) => ({ name: s.properties.title, sheetId: s.properties.sheetId }))
}

async function readTabValues(
  spreadsheetId: string,
  tabName: string,
  token: string,
): Promise<(string | number)[][]> {
  const range = encodeURIComponent(tabName)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheets readTab "${tabName}" ${res.status}: ${await res.text()}`)
  const data = await res.json() as { values?: (string | number)[][] }
  return data.values ?? []
}

function valuesToText(values: (string | number)[][]): string {
  return values.map((row) => row.join('\t')).join('\n')
}

// ─── AI parsing ───────────────────────────────────────────────────────────────

// Liv-specific prompt — knows the two-name-column structure and column names to skip.
const LIV_PRICE_PROMPT = `Você receberá o conteúdo de uma planilha de tabela de preços do motel LIV exportada como texto separado por tabulações.

Estrutura da planilha:
- DUAS colunas de nomes: a primeira tem o nome interno, a segunda tem o nome COMERCIAL
  (ex: Hidro Promo, Vip, Diamond, Hidro Sexy, Hidro e Sauna, Lounge, Lounge Hidro, Lounge Spa, Lounge Spa 50 Sombras, Lounge Acqua)
  USE SEMPRE o nome da segunda coluna (nome comercial) como "categoria".
- Seções de canal separadas por cabeçalhos:
  "RESERVA IMEDIATA" → canal: "balcao_site"
  "RESERVAS ANTECIPADAS" → canal: "site_programada"
- Períodos estão nos cabeçalhos das colunas (ex: 3H, 6H, 12H, PERNOITE)
- Tipos de dia: "Semana" e "FDS/Feriado" (ou variações)
- IGNORE completamente as colunas: Giro Implícito, Diferença percentual, Período Excedente, Ocupante Adicional
- Os preços são valores numéricos em dólar (USD) — inclua apenas o número

Retorne SOMENTE JSON minificado:
{"rows":[{"canal":"balcao_site","categoria":"Hidro Promo","periodo":"3 horas","dia_tipo":"semana","preco":25},...], "canais_encontrados":["balcao_site","site_programada"]}

Valores válidos para os campos:
- canal: "balcao_site" | "site_programada"
- periodo: nome em português minúsculo (ex: "3 horas", "6 horas", "12 horas", "pernoite")
- dia_tipo: "semana" | "fds_feriado" | "todos"
- preco: número (sem símbolo de moeda)

Planilha:
`

function extractPriceJSON(text: string): { rows: ParsedPriceRow[]; canais_encontrados: string[] } | null {
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

async function parseTabWithAI(
  tabText: string,
  unitSlug: string,
): Promise<{ rows: ParsedPriceRow[]; canais_encontrados: string[] }> {
  // Prompt selection: Liv has a known structure; other units fall back to the generic queue prompt
  const prompt = unitSlug === 'liv'
    ? `${LIV_PRICE_PROMPT}${tabText.slice(0, 20000)}`
    : buildGenericSheetPrompt(tabText)

  const { text } = await generateText({
    model: ANALYSIS_MODEL,
    providerOptions: analysisOptions,
    prompt,
    maxOutputTokens: 4000,
    temperature: 0,
  })

  const parsed = extractPriceJSON(text)
  if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error(`Modelo não retornou preços válidos. Preview: ${text.slice(0, 300)}`)
  }
  return { rows: parsed.rows, canais_encontrados: parsed.canais_encontrados ?? [] }
}

function buildGenericSheetPrompt(tabText: string): string {
  return `Você receberá o conteúdo de uma planilha de tabela de preços de motel exportada como texto separado por tabulações.

Extraia as tarifas dos seguintes canais (ignore qualquer outro):
1. balcao_site — Tarifa Balcão (presencial) e Site imediato / Reserva Imediata
2. site_programada — Reserva Antecipada pelo site
3. guia_moteis — Guia de Motéis

Para cada tarifa: canal, categoria (nome comercial da suíte), periodo, dia_tipo ("semana"|"fds_feriado"|"todos"), preco (numérico).
Retorne SOMENTE JSON: {"rows":[...],"canais_encontrados":[]}

Planilha:
${tabText.slice(0, 20000)}`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface TabImportJob {
  tabName: string
  validFrom: string       // YYYY-MM-DD
  validUntil: string | null  // YYYY-MM-DD or null (most recent = current)
  rows: ParsedPriceRow[]
  canaisEncontrados: string[]
}

/**
 * Reads all date-named tabs from the spreadsheet, parses each with AI,
 * and returns structured import jobs with computed validity windows.
 * Tabs that fail to parse are skipped (logged to console).
 */
export async function importPricesFromSheets(
  spreadsheetId: string,
  unitSlug: string,
): Promise<TabImportJob[]> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado')
  const creds = JSON.parse(json) as ServiceAccountCredentials

  const token = await getAccessToken(creds)
  const allTabs = await listSheetTabs(spreadsheetId, token)

  // Filter to date tabs only and sort chronologically
  const dateTabs = allTabs
    .map((t) => ({ ...t, date: parseTabDate(t.name) }))
    .filter((t): t is typeof t & { date: string } => t.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (dateTabs.length === 0) {
    throw new Error(
      'Nenhuma aba com data encontrada. Formatos suportados: DDMMYYYY (ex: 01092024) ou DD/MM/AA (ex: 27/02/26).'
    )
  }

  // Read + parse all tabs in parallel
  const results = await Promise.allSettled(
    dateTabs.map(async (tab) => {
      const values = await readTabValues(spreadsheetId, tab.name, token)
      const text = valuesToText(values)
      return parseTabWithAI(text, unitSlug)
    })
  )

  // Compute valid_until = next tab's date - 1 day; last tab → null
  const jobs: TabImportJob[] = []
  for (let i = 0; i < dateTabs.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      console.error(`[sheets-price-import] Aba "${dateTabs[i].name}" falhou:`, result.reason)
      continue
    }
    const nextDate = i + 1 < dateTabs.length ? new Date(dateTabs[i + 1].date) : null
    let validUntil: string | null = null
    if (nextDate) {
      nextDate.setDate(nextDate.getDate() - 1)
      validUntil = nextDate.toISOString().slice(0, 10)
    }
    jobs.push({
      tabName: dateTabs[i].name,
      validFrom: dateTabs[i].date,
      validUntil,
      rows: result.value.rows,
      canaisEncontrados: result.value.canais_encontrados,
    })
  }

  return jobs
}
