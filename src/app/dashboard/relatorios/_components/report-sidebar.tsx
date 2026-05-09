'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, AlertCircle, Loader2, FileText, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReportMetadata } from '@/lib/reports/types'
import { ReportGenerateButton } from './report-generate-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface Props {
  reports: ReportMetadata[]
  selectedId: string | null
  unitSlug: string
  onSelect: (id: string) => void
  onGenerated: (id: string) => void
  onDelete: (id: string) => void
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00Z')
  const e = new Date(end + 'T12:00:00Z')
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  const range = `${format(s, 'dd/MM', { locale: ptBR })}–${format(e, 'dd/MM', { locale: ptBR })}`
  return days <= 8 ? `Sem ${range}` : range
}

export function ReportSidebar({ reports, selectedId, unitSlug, onSelect, onGenerated, onDelete }: Props) {
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
            <ReportItem
              key={r.id}
              report={r}
              selected={selectedId === r.id}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ReportItem({ report: r, selected, onSelect, onDelete }: {
  report: ReportMetadata
  selected: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    await onDelete(r.id)
    setDeleting(false)
  }

  return (
    <div className={cn('group relative flex items-center hover:bg-muted/50 transition-colors', selected && 'bg-muted')}>
      <button
        onClick={() => onSelect(r.id)}
        className="flex-1 text-left px-3 py-2.5 flex items-center gap-2 min-w-0"
      >
        <StatusIcon status={r.status} />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {formatPeriod(r.period_start, r.period_end)}
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

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            disabled={deleting}
            className="mr-2 p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:text-destructive shrink-0"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir relatório?</AlertDialogTitle>
            <AlertDialogDescription>
              O relatório da semana {formatPeriod(r.period_start, r.period_end)} será removido.
              Você pode regenerá-lo a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatusIcon({ status }: { status: ReportMetadata['status'] }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
  if (status === 'failed') return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
  return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
}
