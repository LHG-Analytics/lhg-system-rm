'use client'

import { useEffect } from 'react'
import { X, Columns2 } from 'lucide-react'
import { ComparisonPanel } from '@/components/dashboard/comparison-panel'
import type { ComparisonFilters } from '@/components/dashboard/comparison-filter'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

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

export function ComparisonModal({ open, onClose, unitSlug, unitName, filtersA }: Props) {
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

      {/* ── Painéis lado a lado ─────────────────────────────────────────────── */}
      <div className="flex flex-1 divide-x overflow-hidden">
        {/* Painel A */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-5">
            <ComparisonPanel
              label="Período A"
              accent="blue"
              unitSlug={unitSlug}
              initial={filtersA}
            />
          </div>
        </ScrollArea>

        {/* Painel B */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-5">
            <ComparisonPanel
              label="Período B"
              accent="purple"
              unitSlug={unitSlug}
              initial={filtersB}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
