'use client'

import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical, GripHorizontal } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { CompanyKPIResponse, DataTableGiroByWeek, DataTableRevparByWeek, CompanyTotalResult } from '@/lib/kpis/types'

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

type SortDir = 'asc' | 'desc'
type SortState = { key: string; dir: SortDir } | null

function timeToSec(s: string): number {
  const [h, m, sec] = (s ?? '00:00:00').split(':').map(Number)
  return h * 3600 + m * 60 + (sec ?? 0)
}

function nextSort(cur: SortState, key: string): SortState {
  if (cur?.key !== key) return { key, dir: 'desc' }
  if (cur.dir === 'desc') return { key, dir: 'asc' }
  return null
}

// ─── Hook: drag de colunas via HTML5 drag API ─────────────────────────────────

function useColDrag(storageKey: string, defaultCols: string[]) {
  const [colOrder, setColOrder] = useState<string[]>(defaultCols)
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        if (Array.isArray(parsed) && defaultCols.every((c) => parsed.includes(c)) && parsed.length === defaultCols.length) {
          setColOrder(parsed)
          return
        }
      }
    } catch {}
    setColOrder(defaultCols)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function onColDragStart(col: string) { setDragCol(col) }
  function onColDragEnter(col: string) { if (dragCol) setOverCol(col) }
  function onColDrop() {
    if (dragCol && overCol && dragCol !== overCol) {
      setColOrder((prev) => {
        const next = arrayMove(prev, prev.indexOf(dragCol), prev.indexOf(overCol))
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
        return next
      })
    }
    setDragCol(null)
    setOverCol(null)
  }

  return { colOrder, dragCol, overCol, onColDragStart, onColDragEnter, onColDrop }
}

// ─── Header de coluna: sort clicável + drag horizontal ────────────────────────

function DragColTh({ colKey, label, right, sort, onSort, dragCol, overCol, onColDragStart, onColDragEnter, onColDrop }: {
  colKey: string
  label: string
  right?: boolean
  sort: SortState
  onSort: (k: string) => void
  dragCol: string | null
  overCol: string | null
  onColDragStart: (col: string) => void
  onColDragEnter: (col: string) => void
  onColDrop: () => void
}) {
  const active   = sort?.key === colKey
  const isDragging = dragCol === colKey
  const isOver     = overCol === colKey && dragCol !== colKey

  return (
    <th
      draggable
      onDragStart={() => onColDragStart(colKey)}
      onDragEnter={() => onColDragEnter(colKey)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onColDrop}
      onDragEnd={onColDrop}
      className={cn(
        'px-4 py-3 font-medium text-muted-foreground select-none whitespace-nowrap group/col transition-colors',
        right && 'text-right',
        isDragging && 'opacity-40',
        isOver && 'border-l-2 border-primary bg-primary/5',
      )}
    >
      <div className={cn('flex items-center gap-1', right && 'justify-end')}>
        <GripHorizontal className="size-3 opacity-0 group-hover/col:opacity-30 hover:!opacity-80 cursor-grab active:cursor-grabbing shrink-0 transition-opacity" />
        <button
          type="button"
          onClick={() => onSort(colKey)}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', active && 'text-foreground')}
        >
          {label}
          {active
            ? sort!.dir === 'desc' ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />
            : <ChevronsUpDown className="size-3 opacity-30" />
          }
        </button>
      </div>
    </th>
  )
}

// ─── Header fixo (Categorias — não arrastável) ────────────────────────────────

function SortTh({ children, colKey, sort, onSort }: {
  children: React.ReactNode
  colKey: string
  sort: SortState
  onSort: (k: string) => void
}) {
  const active = sort?.key === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className="px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors"
    >
      <div className="flex items-center gap-1">
        {children}
        {active
          ? sort!.dir === 'desc' ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />
          : <ChevronsUpDown className="size-3 opacity-30" />
        }
      </div>
    </th>
  )
}

// ─── TR sortável com handle de drag de linha ──────────────────────────────────

function SortableTR({ id, disabled, children }: {
  id: string
  disabled: boolean
  children: (h: React.HTMLAttributes<HTMLElement>) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })
  return (
    <tr
      ref={setNodeRef as unknown as React.RefCallback<HTMLTableRowElement>}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('border-b hover:bg-muted/30 transition-colors', isDragging && 'opacity-60')}
    >
      {children({ ...attributes, ...listeners })}
    </tr>
  )
}

// ─── Tabela Desempenho por Categoria de Suíte ─────────────────────────────────

type SuiteRow = {
  category: string
  totalRentalsApartments: number
  totalValue: number
  totalTicketAverage: number
  giro: number
  revpar: number
  occupancyRate: number
  averageOccupationTime: string
}

const SUITE_COLS = [
  { key: 'rentals',   label: 'Locações' },
  { key: 'value',     label: 'Faturamento' },
  { key: 'ticket',    label: 'Ticket Médio' },
  { key: 'giro',      label: 'Giro' },
  { key: 'revpar',    label: 'RevPAR' },
  { key: 'occupancy', label: 'Ocupação' },
  { key: 'tmo',       label: 'TMO' },
]

function renderSuiteCell(row: SuiteRow, key: string): React.ReactNode {
  switch (key) {
    case 'rentals':   return row.totalRentalsApartments
    case 'value':     return fmt.format(row.totalValue)
    case 'ticket':    return fmt.format(row.totalTicketAverage)
    case 'giro':      return row.giro.toFixed(2)
    case 'revpar':    return fmt.format(row.revpar)
    case 'occupancy': return `${row.occupancyRate.toFixed(1)}%`
    case 'tmo':       return row.averageOccupationTime
    default:          return '–'
  }
}

function renderSuiteTotalCell(total: CompanyTotalResult, rows: SuiteRow[], key: string): React.ReactNode {
  const sumRentals = rows.reduce((s, r) => s + r.totalRentalsApartments, 0)
  const sumValue   = rows.reduce((s, r) => s + r.totalValue, 0)
  switch (key) {
    case 'rentals':   return sumRentals
    case 'value':     return fmt.format(sumValue)
    case 'ticket':    return sumRentals > 0 ? fmt.format(sumValue / sumRentals) : '–'
    case 'giro':      return total.totalGiro.toFixed(2)
    case 'revpar':    return fmt.format(total.totalRevpar)
    case 'occupancy': return `${total.totalOccupancyRate.toFixed(1)}%`
    case 'tmo':       return total.totalAverageOccupationTime
    default:          return '–'
  }
}

function SuiteCategoryTable({ company }: { company: CompanyKPIResponse }) {
  const rawRows: SuiteRow[] = (company.DataTableSuiteCategory ?? []).flatMap((item) =>
    Object.entries(item).map(([category, kpi]) => ({ category, ...kpi }))
  )
  const total = company.TotalResult

  const [sort, setSort]   = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

  const colDrag = useColDrag('suite-cat-cols', SUITE_COLS.map((c) => c.key))

  useEffect(() => {
    try {
      const v = localStorage.getItem('suite-cat-order')
      if (v) setOrder(JSON.parse(v))
    } catch {}
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!rawRows.length) return null

  function applyOrder(rows: SuiteRow[]): SuiteRow[] {
    if (!order.length) return rows
    const map = new Map(rows.map((r) => [r.category, r]))
    return [
      ...(order.map((c) => map.get(c)).filter(Boolean) as SuiteRow[]),
      ...rows.filter((r) => !order.includes(r.category)),
    ]
  }

  function sortRows(rows: SuiteRow[]): SuiteRow[] {
    if (!sort) return applyOrder(rows)
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'category':  return m * a.category.localeCompare(b.category, 'pt-BR')
        case 'rentals':   return m * (a.totalRentalsApartments - b.totalRentalsApartments)
        case 'value':     return m * (a.totalValue - b.totalValue)
        case 'ticket':    return m * (a.totalTicketAverage - b.totalTicketAverage)
        case 'giro':      return m * (a.giro - b.giro)
        case 'revpar':    return m * (a.revpar - b.revpar)
        case 'occupancy': return m * (a.occupancyRate - b.occupancyRate)
        case 'tmo':       return m * (timeToSec(a.averageOccupationTime) - timeToSec(b.averageOccupationTime))
        default: return 0
      }
    })
  }

  const rows = sortRows(rawRows)

  function handleRowDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.category)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('suite-cat-order', JSON.stringify(next)) } catch {}
  }

  const sp = { sort, onSort: (k: string) => setSort((p) => nextSort(p, k)) }
  const orderedCols = SUITE_COLS.filter((c) => colDrag.colOrder.includes(c.key))
    .sort((a, b) => colDrag.colOrder.indexOf(a.key) - colDrag.colOrder.indexOf(b.key))

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">Desempenho por Categoria de Suíte</h2>
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category" {...sp}>Categoria</SortTh>
              {orderedCols.map((col) => (
                <DragColTh
                  key={col.key}
                  colKey={col.key}
                  label={col.label}
                  right
                  sort={sort}
                  onSort={(k) => setSort((p) => nextSort(p, k))}
                  dragCol={colDrag.dragCol}
                  overCol={colDrag.overCol}
                  onColDragStart={colDrag.onColDragStart}
                  onColDragEnter={colDrag.onColDragEnter}
                  onColDrop={colDrag.onColDrop}
                />
              ))}
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
            <SortableContext items={rows.map((r) => r.category)} strategy={verticalListSortingStrategy}>
              <tbody>
                {rows.map((row) => (
                  <SortableTR key={row.category} id={row.category} disabled={!!sort}>
                    {(h) => (
                      <>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2 group">
                            <div
                              {...h}
                              className={cn(
                                'p-0.5 rounded shrink-0 transition-opacity',
                                sort
                                  ? 'hidden'
                                  : 'opacity-0 group-hover:opacity-30 hover:!opacity-80 cursor-grab active:cursor-grabbing',
                              )}
                            >
                              <GripVertical className="size-3.5 text-muted-foreground" />
                            </div>
                            {row.category}
                          </div>
                        </td>
                        {orderedCols.map((col) => (
                          <td key={col.key} className="px-4 py-3 text-right tabular-nums">
                            {renderSuiteCell(row, col.key)}
                          </td>
                        ))}
                      </>
                    )}
                  </SortableTR>
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
          {total && (
            <tfoot>
              <tr className="bg-muted/40 border-t-2 border-border font-semibold">
                <td className="px-4 py-3">Total</td>
                {orderedCols.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-right tabular-nums">
                    {renderSuiteTotalCell(total, rows, col.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────

const DAY_ORDER = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
const DAY_LABEL: Record<string, string> = {
  'segunda-feira': 'Seg', 'terça-feira': 'Ter', 'quarta-feira': 'Qua',
  'quinta-feira':  'Qui', 'sexta-feira':  'Sex', 'sábado':       'Sáb',
  'domingo':       'Dom',
}

// ─── Tabela Giro por Dia da Semana ────────────────────────────────────────────

type GiroRow = { cat: string; days: DataTableGiroByWeek[string] }

function GiroWeekTable({ title, data }: { title: string; data: DataTableGiroByWeek[] }) {
  const rawRows: GiroRow[] = (data ?? []).map((item) => {
    const [cat, days] = Object.entries(item)[0]
    return { cat, days }
  })

  const [sort, setSort]   = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

  const colDrag = useColDrag('giro-week-cols', DAY_ORDER)

  useEffect(() => {
    try {
      const v = localStorage.getItem('giro-week-order')
      if (v) setOrder(JSON.parse(v))
    } catch {}
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!rawRows.length) return null

  const dayCols      = DAY_ORDER.filter((d) => d in rawRows[0].days)
  const visibleCols  = colDrag.colOrder.filter((d) => dayCols.includes(d))

  const totalByDay: Record<string, number> = {}
  for (const d of dayCols) {
    const v = rawRows.find((r) => r.days[d] !== undefined)?.days[d]
    if (v) totalByDay[d] = v.totalGiro
  }

  function applyOrder(rows: GiroRow[]): GiroRow[] {
    if (!order.length) return rows
    const map = new Map(rows.map((r) => [r.cat, r]))
    return [
      ...(order.map((c) => map.get(c)).filter(Boolean) as GiroRow[]),
      ...rows.filter((r) => !order.includes(r.cat)),
    ]
  }

  function sortRows(rows: GiroRow[]): GiroRow[] {
    if (!sort) return applyOrder(rows)
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sort.key === 'category') return m * a.cat.localeCompare(b.cat, 'pt-BR')
      const aVal = a.days[sort.key]?.giro ?? (sort.dir === 'asc' ? Infinity : -Infinity)
      const bVal = b.days[sort.key]?.giro ?? (sort.dir === 'asc' ? Infinity : -Infinity)
      return m * (aVal - bVal)
    })
  }

  const rows = sortRows(rawRows)

  function handleRowDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.cat)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('giro-week-order', JSON.stringify(next)) } catch {}
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category" sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))}>Categorias</SortTh>
              {visibleCols.map((d) => (
                <DragColTh
                  key={d}
                  colKey={d}
                  label={DAY_LABEL[d] ?? d}
                  right
                  sort={sort}
                  onSort={(k) => setSort((p) => nextSort(p, k))}
                  dragCol={colDrag.dragCol}
                  overCol={colDrag.overCol}
                  onColDragStart={colDrag.onColDragStart}
                  onColDragEnter={colDrag.onColDragEnter}
                  onColDrop={colDrag.onColDrop}
                />
              ))}
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
            <SortableContext items={rows.map((r) => r.cat)} strategy={verticalListSortingStrategy}>
              <tbody>
                {rows.map(({ cat, days }) => (
                  <SortableTR key={cat} id={cat} disabled={!!sort}>
                    {(h) => (
                      <>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          <div className="flex items-center gap-2 group">
                            <div
                              {...h}
                              className={cn(
                                'p-0.5 rounded shrink-0 transition-opacity',
                                sort
                                  ? 'hidden'
                                  : 'opacity-0 group-hover:opacity-30 hover:!opacity-80 cursor-grab active:cursor-grabbing',
                              )}
                            >
                              <GripVertical className="size-3.5 text-muted-foreground" />
                            </div>
                            {cat}
                          </div>
                        </td>
                        {visibleCols.map((d) => (
                          <td key={d} className="px-4 py-3 text-right tabular-nums">
                            {days[d] !== undefined ? days[d].giro.toFixed(2) : '–'}
                          </td>
                        ))}
                      </>
                    )}
                  </SortableTR>
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
          <tfoot>
            <tr className="bg-muted/40 border-t-2 border-border font-semibold">
              <td className="px-4 py-3 whitespace-nowrap">Total</td>
              {visibleCols.map((d) => (
                <td key={d} className="px-4 py-3 text-right tabular-nums">
                  {totalByDay[d] !== undefined ? totalByDay[d].toFixed(2) : '–'}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Tabela RevPAR por Dia da Semana ──────────────────────────────────────────

type RevparRow = { cat: string; days: DataTableRevparByWeek[string] }

function RevparWeekTable({ title, data }: { title: string; data: DataTableRevparByWeek[] }) {
  const rawRows: RevparRow[] = (data ?? []).map((item) => {
    const [cat, days] = Object.entries(item)[0]
    return { cat, days }
  })

  const [sort, setSort]   = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

  const colDrag = useColDrag('revpar-week-cols', DAY_ORDER)

  useEffect(() => {
    try {
      const v = localStorage.getItem('revpar-week-order')
      if (v) setOrder(JSON.parse(v))
    } catch {}
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!rawRows.length) return null

  const dayCols     = DAY_ORDER.filter((d) => d in rawRows[0].days)
  const visibleCols = colDrag.colOrder.filter((d) => dayCols.includes(d))

  const totalByDay: Record<string, number> = {}
  for (const d of dayCols) {
    const v = rawRows.find((r) => r.days[d] !== undefined)?.days[d]
    if (v) totalByDay[d] = v.totalRevpar
  }

  function applyOrder(rows: RevparRow[]): RevparRow[] {
    if (!order.length) return rows
    const map = new Map(rows.map((r) => [r.cat, r]))
    return [
      ...(order.map((c) => map.get(c)).filter(Boolean) as RevparRow[]),
      ...rows.filter((r) => !order.includes(r.cat)),
    ]
  }

  function sortRows(rows: RevparRow[]): RevparRow[] {
    if (!sort) return applyOrder(rows)
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sort.key === 'category') return m * a.cat.localeCompare(b.cat, 'pt-BR')
      const aVal = a.days[sort.key]?.revpar ?? (sort.dir === 'asc' ? Infinity : -Infinity)
      const bVal = b.days[sort.key]?.revpar ?? (sort.dir === 'asc' ? Infinity : -Infinity)
      return m * (aVal - bVal)
    })
  }

  const rows = sortRows(rawRows)

  function handleRowDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.cat)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('revpar-week-order', JSON.stringify(next)) } catch {}
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category" sort={sort} onSort={(k) => setSort((p) => nextSort(p, k))}>Categorias</SortTh>
              {visibleCols.map((d) => (
                <DragColTh
                  key={d}
                  colKey={d}
                  label={DAY_LABEL[d] ?? d}
                  right
                  sort={sort}
                  onSort={(k) => setSort((p) => nextSort(p, k))}
                  dragCol={colDrag.dragCol}
                  overCol={colDrag.overCol}
                  onColDragStart={colDrag.onColDragStart}
                  onColDragEnter={colDrag.onColDragEnter}
                  onColDrop={colDrag.onColDrop}
                />
              ))}
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
            <SortableContext items={rows.map((r) => r.cat)} strategy={verticalListSortingStrategy}>
              <tbody>
                {rows.map(({ cat, days }) => (
                  <SortableTR key={cat} id={cat} disabled={!!sort}>
                    {(h) => (
                      <>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          <div className="flex items-center gap-2 group">
                            <div
                              {...h}
                              className={cn(
                                'p-0.5 rounded shrink-0 transition-opacity',
                                sort
                                  ? 'hidden'
                                  : 'opacity-0 group-hover:opacity-30 hover:!opacity-80 cursor-grab active:cursor-grabbing',
                              )}
                            >
                              <GripVertical className="size-3.5 text-muted-foreground" />
                            </div>
                            {cat}
                          </div>
                        </td>
                        {visibleCols.map((d) => (
                          <td key={d} className="px-4 py-3 text-right tabular-nums">
                            {days[d] !== undefined ? fmt.format(days[d].revpar) : '–'}
                          </td>
                        ))}
                      </>
                    )}
                  </SortableTR>
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
          <tfoot>
            <tr className="bg-muted/40 border-t-2 border-border font-semibold">
              <td className="px-4 py-3 whitespace-nowrap">Total</td>
              {visibleCols.map((d) => (
                <td key={d} className="px-4 py-3 text-right tabular-nums">
                  {totalByDay[d] !== undefined ? fmt.format(totalByDay[d]) : '–'}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Export principal ──────────────────────────────────────────────────────────

interface DashboardChartsProps {
  company: CompanyKPIResponse | null
}

export function DashboardCharts({ company }: DashboardChartsProps) {
  if (!company) return null

  return (
    <div className="flex flex-col gap-6">
      <SuiteCategoryTable company={company} />

      <RevparWeekTable
        title="RevPAR por Dia da Semana"
        data={company.DataTableRevparByWeek ?? []}
      />

      <GiroWeekTable
        title="Giro por Dia da Semana"
        data={company.DataTableGiroByWeek ?? []}
      />
    </div>
  )
}
