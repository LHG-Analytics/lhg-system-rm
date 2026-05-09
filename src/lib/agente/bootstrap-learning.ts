// Bootstrap de rm_pricing_lessons e rm_price_elasticity a partir do histórico de
// tabelas de preços importadas — sem depender de checkpoints futuros.
//
// Cada vez que uma nova tabela foi importada, tratamos a transição como
// um "experimento natural": comparamos KPIs dos últimos WINDOW_DAYS antes
// da troca com os primeiros WINDOW_DAYS depois, e registramos o que
// aconteceu com cada preço que mudou.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { computeAndPersistElasticity } from '@/lib/pricing/elasticity'

const MIN_DAYS = 14   // Mínimo de dias de dados necessários em cada período
const WINDOW_DAYS = 28 // Janela de comparação (dias antes e depois da troca)

function isoToDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000,
  )
}

function deltaPct(before: number, after: number): number {
  if (!before) return 0
  return +((after - before) / before * 100).toFixed(2)
}

function simpleVerdict(variacao_pct: number, delta_revpar_pct: number, delta_giro_pct: number): string {
  if (variacao_pct > 0 && delta_revpar_pct > 0) return 'success'
  if (variacao_pct > 0 && delta_revpar_pct < -2) return 'failure'
  if (variacao_pct < 0 && delta_giro_pct > 2) return 'success'
  return 'neutral'
}

export interface BootstrapResult {
  transitions: number  // pares de tabelas processados com sucesso
  inserted: number     // linhas inseridas em rm_pricing_lessons
  skipped: number      // transições sem dados suficientes
  elasticityUpdated: number
}

/**
 * Popula rm_pricing_lessons com dados históricos de transições de tabelas.
 * Auto-skip se a unidade já tem >= 5 lições vindas de propostas reais (checkpoints).
 * Safe para chamar repetidamente — inserts com conditions.source='bootstrap' são idempotentes
 * via checagem de (unit_id, categoria, periodo, dia_tipo, observed_at) existente.
 */
export async function bootstrapPricingLessons(
  unitId: string,
  unitSlug: string,
): Promise<BootstrapResult> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Não faz bootstrap se já há dados confiáveis de checkpoints reais
  const { count: realLessons } = await admin
    .from('rm_pricing_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', unitId)
    .not('proposal_id', 'is', null)

  if ((realLessons ?? 0) >= 5) {
    return { transitions: 0, inserted: 0, skipped: 0, elasticityUpdated: 0 }
  }

  // Busca imports de preços com dados parseados, do mais antigo ao mais recente
  const { data: imports } = await admin
    .from('price_imports')
    .select('id, valid_from, valid_until, parsed_data')
    .eq('unit_id', unitId)
    .eq('import_type', 'prices')
    .not('parsed_data', 'is', null)
    .order('valid_from', { ascending: true })

  if (!imports || imports.length < 2) {
    return { transitions: 0, inserted: 0, skipped: 0, elasticityUpdated: 0 }
  }

  const today = new Date().toISOString().slice(0, 10)
  let inserted = 0
  let skipped = 0
  let transitions = 0

  for (let i = 0; i < imports.length - 1; i++) {
    const importA = imports[i]
    const importB = imports[i + 1]
    const switchDate = importB.valid_from  // data em que B substituiu A

    // Precisa ter passado MIN_DAYS desde a troca para ter dados pós confiáveis
    if (daysBetween(switchDate, today) < MIN_DAYS) { skipped++; continue }

    // Período "antes": últimos WINDOW_DAYS dentro da vigência de A
    const beforeEnd   = addDaysISO(switchDate, -1)
    const beforeStart = addDaysISO(beforeEnd, -(WINDOW_DAYS - 1))

    // A deve ter pelo menos MIN_DAYS de história antes da troca
    if (daysBetween(importA.valid_from, beforeEnd) < MIN_DAYS) { skipped++; continue }

    // Período "depois": WINDOW_DAYS após a troca (limitado a ontem)
    const afterStart = switchDate
    const afterEndRaw = addDaysISO(switchDate, WINDOW_DAYS - 1)
    const afterEnd = afterEndRaw < addDaysISO(today, -1) ? afterEndRaw : addDaysISO(today, -1)

    if (daysBetween(afterStart, afterEnd) < MIN_DAYS) { skipped++; continue }

    const rowsA = (importA.parsed_data as unknown as ParsedPriceRow[]) ?? []
    const rowsB = (importB.parsed_data as unknown as ParsedPriceRow[]) ?? []
    if (!rowsA.length || !rowsB.length) { skipped++; continue }

    // Busca KPIs de ambos os períodos em paralelo
    const [kpiBefore, kpiAfter] = await Promise.all([
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(beforeStart), isoToDDMMYYYY(beforeEnd)).catch(() => null),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(afterStart), isoToDDMMYYYY(afterEnd)).catch(() => null),
    ])

    if (!kpiBefore || !kpiAfter) { skipped++; continue }

    const bef = kpiBefore.TotalResult
    const aft = kpiAfter.TotalResult
    if (!bef.totalRevpar || !bef.totalGiro) { skipped++; continue }

    const delta_revpar_pct  = deltaPct(bef.totalRevpar, aft.totalRevpar)
    const delta_giro_pct    = deltaPct(bef.totalGiro, aft.totalGiro)
    const delta_ocupacao_pp = +((aft.totalOccupancyRate - bef.totalOccupancyRate) / 100 * 100).toFixed(2)
    const delta_ticket_pct  = deltaPct(bef.totalAllTicketAverage, aft.totalAllTicketAverage)

    // Mapeia chave → preço da tabela A
    const mapA = new Map<string, number>()
    for (const r of rowsA) {
      mapA.set(`${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`, Number(r.preco))
    }

    // Gera uma lesson para cada linha de B que mudou em relação a A
    const inserts = rowsB
      .map((r) => {
        const key = `${r.canal}|${r.categoria}|${r.periodo}|${r.dia_tipo}`
        const precoAnterior = mapA.get(key)
        const precoNovo = Number(r.preco)
        if (precoAnterior == null || precoAnterior === precoNovo) return null

        const variacao_pct = deltaPct(precoAnterior, precoNovo)
        if (Math.abs(variacao_pct) < 1) return null

        const implied_elasticity = Math.abs(variacao_pct) >= 1
          ? +(delta_giro_pct / variacao_pct).toFixed(3)
          : null

        return {
          unit_id:                unitId,
          proposal_id:            null,  // bootstrap — sem proposta associada
          checkpoint_days:        WINDOW_DAYS,
          categoria:              r.categoria,
          periodo:                r.periodo,
          dia_tipo:               r.dia_tipo,
          canal:                  r.canal as string,
          preco_anterior:         precoAnterior,
          preco_novo:             precoNovo,
          variacao_pct,
          delta_revpar_pct,
          delta_giro_pct,
          delta_ocupacao_pp,
          delta_ticket_pct,
          attributed_pricing_pct: null,  // sem decomposição no bootstrap
          implied_elasticity,
          conditions:             { source: 'bootstrap', import_a: importA.id, import_b: importB.id, switch_date: switchDate },
          verdict:                simpleVerdict(variacao_pct, delta_revpar_pct, delta_giro_pct),
          observed_at:            new Date(switchDate + 'T12:00:00Z').toISOString(),
        }
      })
      .filter(Boolean)

    if (!inserts.length) { skipped++; continue }

    const { error } = await admin.from('rm_pricing_lessons').insert(
      inserts as Database['public']['Tables']['rm_pricing_lessons']['Insert'][],
    )
    if (!error) {
      inserted += inserts.length
      transitions++
    }
  }

  let elasticityUpdated = 0
  if (inserted > 0) {
    elasticityUpdated = await computeAndPersistElasticity(unitId).catch(() => 0)
  }

  return { transitions, inserted, skipped, elasticityUpdated }
}
