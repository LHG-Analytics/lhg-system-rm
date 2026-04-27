'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Pencil, Trash2, Save, X,
  CalendarPlus, CalendarClock, TrendingUp, TrendingDown, Minus,
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
  unitId: string
  initialProposals: PriceProposal[]
  refreshKey?: number
  selectedProposalId?: string | null
  /** false = gerente: só visualiza + pode agendar/reagendar revisão da última proposta aprovada */
  canManage?: boolean
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

/**
 * Calcula o impacto estimado de uma proposta no ticket médio.
 * Assume volume (locações) constante — deixa isso explícito na UI.
 */
function calcImpact(rows: ProposedPriceRow[]) {
  if (!rows.length) return null
  const up    = rows.filter((r) => r.variacao_pct >  0.5)
  const down  = rows.filter((r) => r.variacao_pct < -0.5)
  const flat  = rows.filter((r) => Math.abs(r.variacao_pct) <= 0.5)
  const avgCurrent  = rows.reduce((s, r) => s + r.preco_atual,    0) / rows.length
  const avgProposed = rows.reduce((s, r) => s + r.preco_proposto, 0) / rows.length
  const deltaTicket = avgCurrent > 0 ? ((avgProposed - avgCurrent) / avgCurrent) * 100 : 0
  return { up: up.length, down: down.length, flat: flat.length, deltaTicket, avgCurrent, avgProposed }
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

export function ProposalsList({ unitSlug, unitId, initialProposals, refreshKey, selectedProposalId, canManage = true }: ProposalsListProps) {
  const supabase = useMemo(() => createClient(), [])
  const [proposals, setProposals] = useState<PriceProposal[]>(initialProposals)
  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Reviews agendadas por proposal_id
  const [pendingReviews, setPendingReviews] = useState<Map<string, PendingReview>>(new Map())
  const [schedOpen, setSchedOpen] = useState<string | null>(null)   // proposal_id com picker aberto
  const [schedDate, setSchedDate] = useState<Date | undefined>()
  const [schedTime, setSchedTime] = useState('10:00')
  const [schedWorking, setSchedWorking] = useState(false)

  // Edição inline
  const [editing, setEditing] = useState<{ id: string; rows: ProposedPriceRow[] } | null>(null)
  const [saving, setSaving] = useState(false)

  // Exclusão com confirmação
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filtro de status
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  useEffect(() => {
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

  // Realtime: price_proposals + scheduled_reviews desta unidade
  useEffect(() => {
    if (!unitId) return
    const loadProposals = () => {
      fetch(`/api/agente/proposals?unitSlug=${unitSlug}`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setProposals(data as PriceProposal[]) })
        .catch(() => {})
    }
    const ch = supabase
      .channel(`proposals:${unitId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_proposals', filter: `unit_id=eq.${unitId}` }, loadProposals)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_reviews', filter: `unit_id=eq.${unitId}` }, () => { loadPendingReviews() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [unitId, unitSlug, supabase, loadPendingReviews])

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

  const filteredProposals = statusFilter === 'all'
    ? proposals
    : proposals.filter((p) => p.status === statusFilter)

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
      if (status === 'approved') {
        // Auto-abre o picker de data+hora para agendar o acompanhamento
        const d = new Date()
        d.setDate(d.getDate() + 7)
        setSchedDate(d)
        setSchedTime('10:00')
        setSchedOpen(id)
      }
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

  // Abre o picker para novo agendamento ou reagendamento
  const openSchedPicker = useCallback((proposalId: string) => {
    const existing = pendingReviews.get(proposalId)
    if (existing) {
      const d = parseISO(existing.scheduled_at)
      setSchedDate(d)
      const h = String(d.getHours()).padStart(2, '0')
      const m = String(d.getMinutes()).padStart(2, '0')
      setSchedTime(`${h}:${m}`)
    } else {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      setSchedDate(d)
      setSchedTime('10:00')
    }
    setSchedOpen(proposalId)
  }, [pendingReviews])

  // Confirma agendamento (novo ou reagendamento)
  const handleConfirmSchedule = useCallback(async (proposalId: string) => {
    if (!schedDate) return
    const proposal = proposals.find((p) => p.id === proposalId)
    if (!proposal) return

    const [hh, mm] = schedTime.split(':').map(Number)
    const dt = new Date(schedDate)
    dt.setHours(hh, mm, 0, 0)

    setSchedWorking(true)
    setError(null)
    try {
      const existing = pendingReviews.get(proposalId)
      if (existing) {
        const res = await fetch('/api/agente/scheduled-reviews', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, scheduled_at: dt.toISOString() }),
        })
        if (!res.ok) throw new Error('Erro ao reagendar')
      } else {
        const today = new Date().toISOString().slice(0, 10)
        const res = await fetch('/api/agente/scheduled-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit_id: proposal.unit_id,
            proposal_id: proposalId,
            scheduled_at: dt.toISOString(),
            note: `Acompanhamento de precificação — verificar impacto da proposta aprovada em ${today} nos KPIs de giro, RevPAR e ocupação.`,
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao agendar')
      }
      setSchedOpen(null)
      await loadPendingReviews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSchedWorking(false)
    }
  }, [schedDate, schedTime, proposals, pendingReviews, loadPendingReviews])

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
      {/* Header — mesmo padrão do DiscountProposalsList */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => {
            const labels = { all: 'Todas', pending: 'Pendentes', approved: 'Aprovadas', rejected: 'Rejeitadas' }
            const counts = {
              all:      proposals.length,
              pending:  proposals.filter((p) => p.status === 'pending').length,
              approved: proposals.filter((p) => p.status === 'approved').length,
              rejected: proposals.filter((p) => p.status === 'rejected').length,
            }
            const active = statusFilter === s
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-full border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                )}
              >
                {labels[s]} ({counts[s]})
              </button>
            )
          })}
        </div>

        {canManage && (
          <Button onClick={handleGenerate} disabled={generating} className="gap-2 shrink-0">
            {generating
              ? <><Loader2 className="size-4 animate-spin" />Analisando…</>
              : <><Sparkles className="size-4" />Gerar Nova Proposta</>
            }
          </Button>
        )}
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
      ) : filteredProposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma proposta com esse status.</p>
          <button onClick={() => setStatusFilter('all')} className="text-xs text-primary underline-offset-2 hover:underline">
            Ver todas
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredProposals.map((proposal) => {
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
            const impact = calcImpact(proposal.rows)

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

                    {/* Resumo de impacto estimado */}
                    {impact && (
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {impact.up > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-green-600">
                            <TrendingUp className="size-3" />
                            {impact.up} {impact.up === 1 ? 'aumento' : 'aumentos'}
                          </span>
                        )}
                        {impact.down > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-red-500">
                            <TrendingDown className="size-3" />
                            {impact.down} {impact.down === 1 ? 'redução' : 'reduções'}
                          </span>
                        )}
                        {impact.flat > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Minus className="size-3" />
                            {impact.flat} sem alteração
                          </span>
                        )}
                        <span className={cn(
                          'text-[11px] font-medium tabular-nums',
                          impact.deltaTicket > 0 ? 'text-green-600' : impact.deltaTicket < 0 ? 'text-red-500' : 'text-muted-foreground'
                        )}>
                          · Ticket médio {impact.deltaTicket >= 0 ? '+' : ''}{impact.deltaTicket.toFixed(1)}% (volume constante)
                        </span>
                      </div>
                    )}

                    {proposal.context && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <ExpandableText text={proposal.context} maxLength={160} />
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Botão de revisão — apenas na proposta aprovada mais recente */}
                    {isApproved && isLatestApproved && (
                      <Popover
                        open={schedOpen === proposal.id}
                        onOpenChange={(open) => { if (!open) setSchedOpen(null) }}
                      >
                        <PopoverTrigger asChild>
                          {pendingReview ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-7 text-blue-600 border-blue-500/30 hover:bg-blue-500/10"
                              onClick={() => openSchedPicker(proposal.id)}
                            >
                              <CalendarClock className="size-3.5" />
                              {format(parseISO(pendingReview.scheduled_at), "dd/MM · HH'h'mm", { locale: ptBR })}
                              · Reagendar
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-7"
                              onClick={() => openSchedPicker(proposal.id)}
                            >
                              <CalendarPlus className="size-3.5" />
                              Agendar revisão
                            </Button>
                          )}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3 flex flex-col gap-3" align="end">
                          <p className="text-xs font-medium text-muted-foreground">
                            {pendingReview ? 'Reagendar revisão:' : 'Agendar revisão:'}
                          </p>
                          <Calendar
                            mode="single"
                            selected={schedDate}
                            onSelect={setSchedDate}
                            disabled={(date) => date <= new Date()}
                            locale={ptBR}
                            className="p-0"
                          />
                          <div className="flex flex-col gap-1.5 border-t pt-3">
                            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Clock className="size-3" />
                              Horário da revisão
                            </Label>
                            <Input
                              type="time"
                              value={schedTime}
                              onChange={(e) => setSchedTime(e.target.value)}
                              className="h-8 text-sm appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="w-full gap-1.5"
                            disabled={!schedDate || schedWorking}
                            onClick={() => handleConfirmSchedule(proposal.id)}
                          >
                            {schedWorking
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <CalendarPlus className="size-3.5" />
                            }
                            {pendingReview ? 'Confirmar reagendamento' : 'Confirmar agendamento'}
                          </Button>
                        </PopoverContent>
                      </Popover>
                    )}

                    {/* Botão excluir — apenas admins */}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirmDelete(proposal.id)}
                        title="Excluir proposta"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
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

                    {/* Painel de simulação de receita */}
                    {!isEditing && impact && (
                      <div className="border-t px-4 py-3 bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Simulação (volume constante)
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Ticket médio atual:{' '}
                          <span className="font-medium text-foreground">
                            R$ {impact.avgCurrent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Ticket projetado:{' '}
                          <span className="font-medium text-foreground">
                            R$ {impact.avgProposed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </span>
                        <span className={cn(
                          'text-xs font-semibold',
                          impact.deltaTicket > 0 ? 'text-green-600' : impact.deltaTicket < 0 ? 'text-red-500' : 'text-muted-foreground'
                        )}>
                          {impact.deltaTicket >= 0 ? '▲' : '▼'}{' '}
                          {Math.abs(impact.deltaTicket).toFixed(1)}% por locação
                        </span>
                      </div>
                    )}

                    {/* Barra de ações */}
                    {canManage && isEditing ? (
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
                    ) : canManage && isPending ? (
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
