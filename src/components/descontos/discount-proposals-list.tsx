'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  CheckCircle2, XCircle, Clock, Trash2, TrendingUp, TrendingDown, Minus,
  CalendarPlus, CalendarClock,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { DiscountProposal, DiscountProposalRow } from '@/app/api/agente/discount-proposals/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS_CONFIG = {
  pending:  { label: 'Aguardando aprovação', icon: Clock,        className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  approved: { label: 'Aprovada',             icon: CheckCircle2, className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  rejected: { label: 'Rejeitada',            icon: XCircle,      className: 'bg-red-500/10 text-red-600 border-red-500/20' },
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

function VariationBadge({ pts }: { pts: number }) {
  if (Math.abs(pts) < 0.1) return <span className="text-muted-foreground flex items-center gap-0.5"><Minus className="size-3" /> sem mudança</span>
  if (pts > 0)  return <span className="text-amber-600 flex items-center gap-0.5"><TrendingUp className="size-3" /> +{pts.toFixed(1)} p.p.</span>
  return <span className="text-blue-600 flex items-center gap-0.5"><TrendingDown className="size-3" /> {pts.toFixed(1)} p.p.</span>
}

// ─── Card de proposta ──────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  canManage,
  onRefresh,
}: {
  proposal: DiscountProposal
  canManage: boolean
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(proposal.status === 'pending')
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedDate, setSchedDate] = useState<Date | undefined>()
  const [schedTime, setSchedTime] = useState('10:00')
  const [schedWorking, setSchedWorking] = useState(false)

  const rows = (proposal.rows ?? []) as DiscountProposalRow[]
  const cfg  = STATUS_CONFIG[proposal.status]
  const Icon = cfg.icon

  const aumentos  = rows.filter((r) => r.variacao_pts > 0.1).length
  const reducoes  = rows.filter((r) => r.variacao_pts < -0.1).length
  const alteradas = aumentos + reducoes

  async function handleApprove() {
    setApproving(true)
    await fetch('/api/agente/discount-proposals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proposal.id, status: 'approved' }),
    })
    setApproving(false)
    onRefresh()
  }

  async function handleReject() {
    setRejecting(true)
    await fetch('/api/agente/discount-proposals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proposal.id, status: 'rejected' }),
    })
    setRejecting(false)
    onRefresh()
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/agente/discount-proposals?id=${proposal.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) onRefresh()
    setDeleteOpen(false)
  }

  async function handleSchedule() {
    if (!schedDate) return
    const [hh, mm] = schedTime.split(':').map(Number)
    const dt = new Date(schedDate)
    dt.setHours(hh, mm, 0, 0)
    setSchedWorking(true)
    await fetch('/api/agente/scheduled-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id:      proposal.unit_id,
        scheduled_at: dt.toISOString(),
        note:         `Acompanhamento de descontos — verificar impacto da proposta de desconto aprovada no volume e receita do canal Guia de Motéis.`,
      }),
    })
    setSchedWorking(false)
    setSchedOpen(false)
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-xs', cfg.className)}>
              <Icon className="size-3 mr-1" />{cfg.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono opacity-60">
              {proposal.id.slice(0, 8)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(proposal.created_at), "dd 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
            {proposal.reviewed_at && ` · revisada ${format(parseISO(proposal.reviewed_at), "dd/MM", { locale: ptBR })}`}
          </p>
          {!expanded && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {alteradas > 0
                ? <>{alteradas} alterada{alteradas !== 1 ? 's' : ''} / {rows.length} linhas · </>
                : <>{rows.length} {rows.length === 1 ? 'linha' : 'linhas'} · </>}
              {aumentos > 0 && <span className="text-amber-600">↑{aumentos} aumento{aumentos !== 1 ? 's' : ''}</span>}
              {aumentos > 0 && reducoes > 0 && ' · '}
              {reducoes > 0 && <span className="text-blue-600">↓{reducoes} redução{reducoes !== 1 ? 'ões' : ''}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage && proposal.status === 'pending' && (
            <>
              <Button size="sm" variant="outline" className="text-green-600 border-green-500/30 hover:bg-green-500/10 h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); handleApprove() }} disabled={approving || rejecting}>
                {approving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                <span className="ml-1">Aprovar</span>
              </Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-500/10 h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); handleReject() }} disabled={approving || rejecting}>
                {rejecting ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3" />}
                <span className="ml-1">Rejeitar</span>
              </Button>
            </>
          )}

          {/* Botão agendar revisão — proposta aprovada */}
          {proposal.status === 'approved' && (
            <Popover open={schedOpen} onOpenChange={(open) => {
              if (open) {
                const d = new Date()
                d.setDate(d.getDate() + 7)
                setSchedDate(d)
                setSchedTime('10:00')
              }
              setSchedOpen(open)
            }}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-7"
                  onClick={(e) => e.stopPropagation()}
                >
                  <CalendarPlus className="size-3.5" />
                  Agendar revisão
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3 flex flex-col gap-3" align="end" onClick={(e) => e.stopPropagation()}>
                <p className="text-xs font-medium text-muted-foreground">Agendar revisão:</p>
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
                    className="h-8 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={!schedDate || schedWorking}
                  onClick={handleSchedule}
                >
                  {schedWorking
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <CalendarClock className="size-3.5" />
                  }
                  Confirmar agendamento
                </Button>
              </PopoverContent>
            </Popover>
          )}

          {canManage && (
            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-red-600"
              onClick={(e) => { e.stopPropagation(); setDeleteOpen(true) }}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t px-5 py-4 flex flex-col gap-4">
          {proposal.context && (
            <p className="text-sm text-muted-foreground leading-relaxed">{proposal.context}</p>
          )}

          <div className="overflow-x-auto scrollbar-thin rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                  <th className="px-3 py-2 text-left font-medium">Categoria</th>
                  <th className="px-3 py-2 text-left font-medium">Período</th>
                  <th className="px-3 py-2 text-left font-medium">Dia</th>
                  <th className="px-3 py-2 text-left font-medium">Faixa Horária</th>
                  <th className="px-3 py-2 text-right font-medium">Preço base</th>
                  <th className="px-3 py-2 text-right font-medium">Desconto atual</th>
                  <th className="px-3 py-2 text-right font-medium">Desconto proposto</th>
                  <th className="px-3 py-2 text-right font-medium">Variação</th>
                  <th className="px-3 py-2 text-right font-medium">Preço efetivo</th>
                  <th className="px-3 py-2 text-left font-medium">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={cn('border-b hover:bg-muted/20 transition-colors', Math.abs(r.variacao_pts) < 0.1 && 'opacity-40')}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.categoria}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.periodo}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground capitalize">
                      {r.dia_semana ?? (r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {r.faixa_horaria ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.format(r.preco_base)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.desconto_atual_pct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{r.desconto_proposto_pct}%</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <VariationBadge pts={r.variacao_pts} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.format(r.preco_efetivo_proposto)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                      <span title={r.justificativa}>
                        {r.justificativa.length > 80 ? r.justificativa.slice(0, 80) + '…' : r.justificativa}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta de desconto?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Export principal ──────────────────────────────────────────────────────────

interface DiscountProposalsListProps {
  unitSlug: string
  unitId:   string
  canManage: boolean
}

export function DiscountProposalsList({ unitSlug, unitId, canManage }: DiscountProposalsListProps) {
  const [proposals, setProposals]       = useState<DiscountProposal[]>([])
  const [loading, setLoading]           = useState(true)
  const [generating, setGenerating]     = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const load = useCallback(async () => {
    const res = await fetch(`/api/agente/discount-proposals?unitSlug=${unitSlug}`)
    if (res.ok) {
      const { proposals: data } = await res.json() as { proposals: DiscountProposal[] }
      setProposals(data ?? [])
    }
    setLoading(false)
  }, [unitSlug])

  useEffect(() => { load() }, [load])

  // Realtime
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`discount_proposals:${unitId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'discount_proposals',
        filter: `unit_id=eq.${unitId}`,
      }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [unitId, load])

  async function handleGenerate() {
    setGenerating(true)
    const res = await fetch('/api/agente/discount-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitSlug }),
    })
    setGenerating(false)
    if (res.ok) await load()
  }

  const filtered = proposals.filter((p) => statusFilter === 'all' || p.status === statusFilter)
  const counts   = {
    all:      proposals.length,
    pending:  proposals.filter((p) => p.status === 'pending').length,
    approved: proposals.filter((p) => p.status === 'approved').length,
    rejected: proposals.filter((p) => p.status === 'rejected').length,
  }

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all',      label: `Todas (${counts.all})` },
    { key: 'pending',  label: `Pendentes (${counts.pending})` },
    { key: 'approved', label: `Aprovadas (${counts.approved})` },
    { key: 'rejected', label: `Rejeitadas (${counts.rejected})` },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Ações */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-full border transition-colors',
                statusFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground/30',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canManage && (
          <Button size="sm" onClick={handleGenerate} disabled={generating}>
            {generating
              ? <><Loader2 className="size-4 mr-2 animate-spin" />Gerando…</>
              : <><Sparkles className="size-4 mr-2" />Gerar proposta de desconto</>}
          </Button>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />Carregando propostas…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm rounded-xl border border-dashed">
          <Sparkles className="size-6 opacity-40" />
          {proposals.length === 0
            ? 'Nenhuma proposta de desconto gerada ainda.'
            : 'Nenhuma proposta neste status.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((p) => (
            <ProposalCard key={p.id} proposal={p} canManage={canManage} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  )
}
