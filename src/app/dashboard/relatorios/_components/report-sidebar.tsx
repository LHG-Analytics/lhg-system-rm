'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, AlertCircle, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReportMetadata } from '@/lib/reports/types'
import { ReportGenerateButton } from './report-generate-button'

interface Props {
  reports: ReportMetadata[]
  selectedId: string | null
  unitSlug: string
  onSelect: (id: string) => void
  onGenerated: (id: string) => void
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00Z')
  const e = new Date(end + 'T12:00:00Z')
  return `${format(s, 'dd/MM', { locale: ptBR })}–${format(e, 'dd/MM', { locale: ptBR })}`
}

export function ReportSidebar({ reports, selectedId, unitSlug, onSelect, onGenerated }: Props) {
  return (
    <div className="w-60 border-r flex-shrink-0 flex flex-col h-full">
      <div className="p-3 border-b">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Gerar relatório</p>
        <ReportGenerateButton unitSlug={unitSlug} onGenerated={onGenerated} />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {reports.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              Nenhum relatório ainda.<br />
              Próximo: segunda às 06h BRT.
            </p>
          </div>
        ) : (
          reports.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={cn(
                'w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors',
                selectedId === r.id && 'bg-muted',
              )}
            >
              <StatusIcon status={r.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  Sem {formatPeriod(r.period_start, r.period_end)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.status === 'done' && r.generated_at
                    ? format(new Date(r.generated_at), "dd/MM 'às' HH:mm", { locale: ptBR })
                    : r.status === 'generating'
                    ? 'Gerando…'
                    : r.status === 'failed'
                    ? 'Falhou'
                    : ''}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: ReportMetadata['status'] }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
  if (status === 'failed') return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
  return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
}
