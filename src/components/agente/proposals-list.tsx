'use client'

import { useState, useCallback } from 'react'
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
import { Loader2, Sparkles, ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PriceProposal } from '@/app/api/agente/proposals/route'

interface ProposalsListProps {
  unitSlug: string
  initialProposals: PriceProposal[]
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

export function ProposalsList({ unitSlug, initialProposals }: ProposalsListProps) {
  const [proposals, setProposals] = useState<PriceProposal[]>(initialProposals)
  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

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
      if (!res.ok) throw new Error(data.error ?? 'Erro ao gerar proposta')
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setReviewing(null)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            O agente analisa KPIs e tabela de preços para gerar propostas de ajuste para aprovação.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating} className="gap-2 shrink-0">
          {generating
            ? <><Loader2 className="size-4 animate-spin" />Gerando…</>
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
            Clique em &quot;Gerar Nova Proposta&quot; para que o agente analise os dados e sugira ajustes de preço.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {proposals.map((proposal) => {
            const cfg = STATUS_CONFIG[proposal.status]
            const StatusIcon = cfg.icon
            const isExpanded = expanded.has(proposal.id)
            const isPending = proposal.status === 'pending'
            const isReviewing = reviewing === proposal.id

            return (
              <div key={proposal.id} className="rounded-xl border bg-card overflow-hidden">
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
                    </div>
                    {proposal.context && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {proposal.context}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 size-8"
                    onClick={() => toggleExpand(proposal.id)}
                  >
                    {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </Button>
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
                          {proposal.rows.map((row, i) => (
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
                                R$ {row.preco_proposto.toFixed(2).replace('.', ',')}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                <VariacaoBadge pct={row.variacao_pct} />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                                {row.justificativa}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Botões de aprovação (só para pendentes) */}
                    {isPending && (
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
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
