'use client'

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Pencil, Trash2, Save, X,
  CalendarPlus, CalendarClock, TrendingUp, TrendingDown, Minus, Shield,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { PriceProposal, ProposedPriceRow } from '@/app/api/agente/proposals/route'
import { RejectionDialog } from '@/components/agente/rejection-dialog'
import { useCurrency } from '@/components/currency-context'

interface PendingReview {
  id: string
  scheduled_at: string
  checkpoint_days: number  // 7 | 14 | 28
}

interface ProposalsListProps {
  unitSlug: string
  unitId: string
  initialProposals: PriceProposal[]
  refreshKey?: number
  selectedProposalId?: string | null
  /** false = gerente: só visualiza + pode agendar/reagendar revisão da última proposta aprovada */
  canManage?: boolean
  /** Chamado quando uma proposta com status 'pending' é excluída — permite atualizar badge externo */
  onPendingDeleted?: () => void
}

const STATUS_CONFIG = {
  pending:  { label: 'Aguardando aprovação', icon: Clock,         className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  approved: { label: 'Aprovada',             icon: CheckCircle2,  className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  rejected: { label: 'Rejeitada',            icon: XCircle,       className: 'bg-red-500/10 text-red-600 border-red-500/20' },
}

const CANAL_LABELS: Record<string, string> = {
  balcao_site:     'Balcão / Site',
  site_programada: 'Site Programada',
  guia_moteis:     'Guia de Motéis',
}

const DAY_ABBR: Record<string, string> = {
  segunda: 'Seg', terca: 'Ter', quarta: 'Qua', quinta: 'Qui',
  sexta: 'Sex', sabado: 'Sáb', domingo: 'Dom',
}
const DOW_ORDER = ['segunda','terca','quarta','quinta','sexta','sabado','domingo']

// ─── Tabela Pivô (faixa horária) ─────────────────────────────────────────────

interface PivotCell {
  row: ProposedPriceRow
  flatIndex: number
}

interface PivotedRow {
  key: string
  canal: string
  categoria: string
  periodo: string
  diasLabel: string
  /** true = formato legado (dia_tipo), ambas as células apontam para o mesmo row */
  isLegacy: boolean
  diurno: PivotCell | null  // hora_inicio 06:00 ou legado
  noturno: PivotCell | null // hora_inicio 18:00 ou legado (mesmo row)
}

function buildPivotRows(rows: ProposedPriceRow[]): PivotedRow[] {
  const map = new Map<string, PivotedRow>()
  rows.forEach((row, flatIndex) => {
    const isNewFormat = !!row.dias?.length
    const diasKey = isNewFormat
      ? [...row.dias!].sort().join(',')
      : (row.dia_tipo || '')
    const key = `${row.canal}|${row.categoria}|${row.periodo}|${diasKey}`

    if (!map.has(key)) {
      const diasLabel = isNewFormat
        ? [...row.dias!]
            .sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b))
            .map((d) => DAY_ABBR[d] ?? d)
            .join('/')
        : row.dia_tipo === 'semana' ? 'Semana'
          : row.dia_tipo === 'fds_feriado' ? 'FDS/Fer.'
          : row.dia_tipo || '—'
      map.set(key, { key, canal: row.canal, categoria: row.categoria, periodo: row.periodo, diasLabel, isLegacy: !isNewFormat, diurno: null, noturno: null })
    }

    const pivot = map.get(key)!
    if (!isNewFormat) {
      pivot.diurno = { row, flatIndex }
      pivot.noturno = { row, flatIndex }
    } else if (row.hora_inicio === '06:00') {
      pivot.diurno = { row, flatIndex }
    } else {
      pivot.noturno = { row, flatIndex }
    }
  })
  return Array.from(map.values())
}

// ─── Spreadsheet layout ──────────────────────────────────────────────────────

const GRID_DAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const
type GridDay = typeof GRID_DAYS[number]
const GRID_DAY_LABELS: Record<GridDay, string> = {
  domingo: 'Dom', segunda: 'Seg', terca: 'Ter', quarta: 'Qua', quinta: 'Qui', sexta: 'Sex', sabado: 'Sáb',
}
const CANAL_ORDER = ['balcao_site', 'site_programada', 'guia_moteis']

function sortPeriods(periods: string[]): string[] {
  // Ordem obrigatória: curtas por hora (3h, 6h, 12h…) → Pernoite (promo balcão, só ADC)
  // → Day Use → Pernoite → Diária (programadas). Os produtos programados ficam após as horas.
  const rank = (p: string) => {
    // normaliza acentos: "diária" → "diaria"
    const lo = p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    if (lo.includes('day use') || lo.includes('dayuse')) return 14
    if (lo.includes('pernoite')) return 15
    if (lo.includes('diaria')) return 16
    // períodos por hora: extrai o número (evita "12 horas" casar com "2 hora")
    const m = lo.match(/(\d+)\s*h/)
    if (m) return parseInt(m[1], 10)   // 1, 2, 3, 4, 6, 12 …
    return 99
  }
  return [...periods].sort((a, b) => rank(a) - rank(b))
}

interface SpCell {
  atual: number
  proposto: number
  variacao: number
  justificativa: string
  was_clamped?: boolean
  clamp_info?: ProposedPriceRow['clamp_info']
  /** Índice da linha de origem em proposal.rows — usado para editar a célula in-place. */
  rowIndex: number
}

type SpCellKey = `${GridDay}_d` | `${GridDay}_n`
type SpCellMap = Partial<Record<SpCellKey, SpCell>>

interface SpRow {
  canal: string
  periodo: string
  categoria: string
  cells: SpCellMap
}

function spExpandDays(row: ProposedPriceRow): GridDay[] {
  if (row.dias?.length) return row.dias as GridDay[]
  if (row.dia_tipo === 'semana')      return ['domingo', 'segunda', 'terca', 'quarta', 'quinta']
  if (row.dia_tipo === 'fds_feriado') return ['sexta', 'sabado']
  return [...GRID_DAYS]
}

function spGetBands(row: ProposedPriceRow): Array<'d' | 'n'> {
  if (!row.dias?.length) return ['d', 'n']
  const hi = row.hora_inicio, hf = row.hora_fim
  if (!hi) return ['d', 'n']            // janela fixa (sem banda) → preenche ambas
  if (hi === '06:00') return ['d']      // legado diurno → coluna A
  if (hi === '18:00') return ['n']      // legado noturno → coluna B
  // Modo gestor (giro_uplift), faixa de pico configurável (15–21h, 15–22h, …):
  // PICO = janela direta (início < fim no mesmo dia) → coluna B;
  // PADRÃO (fora de pico) = wrap (início >= fim, atravessa a meia-noite) → coluna A.
  // Independe do valor exato de peakEnd — compatível com propostas antigas e novas.
  return (hf && hi < hf) ? ['n'] : ['d']
}

function buildSpreadsheetRows(rows: ProposedPriceRow[]): SpRow[] {
  const map = new Map<string, SpRow>()
  rows.forEach((row, idx) => {
    const key = `${row.canal}|${row.periodo}|${row.categoria}`
    if (!map.has(key)) {
      map.set(key, { canal: row.canal, periodo: row.periodo, categoria: row.categoria, cells: {} })
    }
    const sr = map.get(key)!
    const days  = spExpandDays(row)
    const bands = spGetBands(row)
    const cell: SpCell = {
      atual: row.preco_atual, proposto: row.preco_proposto, variacao: row.variacao_pct,
      justificativa: row.justificativa, was_clamped: row.was_clamped, clamp_info: row.clamp_info,
      rowIndex: idx,
    }
    for (const day of days) {
      for (const band of bands) {
        const ck = `${day}_${band}` as SpCellKey
        // new format (dias[]) overrides legacy (dia_tipo)
        if (!sr.cells[ck] || row.dias?.length) sr.cells[ck] = cell
      }
    }
  })
  return Array.from(map.values())
}

function SpreadsheetCellTd({
  cell,
  mode,
  formatMoney,
  editable,
  onPriceChange,
}: {
  cell: SpCell | undefined
  mode: 'proposal' | 'current'
  formatMoney: (v: number, d?: number) => string
  editable?: boolean
  onPriceChange?: (price: number) => void
}) {
  if (!cell) return <td className="border border-border/30 bg-muted/5" />

  const v    = cell.variacao
  const isUp   = v > 0.5
  const isDown = v < -0.5

  // ── Modo edição: input direto na célula da planilha ──
  if (editable) {
    const ebg = isUp ? 'bg-green-500/10 dark:bg-green-500/15'
      : isDown ? 'bg-red-500/10 dark:bg-red-500/15'
      : 'bg-amber-500/8 dark:bg-amber-500/12'
    const efg = isUp ? 'text-green-700 dark:text-green-300'
      : isDown ? 'text-red-600 dark:text-red-400'
      : 'text-amber-700 dark:text-amber-300'
    return (
      <td className={cn('border border-border/30 px-1 py-1 text-right align-middle min-w-[64px]', ebg)}>
        <div className="flex flex-col items-end gap-px">
          <span className="text-[9px] leading-tight text-muted-foreground/45 tabular-nums">
            {formatMoney(cell.atual)}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cell.proposto}
            onChange={(e) => onPriceChange?.(parseFloat(e.target.value) || 0)}
            className={cn(
              'w-[52px] bg-transparent border-b border-primary/50 focus:border-primary outline-none text-right text-[11px] font-semibold leading-tight tabular-nums',
              efg,
            )}
          />
          <span className={cn('text-[8px] leading-none tabular-nums', efg)}>
            {v >= 0 ? '+' : ''}{v.toFixed(1)}%
          </span>
        </div>
      </td>
    )
  }

  const bg = mode === 'proposal'
    ? isUp   ? 'bg-green-500/12 dark:bg-green-500/18'
    : isDown ? 'bg-red-500/12 dark:bg-red-500/18'
    :          'bg-amber-500/10 dark:bg-amber-500/14'
    : ''

  const fg = mode === 'proposal'
    ? isUp   ? 'text-green-700 dark:text-green-300'
    : isDown ? 'text-red-600 dark:text-red-400'
    :          'text-amber-700 dark:text-amber-300'
    : 'text-foreground'

  const tdContent = mode === 'proposal' ? (
    <div className="flex flex-col items-end gap-px">
      <span className="text-[9px] leading-tight text-muted-foreground/45 tabular-nums">
        {formatMoney(cell.atual)}
      </span>
      <span className={cn('text-[11px] font-semibold leading-tight tabular-nums', fg)}>
        {formatMoney(cell.proposto)}
      </span>
    </div>
  ) : (
    <span className="text-xs tabular-nums font-medium">{formatMoney(cell.atual)}</span>
  )

  if (mode === 'current') {
    return (
      <td className={cn('border border-border/30 px-2 py-1.5 text-right align-middle min-w-[56px]', bg)}>
        {tdContent}
      </td>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <td className={cn('border border-border/30 px-2 py-1.5 text-right align-middle cursor-default min-w-[56px]', bg)}>
          {tdContent}
        </td>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">
        <div className="space-y-1">
          <div>
            <span className={cn('font-semibold', isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-amber-400')}>
              {v >= 0 ? '+' : ''}{v.toFixed(1)}%
            </span>
            {' '}{isUp ? '↑ aumento' : isDown ? '↓ redução' : '≈ sem alteração'}
          </div>
          {cell.justificativa && (
            <div className="text-muted-foreground">{cell.justificativa}</div>
          )}
          {cell.was_clamped && cell.clamp_info && (
            <div className="text-amber-400 flex items-center gap-1">
              <Shield className="size-3 shrink-0" />
              Guardrail: modelo propôs {formatMoney(cell.clamp_info.original_price)}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function SpreadsheetView({ rows, formatMoney, editable, onCellChange }: {
  rows: ProposedPriceRow[]
  formatMoney: (v: number, d?: number) => string
  /** Quando true, as células viram inputs editáveis (mesma planilha da apresentação). */
  editable?: boolean
  /** Edição de uma célula → índice da linha de origem + novo preço. */
  onCellChange?: (rowIndex: number, price: number) => void
}) {
  const [viewMode, setViewMode]   = useState<'proposal' | 'current'>('proposal')
  const [activeCanal, setActiveCanal] = useState<string>('')

  const canals = useMemo(() => {
    const cs = [...new Set(rows.map(r => r.canal))]
    return cs.sort((a, b) => {
      const ai = CANAL_ORDER.indexOf(a); const bi = CANAL_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
  }, [rows])

  const canal   = activeCanal || canals[0] || ''
  const spRows  = useMemo(() => buildSpreadsheetRows(rows), [rows])
  const canRows = useMemo(() => spRows.filter(r => r.canal === canal), [spRows, canal])
  const periods = useMemo(() => sortPeriods([...new Set(canRows.map(r => r.periodo))]), [canRows])

  // Faixa horária (06–18 / 18–06) só aparece se o canal tem linhas com banda definida.
  // Site Programada e janelas fixas → um preço por dia (sem sub-colunas de faixa).
  // Tem sub-colunas de faixa quando há linhas com hora_inicio definida (06/18 legado OU pico/padrão).
  const useBands = useMemo(
    () => rows.some(r => r.canal === canal && !!r.hora_inicio),
    [rows, canal],
  )
  // Modo gestor (giro_uplift): qualquer hora_inicio não-legada (≠ 06:00/18:00) indica faixa de pico configurável.
  const isPrimeTime = useMemo(
    () => rows.some(r => r.canal === canal && !!r.hora_inicio && r.hora_inicio !== '06:00' && r.hora_inicio !== '18:00'),
    [rows, canal],
  )
  // Deriva o rótulo do pico das horas reais da própria proposta (15–21h, 15–22h, …).
  const picoRow = useMemo(
    () => rows.find(r => r.canal === canal && r.hora_inicio && r.hora_fim && r.hora_inicio !== '06:00' && r.hora_inicio < r.hora_fim),
    [rows, canal],
  )
  const hh = (s?: string) => (s ? String(parseInt(s.slice(0, 2), 10)) : '')
  const bandLabelA = isPrimeTime ? 'fora de pico' : '06–18h'
  const bandLabelB = isPrimeTime
    ? (picoRow ? `pico ${hh(picoRow.hora_inicio)}–${hh(picoRow.hora_fim)}h` : 'pico')
    : '18–06h'
  const headerColSpan = 1 + GRID_DAYS.length * (useBands ? 2 : 1)

  return (
    <TooltipProvider delayDuration={150}>
      <div>
        {/* Canal tabs + view mode toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2.5 border-b bg-muted/20">
          <div className="flex gap-1 flex-wrap">
            {canals.map(c => (
              <button
                key={c}
                onClick={() => setActiveCanal(c)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                  canal === c
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:bg-accent/50'
                )}
              >
                {CANAL_LABELS[c] ?? c}
              </button>
            ))}
          </div>
          {editable ? (
            <span className="text-[11px] text-primary font-medium px-2 py-1 rounded bg-primary/10">
              ✎ Editando — altere os preços direto nas células
            </span>
          ) : (
            <div className="flex border rounded-md overflow-hidden text-xs">
              <button
                onClick={() => setViewMode('proposal')}
                className={cn(
                  'px-3 py-1.5 font-medium transition-colors',
                  viewMode === 'proposal'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                Proposta
              </button>
              <button
                onClick={() => setViewMode('current')}
                className={cn(
                  'px-3 py-1.5 font-medium border-l transition-colors',
                  viewMode === 'current'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                Tabela vigente
              </button>
            </div>
          )}
        </div>

        {/* Legend (only in proposal mode) */}
        {viewMode === 'proposal' && (
          <div className="flex items-center gap-3 px-4 py-2 border-b text-[10px] text-muted-foreground bg-muted/10">
            <span className="font-medium">Legenda:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-green-500/20" />aumento
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-red-500/20" />redução
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-amber-500/15" />manutenção
            </span>
            <span className="text-muted-foreground/60">· Hover na célula para ver justificativa</span>
          </div>
        )}

        {/* Spreadsheet grid — viewport próprio com scroll (X e Y) e cabeçalho fixo */}
        <div className="overflow-auto max-h-[70vh] p-4">
          <table className="border-collapse text-xs w-max">
            {/* Sticky nas CÉLULAS th (não no thead) — sticky em thead/tr não funciona com border-collapse no Chrome */}
            <thead>
              <tr>
                <th className="border border-border/40 bg-muted px-3 py-1.5 text-left font-semibold text-[11px] sticky left-0 top-0 z-30 min-w-[110px] h-[30px]">
                  Categoria
                </th>
                {GRID_DAYS.map(day => (
                  <th
                    key={day}
                    colSpan={useBands ? 2 : 1}
                    className="border border-border/40 bg-muted px-2 py-1.5 text-center font-semibold text-[11px] min-w-[112px] sticky top-0 z-20 h-[30px]"
                  >
                    {GRID_DAY_LABELS[day]}
                  </th>
                ))}
              </tr>
              {useBands && (
              <tr>
                <th className="border border-border/40 bg-muted sticky left-0 top-[30px] z-30" />
                {GRID_DAYS.flatMap(day => [
                  <th
                    key={`${day}_d_h`}
                    className="border border-border/40 bg-muted px-1.5 py-1 text-[10px] text-muted-foreground font-normal text-center whitespace-nowrap sticky top-[30px] z-20"
                  >
                    {bandLabelA}
                  </th>,
                  <th
                    key={`${day}_n_h`}
                    className="border border-border/40 bg-muted px-1.5 py-1 text-[10px] text-muted-foreground font-normal text-center whitespace-nowrap sticky top-[30px] z-20"
                  >
                    {bandLabelB}
                  </th>,
                ])}
              </tr>
              )}
            </thead>
            <tbody>
              {periods.map(periodo => {
                const pRows = canRows.filter(r => r.periodo === periodo)
                const cats  = [...new Set(pRows.map(r => r.categoria))].sort()
                return (
                  <Fragment key={periodo}>
                    <tr>
                      <td
                        colSpan={headerColSpan}
                        className="border border-border/40 bg-muted/60 px-3 py-1 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground"
                      >
                        {periodo}
                      </td>
                    </tr>
                    {cats.map(cat => {
                      const srow = pRows.find(r => r.categoria === cat)!
                      return (
                        <tr key={cat} className="group hover:bg-primary/5">
                          <td className="border border-border/40 px-3 py-1.5 font-medium text-[11px] sticky left-0 bg-background z-[5] group-hover:bg-primary/5 whitespace-nowrap">
                            {cat}
                          </td>
                          {useBands
                            ? GRID_DAYS.flatMap(day => [
                                <SpreadsheetCellTd key={`${day}_d`} cell={srow.cells[`${day}_d` as SpCellKey]} mode={viewMode} formatMoney={formatMoney} editable={editable} onPriceChange={(p) => { const c = srow.cells[`${day}_d` as SpCellKey]; if (c) onCellChange?.(c.rowIndex, p) }} />,
                                <SpreadsheetCellTd key={`${day}_n`} cell={srow.cells[`${day}_n` as SpCellKey]} mode={viewMode} formatMoney={formatMoney} editable={editable} onPriceChange={(p) => { const c = srow.cells[`${day}_n` as SpCellKey]; if (c) onCellChange?.(c.rowIndex, p) }} />,
                              ])
                            : GRID_DAYS.map(day => {
                                const c = srow.cells[`${day}_d` as SpCellKey] ?? srow.cells[`${day}_n` as SpCellKey]
                                return (
                                  <SpreadsheetCellTd key={day} cell={c} mode={viewMode} formatMoney={formatMoney} editable={editable} onPriceChange={(p) => { if (c) onCellChange?.(c.rowIndex, p) }} />
                                )
                              })
                          }
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  )
}

// ─── FIM Spreadsheet layout ───────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Calcula o impacto estimado de uma proposta no ticket médio.
 * Assume volume (locações) constante — deixa isso explícito na UI.
 */
function calcImpact(rows: ProposedPriceRow[]) {
  if (!rows.length) return null
  const up    = rows.filter((r) => r.variacao_pct >  0.5)
  const down  = rows.filter((r) => r.variacao_pct < -0.5)
  const flat  = rows.filter((r) => Math.abs(r.variacao_pct) <= 0.5)
  const avgCurrent  = rows.reduce((s, r) => s + r.preco_atual,    0) / rows.length
  const avgProposed = rows.reduce((s, r) => s + r.preco_proposto, 0) / rows.length
  const deltaTicket = avgCurrent > 0 ? ((avgProposed - avgCurrent) / avgCurrent) * 100 : 0
  return { up: up.length, down: down.length, flat: flat.length, deltaTicket, avgCurrent, avgProposed }
}

function ExpandableText({ text, maxLength = 120 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false)
  if (text.length <= maxLength) return <span>{text}</span>
  return (
    <span>
      {expanded ? text : text.slice(0, maxLength) + '…'}
      {' '}
      <button
        className="text-primary underline-offset-2 hover:underline text-[11px] font-medium shrink-0"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
      >
        {expanded ? 'Ler menos' : 'Ler mais'}
      </button>
    </span>
  )
}

export function ProposalsList({ unitSlug, unitId, initialProposals, refreshKey, selectedProposalId, canManage = true, onPendingDeleted }: ProposalsListProps) {
  const supabase = useMemo(() => createClient(), [])
  const { formatMoney } = useCurrency()
  const [proposals, setProposals] = useState<PriceProposal[]>(initialProposals)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Reviews agendadas por proposal_id (até 3 — +7d, +14d, +28d)
  const [pendingReviews, setPendingReviews] = useState<Map<string, PendingReview[]>>(new Map())
  // schedOpen: id do scheduled_review com picker aberto (não proposal_id, pra permitir 3 pickers)
  const [schedOpen, setSchedOpen] = useState<string | null>(null)
  const [schedDate, setSchedDate] = useState<Date | undefined>()
  const [schedTime, setSchedTime] = useState('10:00')
  const [schedWorking, setSchedWorking] = useState(false)
  // Para "Agendar revisão" em propostas legadas (sem reviews): proposalId que está agendando do zero
  const [schedNewProposalId, setSchedNewProposalId] = useState<string | null>(null)

  // Edição inline
  const [editing, setEditing] = useState<{ id: string; rows: ProposedPriceRow[] } | null>(null)
  const [saving, setSaving] = useState(false)

  // Exclusão com confirmação
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filtro de status
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [onlyClamped, setOnlyClamped] = useState(false)

  useEffect(() => {
    fetch(`/api/agente/proposals?unitSlug=${unitSlug}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProposals(data as PriceProposal[]) })
      .catch(() => {})
  }, [refreshKey, unitSlug])

  // Carrega revisões pendentes — múltiplas por proposta (1 por checkpoint_days: 7/14/28)
  const loadPendingReviews = useCallback(async () => {
    if (!unitSlug) return
    try {
      const res = await fetch(`/api/agente/scheduled-reviews?unitSlug=${unitSlug}`)
      const data = await res.json()
      if (!Array.isArray(data)) return
      const map = new Map<string, PendingReview[]>()
      for (const r of data) {
        if (r.proposal_id && r.status === 'pending') {
          const list = map.get(r.proposal_id) ?? []
          list.push({
            id: r.id,
            scheduled_at: r.scheduled_at,
            checkpoint_days: r.checkpoint_days ?? 7,
          })
          map.set(r.proposal_id, list)
        }
      }
      // Ordena cada array por checkpoint_days asc (7, 14, 28)
      for (const [k, v] of map) {
        map.set(k, v.sort((a, b) => a.checkpoint_days - b.checkpoint_days))
      }
      setPendingReviews(map)
    } catch { /* silencioso */ }
  }, [unitSlug])

  useEffect(() => { loadPendingReviews() }, [loadPendingReviews])

  // Realtime: price_proposals + scheduled_reviews desta unidade
  useEffect(() => {
    if (!unitId) return

    // Re-fetch completo — usado apenas como fallback para UPDATE sem payload completo
    const refetchAll = () => {
      fetch(`/api/agente/proposals?unitSlug=${unitSlug}`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setProposals(data as PriceProposal[]) })
        .catch(() => {})
    }

    const ch = supabase
      .channel(`proposals:${unitId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'price_proposals', filter: `unit_id=eq.${unitId}` },
        (payload) => {
          const row = payload.new as PriceProposal
          // Adiciona diretamente ao estado — sem round-trip HTTP
          setProposals((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev
            return [row, ...prev]
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'price_proposals', filter: `unit_id=eq.${unitId}` },
        (payload) => {
          // payload.new tem todos os campos quando REPLICA IDENTITY FULL está ativo.
          // Quando tem `rows` (campo JSONB), atualiza diretamente; senão faz re-fetch.
          const partial = payload.new as Partial<PriceProposal> & { id: string }
          if (partial.rows) {
            setProposals((prev) => prev.map((p) => p.id === partial.id ? { ...p, ...partial } as PriceProposal : p))
          } else {
            refetchAll()
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'price_proposals', filter: `unit_id=eq.${unitId}` },
        (payload) => {
          const id = (payload.old as { id: string }).id
          if (id) setProposals((prev) => prev.filter((p) => p.id !== id))
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_reviews', filter: `unit_id=eq.${unitId}` }, () => { loadPendingReviews() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [unitId, unitSlug, supabase, loadPendingReviews])

  // Auto-expande e scrolla para a proposta vinda da Agenda
  useEffect(() => {
    if (!selectedProposalId) return
    setExpanded((prev) => new Set([...prev, selectedProposalId]))
    setTimeout(() => {
      cardRefs.current[selectedProposalId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [selectedProposalId])

  // Proposta aprovada mais recente (é a que está vigente na tabela atual)
  const latestApprovedId = proposals.find((p) => p.status === 'approved')?.id ?? null

  const filteredProposals = (statusFilter === 'all'
    ? proposals
    : proposals.filter((p) => p.status === statusFilter)
  ).filter((p) => !onlyClamped || p.rows.some((r) => r.was_clamped))

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleReview = useCallback(async (
    id: string,
    status: 'approved' | 'rejected',
    rejectionData?: { reasonType: string; reasonText: string },
  ) => {
    setReviewing(id)
    setError(null)
    try {
      const res = await fetch('/api/agente/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          status,
          ...(rejectionData ? {
            rejection_reason_type: rejectionData.reasonType,
            rejection_reason_text: rejectionData.reasonText,
          } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao revisar proposta')
      setProposals((prev) => prev.map((p) => p.id === id ? data as PriceProposal : p))
      await loadPendingReviews()
      // HV1: backend já cria 3 reviews (+7d/+14d/+28d) automaticamente ao aprovar.
      // Picker não abre automaticamente — usuário pode reagendar individualmente
      // cada checkpoint nos chips abaixo do header da proposta.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setReviewing(null)
    }
  }, [loadPendingReviews])

  const [rejectionTarget, setRejectionTarget] = useState<string | null>(null)

  const startEditing = useCallback((proposal: PriceProposal) => {
    setEditing({ id: proposal.id, rows: proposal.rows.map((r) => ({ ...r })) })
    setExpanded((prev) => new Set([...prev, proposal.id]))
    setError(null)
  }, [])

  const updateEditRow = useCallback((index: number, newPrice: number) => {
    setEditing((prev) => {
      if (!prev) return null
      const rows = [...prev.rows]
      const row = rows[index]
      const variacao_pct = row.preco_atual
        ? Math.round(((newPrice - row.preco_atual) / row.preco_atual) * 1000) / 10
        : 0
      rows[index] = { ...row, preco_proposto: newPrice, variacao_pct }
      return { ...prev, rows }
    })
  }, [])


  const handleSaveEdit = useCallback(async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/agente/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, rows: editing.rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar edição')
      setProposals((prev) => prev.map((p) => p.id === editing.id ? data as PriceProposal : p))
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [editing])

  // Abre picker para REAGENDAR uma review específica (já existe)
  const openReschedulePicker = useCallback((review: PendingReview) => {
    const d = parseISO(review.scheduled_at)
    setSchedDate(d)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    setSchedTime(`${h}:${m}`)
    setSchedNewProposalId(null)
    setSchedOpen(review.id)
  }, [])

  // Abre picker para CRIAR uma review nova (proposta legada sem reviews)
  const openNewSchedPicker = useCallback((proposalId: string) => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    setSchedDate(d)
    setSchedTime('10:00')
    setSchedNewProposalId(proposalId)
    setSchedOpen(`new:${proposalId}`)  // sentinel diferente do reviewId
  }, [])

  // Confirma agendamento (reagendar review existente OU criar review nova)
  const handleConfirmSchedule = useCallback(async () => {
    if (!schedDate || !schedOpen) return

    const [hh, mm] = schedTime.split(':').map(Number)
    const dt = new Date(schedDate)
    dt.setHours(hh, mm, 0, 0)

    setSchedWorking(true)
    setError(null)
    try {
      if (schedOpen.startsWith('new:') && schedNewProposalId) {
        // Criar review nova para proposta legada
        const proposal = proposals.find((p) => p.id === schedNewProposalId)
        if (!proposal) throw new Error('Proposta não encontrada')
        const today = new Date().toISOString().slice(0, 10)
        const res = await fetch('/api/agente/scheduled-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit_id: proposal.unit_id,
            proposal_id: schedNewProposalId,
            scheduled_at: dt.toISOString(),
            checkpoint_days: 7,
            note: `Acompanhamento +7d — verificar impacto da proposta aprovada em ${today} nos KPIs de giro, RevPAR e ocupação.`,
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao agendar')
      } else {
        // Reagendar review existente (schedOpen é o id da review)
        const res = await fetch('/api/agente/scheduled-reviews', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: schedOpen, scheduled_at: dt.toISOString() }),
        })
        if (!res.ok) throw new Error('Erro ao reagendar')
      }
      setSchedOpen(null)
      setSchedNewProposalId(null)
      await loadPendingReviews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSchedWorking(false)
    }
  }, [schedDate, schedTime, schedOpen, schedNewProposalId, proposals, loadPendingReviews])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setError(null)
    try {
      const wasPending = proposals.find((p) => p.id === confirmDelete)?.status === 'pending'
      const res = await fetch(`/api/agente/proposals?id=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erro ao excluir proposta')
      }
      setProposals((prev) => prev.filter((p) => p.id !== confirmDelete))
      if (editing?.id === confirmDelete) setEditing(null)
      if (wasPending) onPendingDeleted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete, editing, proposals, onPendingDeleted])

  return (
    <div className="flex flex-col gap-4">
      {/* Header — mesmo padrão do DiscountProposalsList */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => {
            const labels = { all: 'Todas', pending: 'Pendentes', approved: 'Aprovadas', rejected: 'Rejeitadas' }
            const counts = {
              all:      proposals.length,
              pending:  proposals.filter((p) => p.status === 'pending').length,
              approved: proposals.filter((p) => p.status === 'approved').length,
              rejected: proposals.filter((p) => p.status === 'rejected').length,
            }
            const active = statusFilter === s
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-full border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                )}
              >
                {labels[s]} ({counts[s]})
              </button>
            )
          })}
          {(() => {
            const clampedCount = proposals.filter((p) => p.rows.some((r) => r.was_clamped)).length
            if (clampedCount === 0) return null
            return (
              <button
                onClick={() => setOnlyClamped((v) => !v)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1',
                  onlyClamped
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                )}
                title="Filtrar apenas propostas com linhas ajustadas por guardrail"
              >
                <Shield className="size-3" />
                Com guardrail tocado ({clampedCount})
              </button>
            )
          })()}
        </div>

      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Lista de propostas */}
      {proposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Sparkles className="size-8 text-muted-foreground/40" />
          <p className="font-medium">Nenhuma proposta ainda</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Inicie uma conversa no Chat e peça ao agente para gerar uma proposta de preços.
          </p>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma proposta com esse status.</p>
          <button onClick={() => setStatusFilter('all')} className="text-xs text-primary underline-offset-2 hover:underline">
            Ver todas
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredProposals.map((proposal) => {
            const cfg = STATUS_CONFIG[proposal.status]
            const StatusIcon = cfg.icon
            const isExpanded = expanded.has(proposal.id)
            const isPending = proposal.status === 'pending'
            const isApproved = proposal.status === 'approved'
            const isLatestApproved = proposal.id === latestApprovedId
            const isReviewing = reviewing === proposal.id
            const isEditing = editing?.id === proposal.id
            const isHighlighted = selectedProposalId === proposal.id
            const proposalReviews = pendingReviews.get(proposal.id) ?? []
            const impact = calcImpact(proposal.rows)

            return (
              <div
                key={proposal.id}
                ref={(el) => { cardRefs.current[proposal.id] = el }}
                className={cn(
                  'rounded-xl border bg-card overflow-hidden transition-colors',
                  isHighlighted && 'ring-2 ring-primary/40'
                )}
              >
                {/* Cabeçalho do card */}
                <div className="flex items-start gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={cn('gap-1.5 text-xs', cfg.className)}>
                        <StatusIcon className="size-3" />
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(proposal.created_at)}
                      </span>
                      {proposal.creator_name && (
                        <span className="text-xs text-muted-foreground">
                          · por <span className="font-medium">{proposal.creator_name}</span>
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {(() => {
                          const altered = proposal.rows.filter((r) => Math.abs(r.variacao_pct) > 0.5).length
                          return altered > 0
                            ? `${altered} alterada${altered === 1 ? '' : 's'} / ${proposal.rows.length} linhas`
                            : `${proposal.rows.length} ${proposal.rows.length === 1 ? 'linha' : 'linhas'}`
                        })()}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/50 select-all" title={proposal.id}>
                        {proposal.id.slice(0, 8)}
                      </span>
                    </div>

                    {/* Resumo de impacto estimado */}
                    {impact && (
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {impact.up > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-green-600">
                            <TrendingUp className="size-3" />
                            {impact.up} {impact.up === 1 ? 'aumento' : 'aumentos'}
                          </span>
                        )}
                        {impact.down > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-red-500">
                            <TrendingDown className="size-3" />
                            {impact.down} {impact.down === 1 ? 'redução' : 'reduções'}
                          </span>
                        )}
                        {impact.flat > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Minus className="size-3" />
                            {impact.flat} sem alteração
                          </span>
                        )}
                        {(() => {
                          const clampedCount = proposal.rows.filter((r) => r.was_clamped).length
                          if (clampedCount === 0) return null
                          return (
                            <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                              <Shield className="size-3" />
                              {clampedCount} ajustada{clampedCount === 1 ? '' : 's'} por guardrail
                            </span>
                          )
                        })()}
                        <span className={cn(
                          'text-[11px] font-medium tabular-nums',
                          impact.deltaTicket > 0 ? 'text-green-600' : impact.deltaTicket < 0 ? 'text-red-500' : 'text-muted-foreground'
                        )}>
                          · Ticket médio {impact.deltaTicket >= 0 ? '+' : ''}{impact.deltaTicket.toFixed(1)}% (volume constante)
                        </span>
                      </div>
                    )}

                    {proposal.context && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <ExpandableText text={proposal.context} maxLength={360} />
                      </p>
                    )}

                    {/* HV1: chips de revisão por checkpoint (+7d, +14d, +28d) */}
                    {isApproved && isLatestApproved && proposalReviews.length > 0 && (
                      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                          Acompanhamento:
                        </span>
                        {proposalReviews.map((review) => (
                          <Popover
                            key={review.id}
                            open={schedOpen === review.id}
                            onOpenChange={(open) => { if (!open) setSchedOpen(null) }}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 text-[11px] h-6 px-2 text-blue-600 border-blue-500/30 hover:bg-blue-500/10"
                                onClick={() => openReschedulePicker(review)}
                                title={`Revisão em ${review.checkpoint_days} dias após aprovação`}
                              >
                                <CalendarClock className="size-3" />
                                +{review.checkpoint_days}d · {format(parseISO(review.scheduled_at), "dd/MM 'às' HH'h'mm", { locale: ptBR })}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-3 flex flex-col gap-3" align="start">
                              <p className="text-xs font-medium text-muted-foreground">
                                Reagendar revisão +{review.checkpoint_days}d:
                              </p>
                              <Calendar
                                mode="single"
                                selected={schedDate}
                                onSelect={setSchedDate}
                                disabled={(date) => date <= new Date()}
                                locale={ptBR}
                                className="p-0"
                              />
                              <div className="flex flex-col gap-1.5 border-t pt-3">
                                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                                  <Clock className="size-3" />
                                  Horário da revisão
                                </Label>
                                <Input
                                  type="time"
                                  value={schedTime}
                                  onChange={(e) => setSchedTime(e.target.value)}
                                  className="h-8 text-sm appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
                                />
                              </div>
                              <Button
                                size="sm"
                                className="w-full gap-1.5"
                                disabled={!schedDate || schedWorking}
                                onClick={handleConfirmSchedule}
                              >
                                {schedWorking
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <CalendarPlus className="size-3.5" />
                                }
                                Confirmar reagendamento
                              </Button>
                            </PopoverContent>
                          </Popover>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Botão "Agendar revisão" — só pra propostas aprovadas legadas (sem reviews HV1) */}
                    {isApproved && isLatestApproved && proposalReviews.length === 0 && (
                      <Popover
                        open={schedOpen === `new:${proposal.id}`}
                        onOpenChange={(open) => { if (!open) { setSchedOpen(null); setSchedNewProposalId(null) } }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs h-7"
                            onClick={() => openNewSchedPicker(proposal.id)}
                          >
                            <CalendarPlus className="size-3.5" />
                            Agendar revisão
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3 flex flex-col gap-3" align="end">
                          <p className="text-xs font-medium text-muted-foreground">Agendar revisão:</p>
                          <Calendar
                            mode="single"
                            selected={schedDate}
                            onSelect={setSchedDate}
                            disabled={(date) => date <= new Date()}
                            locale={ptBR}
                            className="p-0"
                          />
                          <div className="flex flex-col gap-1.5 border-t pt-3">
                            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Clock className="size-3" />
                              Horário da revisão
                            </Label>
                            <Input
                              type="time"
                              value={schedTime}
                              onChange={(e) => setSchedTime(e.target.value)}
                              className="h-8 text-sm appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="w-full gap-1.5"
                            disabled={!schedDate || schedWorking}
                            onClick={handleConfirmSchedule}
                          >
                            {schedWorking
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <CalendarPlus className="size-3.5" />
                            }
                            Confirmar agendamento
                          </Button>
                        </PopoverContent>
                      </Popover>
                    )}

                    {/* Botão excluir — apenas admins */}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirmDelete(proposal.id)}
                        title="Excluir proposta"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                    {/* Toggle expand */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => toggleExpand(proposal.id)}
                    >
                      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  </div>
                </div>

                {/* Tabela de linhas (colapsável) */}
                {isExpanded && (
                  <div className="border-t">
                    <div className="overflow-x-auto">
                      {isEditing ? (
                        /* ── Modo edição: MESMA planilha da apresentação, com células editáveis ── */
                        <SpreadsheetView
                          rows={editing.rows}
                          formatMoney={formatMoney}
                          editable
                          onCellChange={updateEditRow}
                        />
                      ) : (
                        /* ── Modo visualização: planilha por dia × faixa horária ── */
                        <SpreadsheetView rows={proposal.rows} formatMoney={formatMoney} />
                      )}
                    </div>

                    {/* Painel de simulação de receita */}
                    {!isEditing && impact && (
                      <div className="border-t px-4 py-3 bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Simulação (volume constante)
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Ticket médio atual:{' '}
                          <span className="font-medium text-foreground">
                            {formatMoney(impact.avgCurrent, 2)}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Ticket projetado:{' '}
                          <span className="font-medium text-foreground">
                            {formatMoney(impact.avgProposed, 2)}
                          </span>
                        </span>
                        <span className={cn(
                          'text-xs font-semibold',
                          impact.deltaTicket > 0 ? 'text-green-600' : impact.deltaTicket < 0 ? 'text-red-500' : 'text-muted-foreground'
                        )}>
                          {impact.deltaTicket >= 0 ? '▲' : '▼'}{' '}
                          {Math.abs(impact.deltaTicket).toFixed(1)}% por locação
                        </span>
                      </div>
                    )}

                    {/* Barra de ações */}
                    {canManage && isEditing ? (
                      <div className="flex justify-end gap-2 p-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={saving}
                          onClick={() => setEditing(null)}
                        >
                          <X className="size-3.5" />
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={saving}
                          onClick={handleSaveEdit}
                        >
                          {saving
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Save className="size-3.5" />
                          }
                          Salvar Edições
                        </Button>
                      </div>
                    ) : canManage && isPending ? (
                      <div className="flex justify-end gap-2 p-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-red-600 hover:text-red-600 border-red-500/20 hover:bg-red-500/10"
                          disabled={isReviewing}
                          onClick={() => setRejectionTarget(proposal.id)}
                        >
                          {isReviewing
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <XCircle className="size-3.5" />
                          }
                          Rejeitar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={isReviewing}
                          onClick={() => startEditing(proposal)}
                        >
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={isReviewing}
                          onClick={() => handleReview(proposal.id, 'approved')}
                        >
                          {isReviewing
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <CheckCircle2 className="size-3.5" />
                          }
                          Aprovar Proposta
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A proposta será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RejectionDialog
        open={rejectionTarget !== null}
        onOpenChange={(open) => !open && setRejectionTarget(null)}
        kind="price"
        loading={reviewing === rejectionTarget}
        onConfirm={async (reasonType, reasonText) => {
          if (!rejectionTarget) return
          const id = rejectionTarget
          setRejectionTarget(null)
          await handleReview(id, 'rejected', { reasonType, reasonText })
        }}
      />
    </div>
  )
}
