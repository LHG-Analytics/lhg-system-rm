'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import {
  Loader2, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Pencil, Trash2, Save, X,
  CalendarPlus, CalendarClock,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { PriceProposal, ProposedPriceRow } from '@/app/api/agente/proposals/route'

interface PendingReview {
  id: string
  scheduled_at: string
}

interface ProposalsListProps {
  unitSlug: string
  initialProposals: PriceProposal[]
  refreshKey?: number
  selectedProposalId?: string | null
}

const STATUS_CONFIG = {
  pending:  { label: 'Aguardando aprovação', icon: Clock,         className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  approved: { label: 'Aprovada',             icon: CheckCircle2,  className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  rejected: { label: 'Rejeitada',            icon: XCircle,       className: 'bg-red-500/10 text-red-600 border-red-500/20' },
}

const CANAL_LABELS: Record<string, string> = {
  balcao_site:     'Balcão / Site',
  site_programada: 'Site Programada',
  guia_moteis:     'Guia de Motéis',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function VariacaoBadge({ pct }: { pct: number }) {
  const isPositive = pct > 0
  return (
    <span className={cn('font-medium', isPositive ? 'text-green-600' : 'text-red-600')}>
      {isPositive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function ExpandableText({ text, maxLength = 120 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false)
  if (text.length <= maxLength) return <span>{text}</span>
  return (
    <span>
      {expanded ? text : text.slice(0, maxLength) + '…'}
      {' '}
      <button
        className="text-primary underline-offset-2 hover:underline text-[11px] font-medium shrink-0"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
      >
        {expanded ? 'Ler menos' : 'Ler mais'}
      </button>
    </span>
  )
}

export function ProposalsList({ unitSlug, initialProposals, refreshKey, selectedProposalId }: ProposalsListProps) {
  const [proposals, setProposals] = useState<PriceProposal[]>(initialProposals)
  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Reviews agendadas por proposal_id
  const [pendingReviews, setPendingReviews] = useState<Map<string, PendingReview>>(new Map())
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<string | null>(null)  // proposal_id em reagendamento
  const [calendarOpen, setCalendarOpen] = useState<string | null>(null)  // proposal_id com calendar aberto

  // Edição inline
  const [editing, setEditing] = useState<{ id: string; rows: ProposedPriceRow[] } | null>(null)
  const [saving, setSaving] = useState(false)

  // Exclusão com confirmação
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!refreshKey) return
    fetch(`/api/agente/proposals?unitSlug=${unitSlug}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProposals(data as PriceProposal[]) })
      .catch(() => {})
  }, [refreshKey, unitSlug])

  // Carrega revisões pendentes para cruzar com proposals
  const loadPendingReviews = useCallback(async () => {
    if (!unitSlug) return
    try {
      const res = await fetch(`/api/agente/scheduled-reviews?unitSlug=${unitSlug}`)
      const data = await res.json()
      if (!Array.isArray(data)) return
      const map = new Map<string, PendingReview>()
      for (const r of data) {
        if (r.proposal_id && r.status === 'pending') {
          map.set(r.proposal_id, { id: r.id, scheduled_at: r.scheduled_at })
        }
      }
      setPendingReviews(map)
    } catch { /* silencioso */ }
  }, [unitSlug])

  useEffect(() => { loadPendingReviews() }, [loadPendingReviews])

  // Auto-expande e scrolla para a proposta vinda da Agenda
  useEffect(() => {
    if (!selectedProposalId) return
    setExpanded((prev) => new Set([...prev, selectedProposalId]))
    setTimeout(() => {
      cardRefs.current[selectedProposalId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [selectedProposalId])

  // Proposta aprovada mais recente (é a que está vigente na tabela atual)
  const latestApprovedId = proposals.find((p) => p.status === 'approved')?.id ?? null

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/agente/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error ?? 'Erro ao gerar proposta'
        const preview = data.preview ? `\n\nResposta do modelo: "${data.preview}"` : ''
        throw new Error(msg + preview)
      }
      setProposals((prev) => [data as PriceProposal, ...prev])
      setExpanded((prev) => new Set([...prev, (data as PriceProposal).id]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setGenerating(false)
    }
  }, [unitSlug])

  const handleReview = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    setReviewing(id)
    setError(null)
    try {
      const res = await fetch('/api/agente/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao revisar proposta')
      setProposals((prev) => prev.map((p) => p.id === id ? data as PriceProposal : p))
      await loadPendingReviews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setReviewing(null)
    }
  }, [loadPendingReviews])

  const startEditing = useCallback((proposal: PriceProposal) => {
    setEditing({ id: proposal.id, rows: proposal.rows.map((r) => ({ ...r })) })
    setExpanded((prev) => new Set([...prev, proposal.id]))
    setError(null)
  }, [])

  const updateEditRow = useCallback((index: number, newPrice: number) => {
    setEditing((prev) => {
      if (!prev) return null
      const rows = [...prev.rows]
      const row = rows[index]
      const variacao_pct = row.preco_atual
        ? Math.round(((newPrice - row.preco_atual) / row.preco_atual) * 1000) / 10
        : 0
      rows[index] = { ...row, preco_proposto: newPrice, variacao_pct }
      return { ...prev, rows }
    })
  }, [])

  const updateEditJustificativa = useCallback((index: number, value: string) => {
    setEditing((prev) => {
      if (!prev) return null
      const rows = [...prev.rows]
      rows[index] = { ...rows[index], justificativa: value }
      return { ...prev, rows }
    })
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/agente/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, rows: editing.rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar edição')
      setProposals((prev) => prev.map((p) => p.id === editing.id ? data as PriceProposal : p))
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }, [editing])

  // Cria agendamento novo para a proposta
  const handleScheduleReview = useCallback(async (proposal: PriceProposal) => {
    setScheduling(proposal.id)
    setError(null)
    try {
      const reviewDate = new Date()
      reviewDate.setDate(reviewDate.getDate() + 7)
      reviewDate.setUTCHours(13, 0, 0, 0)
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch('/api/agente/scheduled-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: proposal.unit_id,
          proposal_id: proposal.id,
          scheduled_at: reviewDate.toISOString(),
          note: `Acompanhamento de precificação — verificar impacto da proposta aprovada em ${today} nos KPIs de giro, RevPAR e ocupação.`,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erro ao agendar revisão')
      }
      await loadPendingReviews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setScheduling(null)
    }
  }, [loadPendingReviews])

  // Reagenda revisão existente para nova data
  const handleReschedule = useCallback(async (proposalId: string, newDate: Date) => {
    const review = pendingReviews.get(proposalId)
    if (!review) return
    setRescheduling(proposalId)
    try {
      const prev = parseISO(review.scheduled_at)
      newDate.setUTCHours(prev.getUTCHours(), prev.getUTCMinutes(), 0, 0)
      const res = await fetch('/api/agente/scheduled-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: review.id, scheduled_at: newDate.toISOString() }),
      })
      if (!res.ok) throw new Error('Erro ao reagendar')
      await loadPendingReviews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setRescheduling(null)
      setCalendarOpen(null)
    }
  }, [pendingReviews, loadPendingReviews])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/agente/proposals?id=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erro ao excluir proposta')
      }
      setProposals((prev) => prev.filter((p) => p.id !== confirmDelete))
      if (editing?.id === confirmDelete) setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete, editing])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            O agente analisa KPIs da tabela atual e anterior, comparando desempenho por período para gerar propostas otimizadas.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating} className="gap-2 shrink-0">
          {generating
            ? <><Loader2 className="size-4 animate-spin" />Analisando…</>
            : <><Sparkles className="size-4" />Gerar Nova Proposta</>
          }
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Lista de propostas */}
      {proposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Sparkles className="size-8 text-muted-foreground/40" />
          <p className="font-medium">Nenhuma proposta ainda</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Clique em &quot;Gerar Nova Proposta&quot; para que o agente analise os KPIs e sugira ajustes de preço.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {proposals.map((proposal) => {
            const cfg = STATUS_CONFIG[proposal.status]
            const StatusIcon = cfg.icon
            const isExpanded = expanded.has(proposal.id)
            const isPending = proposal.status === 'pending'
            const isApproved = proposal.status === 'approved'
            const isLatestApproved = proposal.id === latestApprovedId
            const isReviewing = reviewing === proposal.id
            const isEditing = editing?.id === proposal.id
            const isHighlighted = selectedProposalId === proposal.id
            const pendingReview = pendingReviews.get(proposal.id)

            return (
              <div
                key={proposal.id}
                ref={(el) => { cardRefs.current[proposal.id] = el }}
                className={cn(
                  'rounded-xl border bg-card overflow-hidden transition-colors',
                  isHighlighted && 'ring-2 ring-primary/40'
                )}
              >
                {/* Cabeçalho do card */}
                <div className="flex items-start gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={cn('gap-1.5 text-xs', cfg.className)}>
                        <StatusIcon className="size-3" />
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(proposal.created_at)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {proposal.rows.length} {proposal.rows.length === 1 ? 'linha' : 'linhas'}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/50 select-all" title={proposal.id}>
                        {proposal.id.slice(0, 8)}
                      </span>
                    </div>
                    {proposal.context && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <ExpandableText text={proposal.context} maxLength={160} />
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Botão de revisão — apenas na proposta aprovada mais recente */}
                    {isApproved && isLatestApproved && (
                      pendingReview ? (
                        /* Já tem revisão agendada — mostrar data + reagendar */
                        <Popover
                          open={calendarOpen === proposal.id}
                          onOpenChange={(open) => setCalendarOpen(open ? proposal.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-7 text-blue-600 border-blue-500/30 hover:bg-blue-500/10"
                              title="Revisão agendada — clique para reagendar"
                            >
                              <CalendarClock className="size-3.5" />
                              {format(parseISO(pendingReview.scheduled_at), 'dd/MM', { locale: ptBR })}
                              · Reagendar
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <div className="px-3 pt-3 pb-1 text-xs text-muted-foreground font-medium">
                              Nova data para a revisão:
                            </div>
                            <Calendar
                              mode="single"
                              selected={parseISO(pendingReview.scheduled_at)}
                              onSelect={(date) => { if (date) handleReschedule(proposal.id, date) }}
                              disabled={(date) => date <= new Date()}
                              locale={ptBR}
                            />
                            {rescheduling === proposal.id && (
                              <div className="flex justify-center pb-3">
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      ) : (
                        /* Sem revisão — botão para agendar */
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs h-7"
                          disabled={scheduling === proposal.id}
                          onClick={() => handleScheduleReview(proposal)}
                          title="Agendar revisão automática para +7 dias"
                        >
                          {scheduling === proposal.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <CalendarPlus className="size-3.5" />
                          }
                          Agendar revisão
                        </Button>
                      )
                    )}

                    {/* Botão excluir */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(proposal.id)}
                      title="Excluir proposta"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                    {/* Toggle expand */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => toggleExpand(proposal.id)}
                    >
                      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  </div>
                </div>

                {/* Tabela de linhas (colapsável) */}
                {isExpanded && (
                  <div className="border-t">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Canal</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead>Período</TableHead>
                            <TableHead>Dia</TableHead>
                            <TableHead className="text-right">Atual</TableHead>
                            <TableHead className="text-right">Proposto</TableHead>
                            <TableHead className="text-right">Variação</TableHead>
                            <TableHead>Justificativa</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(isEditing ? editing.rows : proposal.rows).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{CANAL_LABELS[row.canal] ?? row.canal}</TableCell>
                              <TableCell className="text-xs font-medium">{row.categoria}</TableCell>
                              <TableCell className="text-xs">{row.periodo}</TableCell>
                              <TableCell className="text-xs">
                                {row.dia_tipo === 'semana' ? 'Semana'
                                  : row.dia_tipo === 'fds_feriado' ? 'FDS/Fer.'
                                  : 'Todos'}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                R$ {row.preco_atual.toFixed(2).replace('.', ',')}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums font-medium">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="w-20 text-right bg-transparent border-b border-primary outline-none text-xs tabular-nums font-medium"
                                    value={row.preco_proposto}
                                    onChange={(e) => updateEditRow(i, parseFloat(e.target.value) || 0)}
                                  />
                                ) : (
                                  `R$ ${row.preco_proposto.toFixed(2).replace('.', ',')}`
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                <VariacaoBadge pct={row.variacao_pct} />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[240px]">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="w-full bg-transparent border-b border-primary outline-none text-xs text-foreground"
                                    value={row.justificativa}
                                    onChange={(e) => updateEditJustificativa(i, e.target.value)}
                                  />
                                ) : (
                                  <ExpandableText text={row.justificativa} maxLength={80} />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Barra de ações */}
                    {isEditing ? (
                      <div className="flex justify-end gap-2 p-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={saving}
                          onClick={() => setEditing(null)}
                        >
                          <X className="size-3.5" />
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={saving}
                          onClick={handleSaveEdit}
                        >
                          {saving
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Save className="size-3.5" />
                          }
                          Salvar Edições
                        </Button>
                      </div>
                    ) : isPending ? (
                      <div className="flex justify-end gap-2 p-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-red-600 hover:text-red-600 border-red-500/20 hover:bg-red-500/10"
                          disabled={isReviewing}
                          onClick={() => handleReview(proposal.id, 'rejected')}
                        >
                          {isReviewing
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <XCircle className="size-3.5" />
                          }
                          Rejeitar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={isReviewing}
                          onClick={() => startEditing(proposal)}
                        >
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={isReviewing}
                          onClick={() => handleReview(proposal.id, 'approved')}
                        >
                          {isReviewing
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <CheckCircle2 className="size-3.5" />
                          }
                          Aprovar Proposta
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A proposta será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
