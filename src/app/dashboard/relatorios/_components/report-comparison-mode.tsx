'use client'

import { useState, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { WeeklyReportData } from '@/lib/reports/types'
import type { ReportMetadata } from '@/lib/reports/types'
import { ReportViewer } from './report-viewer'

interface FullReport {
  id: string
  period_start: string
  period_end: string
  status: 'generating' | 'done' | 'failed'
  generated_at: string | null
  error_msg: string | null
  report_data: WeeklyReportData | null
  ai_summary: string | null
}

interface Props {
  primaryReport: FullReport
  availableReports: ReportMetadata[]
  unitSlug: string
}

function formatPeriod(start: string, end: string): string {
  return `${start.slice(5, 10).replace('-', '/')} – ${end.slice(5, 10).replace('-', '/')}`
}

export function ReportComparisonMode({ primaryReport, availableReports, unitSlug }: Props) {
  const [compareId, setCompareId] = useState<string | null>(
    availableReports.find(r => r.id !== primaryReport.id)?.id ?? null
  )
  const [compareReport, setCompareReport] = useState<FullReport | null>(null)
  const [syncScroll, setSyncScroll] = useState(false)
  const [splitPct, setSplitPct] = useState(50)

  async function loadCompareReport(id: string) {
    setCompareId(id)
    try {
      const res = await fetch(`/api/agente/reports/${id}`)
      const data = await res.json()
      if (data.report) setCompareReport(data.report)
    } catch { /* ignore */ }
  }

  // Drag divider
  const handleDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).parentElement!
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100))
      setSplitPct(pct)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Comparison header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Período A:</span>
          <span className="text-muted-foreground">{formatPeriod(primaryReport.period_start, primaryReport.period_end)}</span>
        </div>
        <span className="text-muted-foreground">↔</span>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Período B:</span>
          <Select value={compareId ?? undefined} onValueChange={loadCompareReport}>
            <SelectTrigger className="h-7 text-sm w-48">
              <SelectValue placeholder="Selecionar relatório" />
            </SelectTrigger>
            <SelectContent>
              {availableReports
                .filter(r => r.id !== primaryReport.id)
                .map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {formatPeriod(r.period_start, r.period_end)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Switch id="sync-scroll" checked={syncScroll} onCheckedChange={setSyncScroll} />
          <Label htmlFor="sync-scroll" className="text-xs text-muted-foreground">Scroll sincronizado</Label>
        </div>
      </div>

      {/* Split panels */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="overflow-y-auto" style={{ width: `${splitPct}%` }}>
          <ReportViewer report={primaryReport} loading={false} onGenerateNow={() => {}} unitSlug={unitSlug} />
        </div>

        {/* Draggable divider */}
        <div
          className="w-1 bg-border cursor-col-resize hover:bg-primary/50 shrink-0 transition-colors"
          onMouseDown={handleDividerDrag}
        />

        <div className="overflow-y-auto flex-1">
          {compareReport ? (
            <ReportViewer report={compareReport} loading={false} onGenerateNow={() => {}} unitSlug={unitSlug} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Selecione um período para comparar
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
