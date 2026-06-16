/**
 * Gera uma proposta em GRADE COMPLETA dia da semana × faixa horária a partir de uma
 * tabela vigente legada (semana/fds, sem distinção de horário).
 *
 * A tabela vigente é apenas a fonte do PREÇO ATUAL. A proposta FLUTUA:
 *   preço = atual × (1 + fator_dia) × (1 + fator_faixa)   [capado, nunca reduz se neverReduce]
 *   - fator_dia  = clamp(giro_do_dia / giro_médio_categoria − 1, 0, dayCap)   (método do gestor por dia)
 *   - fator_faixa = prêmio na faixa de MAIOR demanda, só quando a demanda confirma (share > 55%)
 *
 * Resultado: grade sem buracos (todos canais × dias × faixas) com preços que variam célula a célula.
 * Aceita um overlay opcional (linhas propostas pelo agente) que sobrescreve as células correspondentes.
 */
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import type { BandDemand } from '@/lib/automo/band-demand'

// dias "curtos" (formato do modelo) ↔ dias completos (DataTableGiroByWeek)
const DOW_FULL: Record<string, string> = {
  domingo: 'domingo', segunda: 'segunda-feira', terca: 'terça-feira',
  quarta: 'quarta-feira', quinta: 'quinta-feira', sexta: 'sexta-feira', sabado: 'sábado',
}
const SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta']
const FDS    = ['sexta', 'sabado']
const ALL    = [...SEMANA, 'sexta', 'sabado']
const BANDS  = ['d', 'n'] as const
type Band = typeof BANDS[number]

export interface GridProposalRow {
  canal: string
  categoria: string
  periodo: string
  dias: string[]
  dia_tipo: string
  hora_inicio: string
  hora_fim: string
  preco_atual: number
  preco_proposto: number
  variacao_pct: number
  justificativa: string
}

export interface DayBandParams {
  dayCap: number        // teto do fator por dia (fração, ex 0.05)
  bandCap: number       // teto do prêmio por faixa (fração)
  maxVar: number        // teto absoluto de variação (%) — guardrail do agente
  neverReduce: boolean
  decimals?: number
  /** Modo do gestor (giro_uplift): faixa única de PICO em vez de diurno/noturno. */
  primeTime?: boolean
  /** Prêmio aplicado à faixa de pico sobre o padrão (fração, ex 0.05). Só usado em primeTime. */
  peakPremium?: number
  /** Hora de início da faixa de pico (default 15). Só usado em primeTime. */
  peakStart?: number
  /** Hora de fim da faixa de pico (default 21). Só usado em primeTime. */
  peakEnd?: number
  /** Volume de reservas por `${NORM(categoria)}|${low(periodo)}` — demanda PRÓPRIA usada para
   *  precificar produtos programados (site_programada: day use/pernoite/diária) por gradiente
   *  de volume entre os programados da categoria. Não herda o giro do balcão. */
  schedVol?: Map<string, number>
}

export interface OverlayRow {
  canal: string
  categoria: string
  periodo: string
  dias?: string[]
  dia_tipo?: string
  hora_inicio?: string
  preco_proposto: number
  justificativa?: string
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function norm(s: string) { return (s ?? '').trim().toUpperCase() }
function nlow(s: string) { return (s ?? '').trim().toLowerCase() }

// Produtos de janela fixa (sem faixa diurna/noturna): day use, diária, pernoite.
const FIXED_WINDOW_RE = /day\s*use|di[áa]ria|pernoite/i

/**
 * Faixa horária (06–18 / 18–06) só faz sentido para CHECK-IN imediato (balcão/site imediato)
 * em produtos de curta estadia (3h/6h/12h). Site Programada e produtos de janela fixa
 * (Day Use 13–19, Diária 15–12, Pernoite 20–12) têm horário próprio → um preço por dia, sem banda.
 */
function usesBands(canal: string, periodo: string): boolean {
  return nlow(canal) === 'balcao_site' && !FIXED_WINDOW_RE.test(periodo)
}

function daysOfTipo(dia_tipo: string): string[] {
  if (dia_tipo === 'semana') return SEMANA
  if (dia_tipo === 'fds_feriado') return FDS
  return ALL
}

export function isLegacyTable(activeRows: ParsedPriceRow[]): boolean {
  return activeRows.length > 0 &&
    activeRows.every((r) => !!r.dia_tipo && !((r as { dias?: string[] }).dias?.length))
}

export function generateDayBandGrid(
  activeRows: ParsedPriceRow[],
  company: CompanyKPIResponse | null,
  bandDemand: Map<string, BandDemand>,
  params: DayBandParams,
  overlay: OverlayRow[] = [],
): GridProposalRow[] {
  const decimals = params.decimals ?? 0
  const f = Math.pow(10, decimals)
  const round = (v: number) => Math.round(v * f) / f

  // giro médio por categoria
  // giro por categoria × dia (nome completo)
  const giroDay = new Map<string, Record<string, number>>()
  for (const item of company?.DataTableGiroByWeek ?? []) {
    for (const [cat, days] of Object.entries(item)) {
      const m: Record<string, number> = {}
      for (const [dia, v] of Object.entries(days)) m[dia] = v.giro
      giroDay.set(norm(cat), m)
    }
  }

  // Overlay: célula (canal|categoria|periodo|dia|band) → {preco, justificativa}
  const overlayCell = new Map<string, { preco: number; just?: string }>()
  for (const o of overlay) {
    const dias = (o.dias?.length ? o.dias : daysOfTipo(o.dia_tipo ?? '')).map(nlow)
    const bands: Band[] = o.hora_inicio === '06:00' ? ['d'] : o.hora_inicio === '18:00' ? ['n'] : ['d', 'n']
    for (const d of dias) for (const b of bands) {
      overlayCell.set(`${nlow(o.canal)}|${norm(o.categoria)}|${nlow(o.periodo)}|${d}|${b}`, { preco: o.preco_proposto, just: o.justificativa })
    }
  }

  // Preço atual por (canal|categoria|periodo|dia) a partir da tabela legada
  const atualByDay = new Map<string, number>()
  for (const r of activeRows) {
    for (const d of daysOfTipo(r.dia_tipo)) {
      atualByDay.set(`${nlow(r.canal)}|${norm(r.categoria)}|${nlow(r.periodo)}|${d}`, Number(r.preco) || 0)
    }
  }

  // Esqueleto: combinações únicas de canal|categoria|periodo
  const combos = new Map<string, { canal: string; categoria: string; periodo: string }>()
  for (const r of activeRows) combos.set(`${nlow(r.canal)}|${norm(r.categoria)}|${nlow(r.periodo)}`, { canal: r.canal, categoria: r.categoria, periodo: r.periodo })

  // Demanda própria dos programados: min/máx de volume entre day use/pernoite/diária por categoria.
  // Usado para gradiente — o programado mais vendido da categoria sobe até o teto; o menos, mantém.
  const schedByCat = new Map<string, { min: number; max: number }>()
  if (params.schedVol) {
    for (const [k, vol] of params.schedVol) {
      const per = k.split('|')[1] ?? ''
      if (!FIXED_WINDOW_RE.test(per)) continue   // só day use / pernoite / diária
      const cat = k.split('|')[0]
      const e = schedByCat.get(cat) ?? { min: Infinity, max: -Infinity }
      if (vol < e.min) e.min = vol
      if (vol > e.max) e.max = vol
      schedByCat.set(cat, e)
    }
  }

  const cellRows: GridProposalRow[] = []
  for (const { canal, categoria, periodo } of combos.values()) {
    const catKey = norm(categoria)
    const days = giroDay.get(catKey) ?? {}
    const bd = bandDemand.get(catKey)
    const total = bd ? bd.diurno + bd.noturno : 0

    // Gradiente min–máx por categoria: o dia mais fraco da semana → 0, o mais forte → teto,
    // os do meio proporcionalmente. Evita o achatamento de "giro/média − 1" (que zera todo dia
    // abaixo da média inflada por sex/sáb). Assim qua/qui, se giram mais que seg/ter, sobem um pouco.
    const giroVals = ALL.map((d) => days[DOW_FULL[d]] ?? 0)
    const giroMin = Math.min(...giroVals)
    const giroMax = Math.max(...giroVals)
    const span = giroMax - giroMin

    // Produtos programados (site_programada): fator pela DEMANDA PRÓPRIA (volume de reservas),
    // não pelo giro do balcão. Gradiente entre os programados da categoria → uniforme por dia.
    const isSchedProg = nlow(canal) === 'site_programada'
    let schedFactor = 0
    if (isSchedProg && params.schedVol) {
      const stats = schedByCat.get(catKey)
      const vol = params.schedVol.get(`${catKey}|${nlow(periodo)}`) ?? 0
      if (stats && stats.max > stats.min) {
        schedFactor = clamp((vol - stats.min) / (stats.max - stats.min) * params.dayCap, 0, params.dayCap)
      }
    }
    const schedJust = schedFactor > 0
      ? `${nlow(periodo)} é o programado de maior volume desta categoria → +${(schedFactor * 100).toFixed(1)}%`
      : 'programado de baixa demanda — mantido'

    for (const dia of ALL) {
      const atual = atualByDay.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}`) ?? 0
      if (atual <= 0) continue
      const giroD = days[DOW_FULL[dia]] ?? 0
      // Curta estadia do balcão (3h/6h/12h) → fator de giro por dia (DataTableGiroByWeek).
      // site_programada (Day Use/Pernoite/Diária) → fator pela demanda própria (schedFactor),
      // uniforme por dia. Pernoite promo do balcão (janela fixa, não programada) → 0 (mantém).
      const dayFactor = usesBands(canal, periodo)
        ? (span > 0 ? clamp((giroD - giroMin) / span * params.dayCap, 0, params.dayCap) : 0)
        : (isSchedProg ? schedFactor : 0)

      // ── Modo Prime Time (método do gestor / giro_uplift) ──────────────────
      // Em vez de diurno/noturno: PADRÃO (fora de pico) + PICO (faixa peakStart–peakEnd).
      // Padrão = atual × (1 + fator de giro do dia), com teto/never_reduce.
      // Pico   = padrão × (1 + prêmio de pico) — o prêmio fica ACIMA do teto de reajuste
      // (o teto limita o padrão vs atual; o pico é +X% sobre o padrão, como na planilha do gestor).
      if (params.primeTime) {
        const premium  = params.peakPremium ?? 0
        const pStart   = params.peakStart ?? 15
        const pEnd     = params.peakEnd ?? 21
        const pad2     = (n: number) => String(n).padStart(2, '0')
        const picoIni  = `${pad2(pStart)}:00`
        const picoFim  = `${pad2(pEnd)}:00`
        const padIni   = `${pad2(pEnd)}:00`         // padrão (wrap) começa quando o pico acaba
        const padFim   = `${pad2(pStart - 1)}:59`   // …e vai até 1 min antes do pico
        const picoLabel = `${pStart}h–${pEnd}h`
        const baseline = atual * (1 + dayFactor)
        const ov = overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|d`)
                ?? overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|n`)
                ?? overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|all`)
        const padraoRaw = (ov && ov.preco > baseline) ? ov.preco : baseline
        let padVar = clamp((padraoRaw - atual) / atual * 100, params.neverReduce ? 0 : -params.maxVar, params.maxVar)
        const padrao = round(atual * (1 + padVar / 100))
        padVar = atual > 0 ? +((padrao - atual) / atual * 100).toFixed(1) : 0
        const padJust = (ov && ov.preco > baseline)
          ? (ov.just || 'Ajuste do agente acima do piso de giro')
          : isSchedProg
            ? schedJust
            : (dayFactor > 0
                ? `giro do dia ${giroD.toFixed(2)} (gradiente ${giroMin.toFixed(2)}–${giroMax.toFixed(2)}) → +${(dayFactor * 100).toFixed(1)}%`
                : 'Dia mais fraco da semana — mantido')

        if (usesBands(canal, periodo)) {
          // Fora de pico (padrão) — cobre o dia todo exceto a faixa de pico
          cellRows.push({
            canal, categoria, periodo, dias: [dia], dia_tipo: '',
            hora_inicio: padIni, hora_fim: padFim,
            preco_atual: atual, preco_proposto: padrao, variacao_pct: padVar,
            justificativa: `Padrão (fora de pico) · ${padJust}`,
          })
          // Pico (peakStart–peakEnd) = padrão × (1 + prêmio)
          const pico = round(padrao * (1 + premium))
          const picoVar = atual > 0 ? +((pico - atual) / atual * 100).toFixed(1) : 0
          cellRows.push({
            canal, categoria, periodo, dias: [dia], dia_tipo: '',
            hora_inicio: picoIni, hora_fim: picoFim,
            preco_atual: atual, preco_proposto: pico, variacao_pct: picoVar,
            justificativa: `Prime time ${picoLabel} (padrão +${(premium * 100).toFixed(0)}%)`,
          })
        } else {
          // Janela fixa (day use / pernoite / diária / site programada): um preço por dia, sem pico
          cellRows.push({
            canal, categoria, periodo, dias: [dia], dia_tipo: '',
            hora_inicio: '', hora_fim: '',
            preco_atual: atual, preco_proposto: padrao, variacao_pct: padVar, justificativa: padJust,
          })
        }
        continue
      }

      // ── Modo padrão (diurno/noturno) ──────────────────────────────────────
      // Bandas só para balcão imediato + curta estadia; senão um preço por dia ('all').
      const bands: Array<Band | 'all'> = usesBands(canal, periodo) ? ['d', 'n'] : ['all']
      for (const band of bands) {
        // fator de faixa: prêmio só na faixa de maior demanda quando share > 55%
        let bandFactor = 0
        if (band !== 'all' && total > 0) {
          const share = (band === 'd' ? bd!.diurno : bd!.noturno) / total
          if (share > 0.55) bandFactor = clamp((share - 0.5) / 0.5 * params.bandCap, 0, params.bandCap)
        }

        // Baseline determinístico (gradiente de giro × faixa) — é o PISO do dia.
        const baseline = atual * (1 + dayFactor) * (1 + bandFactor)
        const overlayHit = band === 'all'
          ? (overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|all`)
             ?? overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|d`)
             ?? overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|n`))
          : overlayCell.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}|${band}`)
        let proposto: number
        let just: string
        if (overlayHit && overlayHit.preco > baseline) {
          // Agente só pode SUBIR acima do piso (concorrência/eventos) — nunca achatar o gradiente.
          proposto = overlayHit.preco
          just = overlayHit.just || 'Ajuste do agente acima do piso de giro'
        } else if (isSchedProg) {
          proposto = baseline
          just = schedJust
        } else {
          proposto = baseline
          const parts: string[] = []
          if (dayFactor > 0) parts.push(`giro do dia ${giroD.toFixed(2)} (gradiente da semana ${giroMin.toFixed(2)}–${giroMax.toFixed(2)}) → +${(dayFactor * 100).toFixed(1)}%`)
          if (bandFactor > 0) parts.push(`faixa ${band === 'd' ? 'diurna' : 'noturna'} com maior demanda (+${(bandFactor * 100).toFixed(1)}%)`)
          just = parts.length ? parts.join(' · ') : 'Dia mais fraco da semana — mantido'
        }

        // teto absoluto + never_reduce
        let variacao = atual > 0 ? (proposto - atual) / atual * 100 : 0
        variacao = clamp(variacao, params.neverReduce ? 0 : -params.maxVar, params.maxVar)
        proposto = round(atual * (1 + variacao / 100))
        variacao = atual > 0 ? +((proposto - atual) / atual * 100).toFixed(1) : 0

        cellRows.push({
          canal, categoria, periodo, dias: [dia], dia_tipo: '',
          hora_inicio: band === 'd' ? '06:00' : band === 'n' ? '18:00' : '',
          hora_fim: band === 'd' ? '17:59' : band === 'n' ? '05:59' : '',
          preco_atual: atual, preco_proposto: proposto, variacao_pct: variacao, justificativa: just,
        })
      }
    }
  }

  // Cada dia da semana é uma LINHA própria — nunca agregamos dias com preço igual.
  // O preço já flutua célula a célula pelo gradiente de giro; manter uma linha por dia
  // deixa o gestor ajustar qualquer dia isoladamente (mesmo que hoje coincidam).
  const dayIdx = (d: string) => ALL.indexOf(nlow(d))
  // padrão/diurno (col A) antes de pico/noturno (col B); janela fixa por último.
  // Pico começa em peakStart; padrão (wrap) começa em peakEnd.
  const ps = `${String(params.peakStart ?? 15).padStart(2, '0')}:00`
  const pe = `${String(params.peakEnd ?? 21).padStart(2, '0')}:00`
  const bandIdx = (h: string) => (h === '06:00' || h === pe ? 0 : h === '18:00' || h === ps ? 1 : 2)
  return cellRows.sort((a, b) =>
    nlow(a.canal).localeCompare(nlow(b.canal)) ||
    norm(a.categoria).localeCompare(norm(b.categoria)) ||
    nlow(a.periodo).localeCompare(nlow(b.periodo)) ||
    dayIdx(a.dias[0]) - dayIdx(b.dias[0]) ||
    bandIdx(a.hora_inicio) - bandIdx(b.hora_inicio)
  )
}

/**
 * Explode linhas multi-dia (ex: dias: ["segunda","terca"]) em uma linha por dia,
 * preservando preço/justificativa. Usado quando a tabela vigente já está em formato
 * dia × faixa e o agente propôs dias agrupados — garantimos uma linha por dia.
 */
export function explodeRowsToPerDay<T extends { dias?: string[]; dia_tipo?: string }>(
  rows: T[],
): T[] {
  const out: T[] = []
  for (const r of rows) {
    const dias = (r.dias?.length ? r.dias : daysOfTipo(r.dia_tipo ?? '')).map(nlow)
    for (const d of dias) out.push({ ...r, dias: [d], dia_tipo: '' })
  }
  return out
}

/**
 * Resumo FIEL da proposta, calculado a partir das linhas realmente salvas (não do LLM).
 * Garante que a descrição no chat e no card nunca contradiga a tabela.
 */
export function summarizeProposalRows(
  rows: Array<{ categoria: string; variacao_pct: number }>,
): string {
  const n = rows.length
  if (!n) return 'Nenhuma linha na proposta.'
  const up   = rows.filter((r) => r.variacao_pct >= 0.1)
  const down = rows.filter((r) => r.variacao_pct <= -0.1)
  const kept = n - up.length - down.length
  const avgUp = up.length ? up.reduce((s, r) => s + r.variacao_pct, 0) / up.length : 0
  const maxUp = up.length ? Math.max(...up.map((r) => r.variacao_pct)) : 0

  // Categorias com aumento vs mantidas integralmente
  const byCat = new Map<string, { up: number; tot: number }>()
  for (const r of rows) {
    const c = byCat.get(r.categoria) ?? { up: 0, tot: 0 }
    c.tot++
    if (r.variacao_pct >= 0.1) c.up++
    byCat.set(r.categoria, c)
  }
  const catsUp   = [...byCat].filter(([, v]) => v.up > 0).map(([c]) => c)
  const catsKept = [...byCat].filter(([, v]) => v.up === 0).map(([c]) => c)

  const parts: string[] = [
    `${n} linhas: ${up.length} com aumento${down.length ? `, ${down.length} com redução` : ''}, ${kept} mantidas.`,
  ]
  if (up.length) parts.push(`Aumento médio +${avgUp.toFixed(1)}% (máx +${maxUp.toFixed(1)}%).`)
  if (catsUp.length)   parts.push(`Categorias ajustadas: ${catsUp.join(', ')}.`)
  if (catsKept.length) parts.push(`Mantidas integralmente: ${catsKept.join(', ')}.`)
  if (!down.length)    parts.push('Nenhum preço reduzido.')
  return parts.join(' ')
}
