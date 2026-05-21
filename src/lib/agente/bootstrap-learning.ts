// Bootstrap de rm_pricing_lessons e rm_price_elasticity a partir do histórico de
// tabelas de preços importadas — sem depender de checkpoints futuros.
//
// Trata cada transição entre tabelas consecutivas como "experimento natural":
// compara KPIs por CATEGORIA nos 28 dias antes vs 28 dias depois da troca.
// Usando KPIs por categoria (não totais da unidade), a elasticidade calculada
// reflete o comportamento real daquele produto — ex: RELAX 3h FDS isolado.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { SuiteCategoryKPI, DataTableSuiteCategory } from '@/lib/kpis/types'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'
import { computeAndPersistElasticity } from '@/lib/pricing/elasticity'

const MIN_DAYS_BEFORE = 14 // Mínimo de dias de vigência da tabela A antes da troca
const MIN_DAYS_AFTER  = 7  // Mínimo de dias após a troca (usa valid_from, não data de import)
const WINDOW_DAYS = 28     // Janela ideal de comparação (dias antes e depois)

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

// Converte DataTableSuiteCategory[] → Map<categoria, SuiteCategoryKPI>
function buildCatMap(response: CompanyKPIResponse): Map<string, SuiteCategoryKPI> {
  const map = new Map<string, SuiteCategoryKPI>()
  for (const entry of (response.DataTableSuiteCategory ?? []) as DataTableSuiteCategory[]) {
    for (const [cat, kpi] of Object.entries(entry)) {
      map.set(cat, kpi)
    }
  }
  return map
}

export interface BootstrapTransitionDetail {
  switchDate: string   // valid_from da tabela nova (data de vigência, não de import)
  status: 'processed' | 'skipped' | 'already_done'
  reason?: string      // motivo do skip
  inserted?: number    // linhas inseridas nesta transição
}

export interface BootstrapResult {
  transitions: number      // pares de tabelas processados com sucesso
  inserted: number         // linhas inseridas em rm_pricing_lessons
  skipped: number          // transições sem dados suficientes
  elasticityUpdated: number
  details: BootstrapTransitionDetail[]
}

/**
 * Popula rm_pricing_lessons com dados históricos de transições de tabelas.
 * Usa KPIs por categoria (revpar, giro, ocupação, ticket) — não totais da unidade.
 * Idempotente por par: se já existe lição bootstrap para o import_b, o par é pulado.
 */
export async function bootstrapPricingLessons(
  unitId: string,
  unitSlug: string,
): Promise<BootstrapResult> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Busca imports de preços com dados parseados, do mais antigo ao mais recente
  const { data: imports } = await admin
    .from('price_imports')
    .select('id, valid_from, valid_until, parsed_data')
    .eq('unit_id', unitId)
    .eq('import_type', 'prices')
    .not('parsed_data', 'is', null)
    .order('valid_from', { ascending: true })

  if (!imports || imports.length < 2) {
    return { transitions: 0, inserted: 0, skipped: 0, elasticityUpdated: 0, details: [] }
  }

  const today = new Date().toISOString().slice(0, 10)
  let inserted = 0
  let skipped = 0
  let transitions = 0
  const details: BootstrapTransitionDetail[] = []

  for (let i = 0; i < imports.length - 1; i++) {
    const importA = imports[i]
    const importB = imports[i + 1]
    // Usa valid_from (data de vigência) como data da troca — NÃO a data de importação
    const switchDate = importB.valid_from

    // Idempotência: pula par já processado (identifica pelo import_b no conditions JSONB)
    const { count: existing } = await admin
      .from('rm_pricing_lessons')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .filter('conditions->>import_b', 'eq', importB.id)
    if ((existing ?? 0) > 0) {
      details.push({ switchDate, status: 'already_done' })
      continue
    }

    // Período "antes": últimos WINDOW_DAYS dentro da vigência de A (janela antes da troca)
    const beforeEnd   = addDaysISO(switchDate, -1)
    const beforeStart = addDaysISO(beforeEnd, -(WINDOW_DAYS - 1))

    // A deve ter pelo menos MIN_DAYS_BEFORE de história antes da troca
    if (daysBetween(importA.valid_from, beforeEnd) < MIN_DAYS_BEFORE) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: `tabela anterior vigente por apenas ${daysBetween(importA.valid_from, beforeEnd)} dias (mín. ${MIN_DAYS_BEFORE})` })
      continue
    }

    // Período "depois": WINDOW_DAYS após a troca, limitado a ontem
    const afterStart  = switchDate
    const afterEndRaw = addDaysISO(switchDate, WINDOW_DAYS - 1)
    const afterEnd    = afterEndRaw < addDaysISO(today, -1) ? afterEndRaw : addDaysISO(today, -1)

    // Precisa de pelo menos MIN_DAYS_AFTER de dados após a troca (usa valid_from, não import date)
    if (daysBetween(afterStart, afterEnd) < MIN_DAYS_AFTER) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: `apenas ${daysBetween(afterStart, afterEnd)} dias de dados após a vigência (mín. ${MIN_DAYS_AFTER})` })
      continue
    }

    const rowsA = (importA.parsed_data as unknown as ParsedPriceRow[]) ?? []
    const rowsB = (importB.parsed_data as unknown as ParsedPriceRow[]) ?? []
    if (!rowsA.length || !rowsB.length) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: 'tabela sem preços parseados' })
      continue
    }

    // Busca KPIs de ambos os períodos em paralelo — inclui DataTableSuiteCategory
    const [kpiBefore, kpiAfter] = await Promise.all([
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(beforeStart), isoToDDMMYYYY(beforeEnd)).catch(() => null),
      fetchCompanyKPIsFromAutomo(unitSlug, isoToDDMMYYYY(afterStart), isoToDDMMYYYY(afterEnd)).catch(() => null),
    ])

    if (!kpiBefore || !kpiAfter) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: 'falha ao buscar KPIs do ERP' })
      continue
    }

    // KPIs por categoria — isolam o comportamento de cada produto
    const catsBefore = buildCatMap(kpiBefore)
    const catsAfter  = buildCatMap(kpiAfter)

    // KPIs da unidade como fallback quando categoria não tem dados suficientes
    const unitBef = kpiBefore.TotalResult
    const unitAft = kpiAfter.TotalResult
    if (!unitBef.totalRevpar || !unitBef.totalGiro) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: 'RevPAR ou Giro zero no período anterior — sem movimento no ERP' })
      continue
    }

    const unitDeltaRevpar  = deltaPct(unitBef.totalRevpar, unitAft.totalRevpar)
    const unitDeltaGiro    = deltaPct(unitBef.totalGiro, unitAft.totalGiro)
    const unitDeltaOcup    = +((unitAft.totalOccupancyRate - unitBef.totalOccupancyRate) / 100 * 100).toFixed(2)
    const unitDeltaTicket  = deltaPct(unitBef.totalAllTicketAverage, unitAft.totalAllTicketAverage)

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

        // Prefere KPIs da categoria específica; fallback para totais da unidade
        const catB = catsBefore.get(r.categoria)
        const catA = catsAfter.get(r.categoria)
        const usedCategoryLevel = !!(catB && catA && catB.revpar > 0)

        const delta_revpar_pct  = usedCategoryLevel
          ? deltaPct(catB!.revpar, catA!.revpar)
          : unitDeltaRevpar
        const delta_giro_pct    = usedCategoryLevel
          ? deltaPct(catB!.giro, catA!.giro)
          : unitDeltaGiro
        const delta_ocupacao_pp = usedCategoryLevel
          ? +((catA!.occupancyRate - catB!.occupancyRate)).toFixed(2)
          : unitDeltaOcup
        const delta_ticket_pct  = usedCategoryLevel
          ? deltaPct(catB!.totalTicketAverage, catA!.totalTicketAverage)
          : unitDeltaTicket

        // Elasticidade giro-preço: quanto % o giro mudou para cada 1% de variação de preço
        const implied_elasticity = Math.abs(variacao_pct) >= 1
          ? +(delta_giro_pct / variacao_pct).toFixed(3)
          : null

        return {
          unit_id:                unitId,
          proposal_id:            null,
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
          attributed_pricing_pct: null,
          implied_elasticity,
          conditions: {
            source: 'bootstrap',
            import_a: importA.id,
            import_b: importB.id,
            switch_date: switchDate,
            kpi_level: usedCategoryLevel ? 'category' : 'unit',
          },
          verdict: simpleVerdict(variacao_pct, delta_revpar_pct, delta_giro_pct),
          observed_at: new Date(switchDate + 'T12:00:00Z').toISOString(),
        }
      })
      .filter(Boolean)

    if (!inserts.length) {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: 'nenhum preço alterado entre as duas tabelas' })
      continue
    }

    const { error } = await admin.from('rm_pricing_lessons').insert(
      inserts as Database['public']['Tables']['rm_pricing_lessons']['Insert'][],
    )
    if (!error) {
      inserted += inserts.length
      transitions++
      details.push({ switchDate, status: 'processed', inserted: inserts.length })
    } else {
      skipped++
      details.push({ switchDate, status: 'skipped', reason: 'erro ao salvar no banco' })
    }
  }

  let elasticityUpdated = 0
  if (inserted > 0) {
    elasticityUpdated = await computeAndPersistElasticity(unitId).catch(() => 0)
  }

  return { transitions, inserted, skipped, elasticityUpdated, details }
}
