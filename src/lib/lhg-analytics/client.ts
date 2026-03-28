import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type {
  CompanyKPIResponse,
  RestaurantKPIResponse,
  BookingsKPIResponse,
  KPIQueryParams,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTH_BASE = 'https://analytics.lhgmoteis.com.br/auth'

// ─── Supabase admin client for token storage ──────────────────────────────────

function getAdminClient() {
  return createSupabaseAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Token persistence ────────────────────────────────────────────────────────

async function getStoredToken(unitSlug: string): Promise<{ token: string; expiresAt: Date } | null> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('lhg_analytics_tokens')
    .select('access_token, expires_at')
    .eq('unit_slug', unitSlug)
    .single()

  if (!data) return null
  return { token: data.access_token, expiresAt: new Date(data.expires_at) }
}

async function storeToken(unitSlug: string, token: string, expiresAt: Date) {
  const supabase = getAdminClient()
  await supabase
    .from('lhg_analytics_tokens')
    .upsert(
      {
        unit_slug: unitSlug,
        access_token: token,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'unit_slug' }
    )
}

// ─── Cookie parsing helper ────────────────────────────────────────────────────

function parseSetCookie(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null
  // Handle multiple cookies (comma-separated in some environments)
  const cookieParts = setCookieHeader.split(/,(?=[^;]+=[^;]+;)/g)
  for (const part of cookieParts) {
    const match = part.trim().match(new RegExp(`^${name}=([^;]+)`))
    if (match) return match[1]
  }
  return null
}

// ─── Auth: login (stores token for all units since account is shared) ─────────

async function loginAndStoreToken(unitSlug: string): Promise<string> {
  const email = process.env.LHG_ANALYTICS_EMAIL
  const password = process.env.LHG_ANALYTICS_PASSWORD

  if (!email || !password) {
    throw new Error('LHG Analytics credentials not configured (LHG_ANALYTICS_EMAIL / LHG_ANALYTICS_PASSWORD)')
  }

  const res = await fetch(`${AUTH_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    throw new Error(`LHG Analytics login failed: ${res.status} ${res.statusText}`)
  }

  const body = await res.json() as { expiresAt?: string }
  const setCookieHeader = res.headers.get('set-cookie')
  const token = parseSetCookie(setCookieHeader, 'access_token')

  if (!token) {
    throw new Error('LHG Analytics login did not return access_token cookie')
  }

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 3600 * 1000)
  await storeToken(unitSlug, token, expiresAt)
  return token
}

// ─── Get valid token (login if missing or expired) ────────────────────────────

async function getValidToken(unitSlug: string): Promise<string> {
  const stored = await getStoredToken(unitSlug)
  const bufferMs = 5 * 60 * 1000 // 5-min buffer before actual expiry

  if (stored && stored.expiresAt.getTime() - Date.now() > bufferMs) {
    return stored.token
  }

  // Token absent or nearly expired — re-login
  return loginAndStoreToken(unitSlug)
}

// ─── Generic authenticated fetch ──────────────────────────────────────────────

async function apiFetch<T>(
  baseUrl: string,
  path: string,
  token: string,
  params: KPIQueryParams
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`)
  url.searchParams.set('startDate', params.startDate)
  url.searchParams.set('endDate', params.endDate)

  const res = await fetch(url.toString(), {
    headers: {
      accept: '*/*',
      Cookie: `access_token=${token}`,
    },
    next: { revalidate: 0 }, // real-time data — never cache
  })

  if (!res.ok) {
    throw new Error(`LHG Analytics ${path} failed: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LHGAnalyticsUnit {
  slug: string
  apiBaseUrl: string // e.g. https://analytics.lhgmoteis.com.br/lush_ipiranga/ipiranga/api
}

export async function fetchCompanyKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<CompanyKPIResponse> {
  const token = await getValidToken(unit.slug)
  return apiFetch<CompanyKPIResponse>(unit.apiBaseUrl, '/Company/kpis/date-range', token, params)
}

export async function fetchRestaurantKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<RestaurantKPIResponse> {
  const token = await getValidToken(unit.slug)
  return apiFetch<RestaurantKPIResponse>(unit.apiBaseUrl, '/Restaurants/restaurants/date-range', token, params)
}

export async function fetchBookingsKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<BookingsKPIResponse> {
  const token = await getValidToken(unit.slug)
  return apiFetch<BookingsKPIResponse>(unit.apiBaseUrl, '/Bookings/bookings/date-range', token, params)
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Format a Date as DD/MM/YYYY for the LHG Analytics query params */
export function toApiDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

/**
 * Janela rolante de 12 meses: mesma data do ano passado → ontem.
 * Ex: hoje = 28/03/2026 → startDate = 28/03/2025, endDate = 27/03/2026.
 *
 * Usado como contexto histórico do agente RM para evitar sazonalidade
 * (YTD seria enviesado no início do ano — aqui sempre há 365 dias completos).
 */
export function trailingYear(): KPIQueryParams {
  const now = new Date()

  // Dia operacional atual (antes das 06:00 ainda é "ontem")
  const operationalToday =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // endDate = ontem (dados do dia de hoje ainda incompletos)
  const endDate = new Date(operationalToday)
  endDate.setDate(endDate.getDate() - 1)

  // startDate = mesma data do ano passado
  const startDate = new Date(operationalToday)
  startDate.setFullYear(startDate.getFullYear() - 1)

  return {
    startDate: toApiDate(startDate),
    endDate: toApiDate(endDate),
  }
}

/** Single operational day (06:00–05:59 next day) */
export function todayOperational(): KPIQueryParams {
  const now = new Date()
  const operationalDate =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const dateStr = toApiDate(operationalDate)
  return { startDate: dateStr, endDate: dateStr }
}
