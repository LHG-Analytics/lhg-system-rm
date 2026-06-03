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

    for (const dia of ALL) {
      const atual = atualByDay.get(`${nlow(canal)}|${catKey}|${nlow(periodo)}|${dia}`) ?? 0
      if (atual <= 0) continue
      const giroD = days[DOW_FULL[dia]] ?? 0
      const dayFactor = span > 0 ? clamp((giroD - giroMin) / span * params.dayCap, 0, params.dayCap) : 0

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

  // Agrupa dias com mesmo preço dentro de (canal|categoria|periodo|band) → dias[]
  const grouped = new Map<string, GridProposalRow>()
  for (const r of cellRows) {
    const key = `${nlow(r.canal)}|${norm(r.categoria)}|${nlow(r.periodo)}|${r.hora_inicio}|${r.preco_proposto}`
    const ex = grouped.get(key)
    if (ex) ex.dias.push(r.dias[0])
    else grouped.set(key, { ...r, dias: [...r.dias] })
  }
  return Array.from(grouped.values())
}
