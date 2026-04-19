'use client'

import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical } from 'lucide-react'
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
import type { CompanyKPIResponse, DataTableGiroByWeek, DataTableRevparByWeek } from '@/lib/kpis/types'

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

// ─── Header clicável com ícone de sort ────────────────────────────────────────

function SortTh({ children, colKey, sort, onSort, right = false }: {
  children: React.ReactNode
  colKey: string
  sort: SortState
  onSort: (k: string) => void
  right?: boolean
}) {
  const active = sort?.key === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className={cn(
        'px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap',
        'hover:text-foreground transition-colors',
        right && 'text-right',
      )}
    >
      <div className={cn('flex items-center gap-1', right && 'justify-end')}>
        {children}
        {active
          ? sort!.dir === 'desc'
            ? <ChevronDown className="size-3" />
            : <ChevronUp className="size-3" />
          : <ChevronsUpDown className="size-3 opacity-30" />
        }
      </div>
    </th>
  )
}

// ─── TR sortável com handle de drag ───────────────────────────────────────────

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

// ─── Tabela Desempenho por Categoria ──────────────────────────────────────────

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

function SuiteCategoryTable({ company }: { company: CompanyKPIResponse }) {
  const rawRows: SuiteRow[] = (company.DataTableSuiteCategory ?? []).flatMap((item) =>
    Object.entries(item).map(([category, kpi]) => ({ category, ...kpi }))
  )
  const total = company.TotalResult

  const [sort, setSort] = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

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

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.category)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('suite-cat-order', JSON.stringify(next)) } catch {}
  }

  const sp = { sort, onSort: (k: string) => setSort((p) => nextSort(p, k)) }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">Desempenho por Categoria de Suíte</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category"  {...sp}>Categoria</SortTh>
              <SortTh colKey="rentals"   right {...sp}>Locações</SortTh>
              <SortTh colKey="value"     right {...sp}>Faturamento</SortTh>
              <SortTh colKey="ticket"    right {...sp}>Ticket Médio</SortTh>
              <SortTh colKey="giro"      right {...sp}>Giro</SortTh>
              <SortTh colKey="revpar"    right {...sp}>RevPAR</SortTh>
              <SortTh colKey="occupancy" right {...sp}>Ocupação</SortTh>
              <SortTh colKey="tmo"       right {...sp}>TMO</SortTh>
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                        <td className="px-4 py-3 text-right tabular-nums">{row.totalRentalsApartments}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.totalValue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.totalTicketAverage)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.giro.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.revpar)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.occupancyRate.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.averageOccupationTime}</td>
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
                <td className="px-4 py-3 text-right tabular-nums">{total.totalAllRentalsApartments}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalAllValue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalAllTicketAverage)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total.totalGiro.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt.format(total.totalRevpar)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total.totalOccupancyRate.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{total.totalAverageOccupationTime}</td>
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

  const [sort, setSort] = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

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

  const dayCols = DAY_ORDER.filter((d) => d in rawRows[0].days)
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

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.cat)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('giro-week-order', JSON.stringify(next)) } catch {}
  }

  const sp = { sort, onSort: (k: string) => setSort((p) => nextSort(p, k)) }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category" {...sp}>Categorias</SortTh>
              {dayCols.map((d) => (
                <SortTh key={d} colKey={d} right {...sp}>{DAY_LABEL[d] ?? d}</SortTh>
              ))}
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                        {dayCols.map((d) => (
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
              {dayCols.map((d) => (
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

  const [sort, setSort] = useState<SortState>(null)
  const [order, setOrder] = useState<string[]>([])

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

  const dayCols = DAY_ORDER.filter((d) => d in rawRows[0].days)
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

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = rows.map((r) => r.cat)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setOrder(next)
    setSort(null)
    try { localStorage.setItem('revpar-week-order', JSON.stringify(next)) } catch {}
  }

  const sp = { sort, onSort: (k: string) => setSort((p) => nextSort(p, k)) }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortTh colKey="category" {...sp}>Categorias</SortTh>
              {dayCols.map((d) => (
                <SortTh key={d} colKey={d} right {...sp}>{DAY_LABEL[d] ?? d}</SortTh>
              ))}
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                        {dayCols.map((d) => (
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
              {dayCols.map((d) => (
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
