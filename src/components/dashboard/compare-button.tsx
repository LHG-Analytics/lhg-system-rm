'use client'

import { useState } from 'react'
import { Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ComparisonModal } from '@/components/dashboard/comparison-modal'
import type { ComparisonFilters } from '@/components/dashboard/comparison-filter'

interface Props {
  unitSlug: string
  unitName: string
  filters:  ComparisonFilters
}

export function CompareButton({ unitSlug, unitName, filters }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 text-xs shrink-0"
      >
        <Columns2 className="size-3.5" />
        Comparar períodos
      </Button>

      <ComparisonModal
        open={open}
        onClose={() => setOpen(false)}
        unitSlug={unitSlug}
        unitName={unitName}
        filtersA={filters}
      />
    </>
  )
}
