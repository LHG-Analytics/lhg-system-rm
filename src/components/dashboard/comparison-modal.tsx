'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Columns2, GripVertical } from 'lucide-react'
import { ComparisonPanel } from '@/components/dashboard/comparison-panel'
import type { ComparisonFilters } from '@/components/dashboard/comparison-filter'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ─── Filtro padrão do Período B: mês anterior ─────────────────────────────────

function defaultFiltersB(base: ComparisonFilters): ComparisonFilters {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end   = new Date(now.getFullYear(), now.getMonth(), 0)
  const fmt   = (d: Date) => d.toISOString().slice(0, 10)
  return { ...base, preset: 'last-month', startDate: fmt(start), endDate: fmt(end) }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open:      boolean
  onClose:   () => void
  unitSlug:  string
  unitName:  string
  filtersA:  ComparisonFilters
}

// ─── Componente ───────────────────────────────────────────────────────────────

const MIN_SPLIT = 25   // % mínima de cada painel
const MAX_SPLIT = 75   // % máxima do painel esquerdo

export function ComparisonModal({ open, onClose, unitSlug, unitName, filtersA }: Props) {
  const [split, setSplit]           = useState(50)      // % do painel A
  const [dragging, setDragging]     = useState(false)
  const isDragging                  = useRef(false)
  const containerRef                = useRef<HTMLDivElement>(null)

  // Bloqueia scroll do body enquanto aberto
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // ESC fecha
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lógica do drag do divisor
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct  = ((e.clientX - rect.left) / rect.width) * 100
    setSplit(Math.round(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct))))
  }, [])

  const onMouseUp = useCallback(() => {
    isDragging.current = false
    setDragging(false)
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  function startDrag() {
    isDragging.current = true
    setDragging(true)
  }

  if (!open) return null

  const filtersB = defaultFiltersB(filtersA)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">

      {/* ── Barra do topo ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Columns2 className="size-4 text-muted-foreground" />
          <span className="font-semibold">Modo de comparação</span>
          <span className="text-muted-foreground">— {unitName}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </Button>
      </div>

      {/* ── Painéis com divisor arrastável ──────────────────────────────────── */}
      <div
        ref={containerRef}
        className={cn(
          'flex flex-1 overflow-hidden min-h-0',
          dragging && 'select-none cursor-col-resize',
        )}
      >
        {/* Painel A */}
        <div
          className="h-full shrink-0 overflow-x-hidden overflow-y-auto scrollbar-thin"
          style={{ width: `${split}%` }}
        >
          <div className="px-5 py-5">
            <ComparisonPanel
              label="Período A"
              accent="blue"
              unitSlug={unitSlug}
              initial={filtersA}
            />
          </div>
        </div>

        {/* Divisor arrastável */}
        <div
          onMouseDown={startDrag}
          className={cn(
            'relative flex shrink-0 w-1 cursor-col-resize items-center justify-center bg-border transition-colors z-10',
            'hover:bg-primary/50',
            dragging && 'bg-primary/60',
          )}
        >
          {/* Handle visual */}
          <div className={cn(
            'absolute flex flex-col gap-[3px] rounded-full p-1.5 transition-opacity',
            'bg-background border shadow-sm',
            dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100',
          )}>
            <GripVertical className="size-3.5 text-muted-foreground" />
          </div>
        </div>

        {/* Painel B */}
        <div
          className="h-full shrink-0 overflow-x-hidden overflow-y-auto scrollbar-thin"
          style={{ width: `${100 - split}%` }}
        >
          <div className="px-5 py-5">
            <ComparisonPanel
              label="Período B"
              accent="purple"
              unitSlug={unitSlug}
              initial={filtersB}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
