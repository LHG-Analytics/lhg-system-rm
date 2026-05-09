// Atualização automática de preços de concorrentes com modo 'guia' — chamado pelo cron diário.
// Não depende de Apify: usa a API pública do Guia de Motéis (gratuita e instantânea).

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { scrapeGuiaUrl } from './guia-scraper'
import { detectPriceChanges, computeAndPersistGaps } from './detect-changes'

interface CompetitorEntry {
  name: string
  mode: string
  urls: { url: string; label?: string }[]
}

function normalizeCompetitorUrls(raw: unknown): CompetitorEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c: Record<string, unknown>) => {
    const name = String(c.name ?? '')
    const mode = String(c.mode ?? 'cheerio')
    let urls: { url: string; label?: string }[] = []
    if (Array.isArray(c.urls)) {
      urls = (c.urls as Record<string, string>[]).map((u) => ({ url: u.url, label: u.label }))
    } else if (typeof c.url === 'string') {
      urls = [{ url: c.url }]
    }
    return { name, mode, urls }
  })
}

export interface GuiaCronResult {
  updated: number
  errors: string[]
}

/**
 * Atualiza snapshots de concorrentes com mode='guia' para uma unidade.
 * Chamado diariamente pelo cron de revisões — sem Apify, sem custo.
 */
export async function updateGuiaCompetitorsForUnit(unitId: string): Promise<GuiaCronResult> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: config } = await admin
    .from('rm_agent_config')
    .select('competitor_urls')
    .eq('unit_id', unitId)
    .single()

  const competitors = normalizeCompetitorUrls(config?.competitor_urls)
  const guiaEntries = competitors.filter((c) => c.mode === 'guia')
  if (!guiaEntries.length) return { updated: 0, errors: [] }

  let updated = 0
  const errors: string[] = []

  for (const comp of guiaEntries) {
    for (const { url } of comp.urls) {
      try {
        const { prices, amenitiesBySuite } = await scrapeGuiaUrl(url)
        if (!prices.length) {
          errors.push(`${comp.name} (${url}): nenhum preço encontrado`)
          continue
        }

        const { data: saved, error: saveErr } = await admin
          .from('competitor_snapshots')
          .upsert(
            {
              unit_id: unitId,
              competitor_name: comp.name,
              competitor_url: url,
              mapped_prices: prices as unknown as Database['public']['Tables']['competitor_snapshots']['Insert']['mapped_prices'],
              raw_text: JSON.stringify({ mode: 'guia', suiteName: comp.name, amenities: [], amenitiesBySuite }),
              scraped_at: new Date().toISOString(),
              status: 'done',
              apify_run_id: null,
            },
            { onConflict: 'unit_id,competitor_url' },
          )
          .select('id')
          .single()

        if (saveErr || !saved) {
          errors.push(`${comp.name}: erro ao salvar — ${saveErr?.message ?? 'unknown'}`)
          continue
        }

        await detectPriceChanges(saved.id, null).catch(() => null)
        updated++
      } catch (e) {
        errors.push(`${comp.name}: ${String(e)}`)
      }
    }
  }

  if (updated > 0) {
    await computeAndPersistGaps(unitId).catch((e) => {
      errors.push(`computeGaps: ${String(e)}`)
    })
  }

  return { updated, errors }
}
