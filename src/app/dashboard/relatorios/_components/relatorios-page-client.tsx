'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ReportMetadata, WeeklyReportData } from '@/lib/reports/types'
import { ReportSidebar } from './report-sidebar'
import { ReportViewer } from './report-viewer'
import { ReportComparisonMode } from './report-comparison-mode'
import { Button } from '@/components/ui/button'
import { SplitSquareHorizontal } from 'lucide-react'

interface Props {
  initialReports: ReportMetadata[]
  unitSlug: string
  unitName: string
  unitId: string
}

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

export function RelatoriosPageClient({ initialReports, unitSlug, unitName, unitId }: Props) {
  const searchParams = useSearchParams()
  const [reports, setReports] = useState<ReportMetadata[]>(initialReports)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<FullReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [comparisonMode, setComparisonMode] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Polling: refresh report list periodically when any report is generating
  useEffect(() => {
    const hasGenerating = reports.some(r => r.status === 'generating')
    if (!hasGenerating) {
      if (pollingRef.current) clearInterval(pollingRef.current)
      return
    }
    pollingRef.current = setInterval(refreshList, 3000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [reports])

  async function refreshList() {
    try {
      const res = await fetch(`/api/agente/reports?unitSlug=${unitSlug}`)
      const data = await res.json()
      if (data.reports) setReports(data.reports)
    } catch { /* ignore */ }
  }

  const loadReport = useCallback(async (id: string) => {
    setLoadingReport(true)
    setSelectedId(id)
    try {
      const res = await fetch(`/api/agente/reports/${id}`)
      const data = await res.json()
      if (data.report) {
        setSelectedReport(data.report)
        // If still generating, poll until done
        if (data.report.status === 'generating') {
          const poll = setInterval(async () => {
            const r = await fetch(`/api/agente/reports/${id}`)
            const d = await r.json()
            if (d.report?.status !== 'generating') {
              setSelectedReport(d.report)
              clearInterval(poll)
              refreshList()
            }
          }, 3000)
        }
      }
    } finally {
      setLoadingReport(false)
    }
  }, [unitSlug])

  function handleGenerated(id: string) {
    refreshList()
    loadReport(id)
  }

  // Auto-select first done report on mount
  useEffect(() => {
    const firstDone = reports.find(r => r.status === 'done')
    if (firstDone && !selectedId) {
      loadReport(firstDone.id)
    }
  }, [])

  const doneReports = reports.filter(r => r.status === 'done')

  return (
    <div className="flex h-full overflow-hidden">
      <ReportSidebar
        reports={reports}
        selectedId={selectedId}
        unitSlug={unitSlug}
        onSelect={loadReport}
        onGenerated={handleGenerated}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
          <h1 className="font-semibold">Relatórios — {unitName}</h1>
          {doneReports.length >= 2 && selectedReport?.status === 'done' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComparisonMode(v => !v)}
              className="gap-2"
            >
              <SplitSquareHorizontal className="w-4 h-4" />
              {comparisonMode ? 'Sair da comparação' : 'Comparar ↔'}
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {comparisonMode && selectedReport ? (
            <ReportComparisonMode
              primaryReport={selectedReport}
              availableReports={doneReports}
              unitSlug={unitSlug}
            />
          ) : (
            <div className="h-full overflow-y-auto">
              <ReportViewer
                report={selectedReport}
                loading={loadingReport}
                onGenerateNow={() => handleGenerated('')}
                unitSlug={unitSlug}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
