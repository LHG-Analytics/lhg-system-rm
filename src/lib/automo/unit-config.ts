import { createClient } from '@/lib/supabase/server'

export interface UnitConfig {
  id: string
  name: string
  slug: string
  automo_env_key: string | null
  automo_category_ids: number[]
  period_type: 'standard' | 'altana'
}

// Cache em memória com TTL de 5 minutos
interface CacheEntry {
  config: UnitConfig
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000

export async function getUnitConfig(slug: string): Promise<UnitConfig | null> {
  const now = Date.now()
  const cached = cache.get(slug)
  if (cached && cached.expiresAt > now) return cached.config

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .select('id, name, slug, automo_env_key, automo_category_ids, period_type')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    console.warn(`[unit-config] Unidade não encontrada ou inativa: ${slug}`)
    return null
  }

  const config: UnitConfig = {
    id:                  data.id,
    name:                data.name,
    slug:                data.slug,
    automo_env_key:      data.automo_env_key ?? null,
    automo_category_ids: (data.automo_category_ids as number[]) ?? [],
    period_type:         (data.period_type as 'standard' | 'altana') ?? 'standard',
  }

  cache.set(slug, { config, expiresAt: now + TTL_MS })
  return config
}

export async function getAllUnitConfigs(): Promise<UnitConfig[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .select('id, name, slug, automo_env_key, automo_category_ids, period_type')
    .eq('is_active', true)
    .order('name')

  if (error || !data) return []

  return data.map(d => ({
    id:                  d.id,
    name:                d.name,
    slug:                d.slug,
    automo_env_key:      d.automo_env_key ?? null,
    automo_category_ids: (d.automo_category_ids as number[]) ?? [],
    period_type:         (d.period_type as 'standard' | 'altana') ?? 'standard',
  }))
}

export function invalidateUnitCache(slug?: string) {
  if (slug) {
    cache.delete(slug)
  } else {
    cache.clear()
  }
}
