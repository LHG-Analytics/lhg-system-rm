import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type {
  LHGAuthResponse,
  CompanyKPIResponse,
  RestaurantKPIResponse,
  BookingsKPIResponse,
  KPIQueryParams,
} from './types'

// ─── Supabase admin client (service_role) for token table ────────────────────

function getAdminClient() {
  return createSupabaseAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Token management ─────────────────────────────────────────────────────────

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

async function storeToken(unitSlug: string, token: string, expiresInSeconds: number) {
  const supabase = getAdminClient()
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

  await supabase
    .from('lhg_analytics_tokens')
    .upsert({
      unit_slug: unitSlug,
      access_token: token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'unit_slug' })
}

// ─── Auth: login ──────────────────────────────────────────────────────────────

async function login(baseUrl: string): Promise<LHGAuthResponse> {
  const email = process.env.LHG_ANALYTICS_EMAIL
  const password = process.env.LHG_ANALYTICS_PASSWORD

  if (!email || !password) {
    throw new Error('LHG Analytics credentials not configured')
  }

  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    throw new Error(`LHG Analytics login failed: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<LHGAuthResponse>
}

// ─── Auth: refresh ────────────────────────────────────────────────────────────

async function refreshToken(baseUrl: string, currentToken: string): Promise<LHGAuthResponse> {
  const res = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentToken}`,
    },
  })

  if (!res.ok) {
    throw new Error(`LHG Analytics token refresh failed: ${res.status}`)
  }

  return res.json() as Promise<LHGAuthResponse>
}

// ─── Get valid token (with refresh + re-login fallback) ───────────────────────

async function getValidToken(unitSlug: string, baseUrl: string): Promise<string> {
  const stored = await getStoredToken(unitSlug)
  const bufferMs = 5 * 60 * 1000 // treat token as expired 5 min early

  if (stored && stored.expiresAt.getTime() - Date.now() > bufferMs) {
    return stored.token
  }

  // Try refresh first if we have a stale token
  if (stored) {
    try {
      const refreshed = await refreshToken(baseUrl, stored.token)
      await storeToken(unitSlug, refreshed.access_token, refreshed.expires_in ?? 3600)
      return refreshed.access_token
    } catch {
      // Refresh failed — fall through to re-login
    }
  }

  // Full re-login
  const auth = await login(baseUrl)
  await storeToken(unitSlug, auth.access_token, auth.expires_in ?? 3600)
  return auth.access_token
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
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 0 }, // always fresh — data is real-time
  })

  if (!res.ok) {
    throw new Error(`LHG Analytics ${path} failed: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LHGAnalyticsUnit {
  slug: string
  apiBaseUrl: string
}

export async function fetchCompanyKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<CompanyKPIResponse> {
  const token = await getValidToken(unit.slug, unit.apiBaseUrl)
  return apiFetch<CompanyKPIResponse>(unit.apiBaseUrl, '/company/kpis', token, params)
}

export async function fetchRestaurantKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<RestaurantKPIResponse> {
  const token = await getValidToken(unit.slug, unit.apiBaseUrl)
  return apiFetch<RestaurantKPIResponse>(unit.apiBaseUrl, '/restaurant/kpis', token, params)
}

export async function fetchBookingsKPIs(
  unit: LHGAnalyticsUnit,
  params: KPIQueryParams
): Promise<BookingsKPIResponse> {
  const token = await getValidToken(unit.slug, unit.apiBaseUrl)
  return apiFetch<BookingsKPIResponse>(unit.apiBaseUrl, '/bookings/kpis', token, params)
}

// ─── Date helpers (operational day: 06:00–05:59 next day) ────────────────────

export function toApiDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

export function todayOperational(): { startDate: string; endDate: string } {
  const now = new Date()
  // Before 06:00 → operational day is still "yesterday"
  const operationalDate = now.getHours() < 6
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const dateStr = toApiDate(operationalDate)
  return { startDate: dateStr, endDate: dateStr }
}
