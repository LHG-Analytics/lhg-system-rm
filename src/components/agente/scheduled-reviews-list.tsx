'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  Loader2, CalendarClock, Trash2, Pencil, Save, X,
  CheckCircle2, XCircle, Clock, Play, CalendarCheck, Zap,
} from 'lucide-react'
import { format, parseISO, isPast } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { ScheduledReview } from '@/app/api/agente/scheduled-reviews/route'

interface ScheduledReviewsListProps {
  unitSlug: string
  unitId: string
  onSelectConversation?: (convId: string) => void
  onSelectProposal?: (proposalId: string) => void
}

const STATUS_CONFIG = {
  pending: { label: 'Agendada',    icon: Clock,        className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  running: { label: 'Executando',  icon: Play,         className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  done:    { label: 'Concluída',   icon: CheckCircle2, className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  failed:  { label: 'Falhou',      icon: XCircle,      className: 'bg-red-500/10 text-red-600 border-red-500/20' },
}

function formatScheduled(iso: string) {
  const d = parseISO(iso)
  return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function ScheduledReviewsList({ unitSlug, unitId, onSelectConversation, onSelectProposal }: ScheduledReviewsListProps) {
  const supabase = useMemo(() => createClient(), [])
  const [reviews, setReviews]         = useState<ScheduledReview[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [editing, setEditing]         = useState<{ id: string; scheduled_at: string; note: string } | null>(null)
  const [saving, setSaving]           = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [running, setRunning]         = useState(false)
  const [runResult, setRunResult]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agente/scheduled-reviews?unitSlug=${unitSlug}`)
      const data = await res.json()
      if (Array.isArray(data)) setReviews(data as ScheduledReview[])
    } catch {
      setError('Erro ao carregar agendamentos')
    } finally {
      setLoading(false)
    }
  }, [unitSlug])

  useEffect(() => { load() }, [load])

  // Realtime: scheduled_reviews desta unidade
  useEffect(() => {
    if (!unitId) return
    const ch = supabase
      .channel(`scheduled_reviews:${unitId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_reviews', filter: `unit_id=eq.${unitId}` }, () => { load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [unitId, supabase, load])

  const handleSaveEdit = useCallback(async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/agente/scheduled-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, scheduled_at: editing.scheduled_at, note: editing.note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setReviews((prev) => prev.map((r) => r.id === editing.id ? data as ScheduledReview : r))
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [editing])

  const handleRunNow = useCallback(async () => {
    setRunning(true)
    setRunResult(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/run-pending-reviews', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao executar')
      const { done = 0, failed = 0 } = data
      setRunResult(done > 0
        ? `${done} revisão(ões) executada(s) com sucesso.`
        : failed > 0
        ? `${failed} revisão(ões) falharam. Verifique os logs.`
        : 'Nenhuma revisão pendente encontrada.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setRunning(false)
    }
  }, [load])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/agente/scheduled-reviews?id=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Erro ao excluir')
      setReviews((prev) => prev.filter((r) => r.id !== confirmDelete))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pending = reviews.filter((r) => r.status === 'pending')
  const past    = reviews.filter((r) => r.status !== 'pending')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Revisões automáticas de acompanhamento de precificação. Ao aprovar uma proposta, uma revisão é agendada automaticamente para 7 dias depois.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {runResult && (
        <div className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" />{runResult}
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CalendarClock className="size-8 text-muted-foreground/40" />
          <p className="font-medium">Nenhum agendamento</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Ao aprovar uma proposta de preço, o agente agendará automaticamente uma revisão de acompanhamento.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {/* Agendadas (futuras/pendentes) */}
          {pending.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Próximas revisões</h3>
                {pending.some((r) => isPast(parseISO(r.scheduled_at))) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-7 border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/10"
                    onClick={handleRunNow}
                    disabled={running}
                  >
                    {running
                      ? <Loader2 className="size-3 animate-spin" />
                      : <Zap className="size-3" />}
                    Executar agora
                  </Button>
                )}
              </div>
              {pending.map((review) => {
                const isEditingThis = editing?.id === review.id
                const overdue = isPast(parseISO(review.scheduled_at))

                return (
                  <div key={review.id} className={cn(
                    'rounded-xl border bg-card p-4 flex flex-col gap-3',
                    overdue && 'border-yellow-500/30 bg-yellow-500/5'
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="gap-1.5 text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
                            <CalendarCheck className="size-3" />
                            {isEditingThis
                              ? format(parseISO(editing.scheduled_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                              : formatScheduled(review.scheduled_at)
                            }
                          </Badge>
                          {overdue && (
                            <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                              Aguardando execução
                            </Badge>
                          )}
                          {review.proposal_id && (
                            <button
                              className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
                              onClick={() => onSelectProposal?.(review.proposal_id!)}
                              title={`Ver proposta ${review.proposal_id}`}
                            >
                              {review.proposal_created_at
                                ? `Proposta de ${format(parseISO(review.proposal_created_at), 'dd/MM/yyyy', { locale: ptBR })} `
                                : 'Ver proposta '}
                              <span className="font-mono text-[10px]">({review.proposal_id.slice(0, 8)})</span>
                            </button>
                          )}
                        </div>

                        {/* Nota */}
                        {isEditingThis ? (
                          <textarea
                            className="text-sm bg-transparent border rounded-md px-2 py-1.5 outline-none focus:border-primary resize-none text-foreground w-full"
                            rows={2}
                            value={editing.note}
                            onChange={(e) => setEditing((prev) => prev ? { ...prev, note: e.target.value } : null)}
                            placeholder="O que monitorar nesta revisão…"
                          />
                        ) : review.note ? (
                          <p className="text-sm text-muted-foreground">{review.note}</p>
                        ) : null}
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-1 shrink-0">
                        {!isEditingThis && (
                          <>
                            <Button
                              variant="ghost" size="icon"
                              className="size-8"
                              onClick={() => setEditing({ id: review.id, scheduled_at: review.scheduled_at, note: review.note ?? '' })}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setConfirmDelete(review.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Edição de data */}
                    {isEditingThis && (
                      <div className="flex flex-col gap-3 border-t pt-3">
                        <p className="text-xs text-muted-foreground font-medium">Alterar data da revisão:</p>
                        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs w-fit">
                              <CalendarClock className="size-3.5" />
                              {format(parseISO(editing.scheduled_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={parseISO(editing.scheduled_at)}
                              onSelect={(date) => {
                                if (!date) return
                                // Mantém horário original (13:00 UTC), troca apenas a data
                                const prev = parseISO(editing.scheduled_at)
                                date.setUTCHours(prev.getUTCHours(), prev.getUTCMinutes(), 0, 0)
                                setEditing((e) => e ? { ...e, scheduled_at: date.toISOString() } : null)
                                setCalendarOpen(false)
                              }}
                              disabled={(date) => date < new Date()}
                              locale={ptBR}
                            />
                          </PopoverContent>
                        </Popover>

                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(null)} disabled={saving}>
                            <X className="size-3.5" />Cancelar
                          </Button>
                          <Button size="sm" className="gap-1.5" onClick={handleSaveEdit} disabled={saving}>
                            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Salvar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Histórico de revisões executadas */}
          {past.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
              {past.map((review) => {
                const cfg = STATUS_CONFIG[review.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.done
                const StatusIcon = cfg.icon

                return (
                  <div key={review.id} className="rounded-xl border bg-card p-4 flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('gap-1.5 text-xs', cfg.className)}>
                          <StatusIcon className="size-3" />
                          {cfg.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatScheduled(review.scheduled_at)}
                        </span>
                        {review.executed_at && (
                          <span className="text-xs text-muted-foreground">
                            · executada em {format(parseISO(review.executed_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </span>
                        )}
                        {review.proposal_id && (
                          <button
                            className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
                            onClick={() => onSelectProposal?.(review.proposal_id!)}
                            title={`Ver proposta ${review.proposal_id}`}
                          >
                            · {review.proposal_created_at
                                ? `proposta de ${format(parseISO(review.proposal_created_at), 'dd/MM/yyyy', { locale: ptBR })} `
                                : 'ver proposta '}
                            <span className="font-mono text-[10px]">({review.proposal_id.slice(0, 8)})</span>
                          </button>
                        )}
                      </div>
                      {review.note && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{review.note}</p>
                      )}
                    </div>

                    {/* Ver conversa gerada */}
                    {review.conv_id && onSelectConversation && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-xs gap-1.5"
                        onClick={() => onSelectConversation(review.conv_id!)}
                      >
                        <CalendarCheck className="size-3.5" />
                        Ver análise
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A revisão automática será cancelada. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
