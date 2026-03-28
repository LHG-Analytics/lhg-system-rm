'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useSearchParams } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, Calendar, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MessageResponse } from '@/components/ai-elements/message'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceImportSummary {
  id: string
  imported_at: string
  canals: string[]
  is_active: boolean
  valid_from: string
  valid_until: string | null
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// DD/MM/YYYY → YYYY-MM-DD (formato do input type="date")
function toInputDate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// YYYY-MM-DD → DD/MM/YYYY (formato da API LHG Analytics)
function fromInputDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

// Espelha trailingYear() do servidor para pré-preencher os seletores
function getDefaultDateRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const opToday =
    now.getHours() < 6
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const end = new Date(opToday)
  end.setDate(end.getDate() - 1)

  const start = new Date(opToday)
  start.setFullYear(start.getFullYear() - 1)

  const pad = (n: number) => n.toString().padStart(2, '0')
  const apiDate = (dt: Date) => `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`

  return { startDate: apiDate(start), endDate: apiDate(end) }
}

// ─── Inner chat (recriado quando key muda) ────────────────────────────────────

interface AgenteChatInnerProps {
  unitSlug: string
  startDate: string
  endDate: string
  priceImportIds?: string[]
  priceAnalysisPeriods?: { startDate: string; endDate: string }[]
}

function AgenteChatInner({ unitSlug, startDate, endDate, priceImportIds, priceAnalysisPeriods }: AgenteChatInnerProps) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: { unitSlug, startDate, endDate, priceImportIds, priceAnalysisPeriods },
    }),
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)

  function handleScroll() {
    const el = scrollAreaRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    const newMessageAdded = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length
    if (newMessageAdded || isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const isStreaming = status === 'streaming' || status === 'submitted'

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const text = textareaRef.current?.value.trim()
    if (!text || isStreaming) return
    sendMessage({ text })
    if (textareaRef.current) textareaRef.current.value = ''
  }

  return (
    <>
      {/* Área de mensagens */}
      <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
            <div className="rounded-full bg-primary/10 p-4">
              <Bot className="size-8 text-primary" />
            </div>
            <div>
              <p className="font-medium">Agente de Revenue Management</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Pergunte sobre ocupação, precificação, RevPAR ou peça uma análise de desempenho da unidade.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (textareaRef.current) textareaRef.current.value = s
                    textareaRef.current?.focus()
                  }}
                  className="text-xs rounded-full border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-3',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {msg.role === 'assistant' && (
              <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center mt-0.5">
                <Bot className="size-4 text-primary" />
              </div>
            )}

            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap'
                  : 'bg-muted rounded-bl-sm'
              )}
            >
              {msg.role === 'user'
                ? msg.parts.map((part, i) =>
                    part.type === 'text' ? <span key={i}>{part.text}</span> : null
                  )
                : (
                  <MessageResponse>
                    {msg.parts
                      .filter((p) => p.type === 'text')
                      .map((p) => (p as { type: 'text'; text: string }).text)
                      .join('')}
                  </MessageResponse>
                )
              }
            </div>

            {msg.role === 'user' && (
              <div className="shrink-0 rounded-full bg-secondary p-1.5 h-7 w-7 flex items-center justify-center mt-0.5">
                <User className="size-4" />
              </div>
            )}
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 justify-start">
            <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center">
              <Bot className="size-4 text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-2 items-center text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>Erro ao conectar com o agente. Tente novamente.</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          placeholder="Pergunte ao agente RM…"
          className="min-h-[44px] max-h-32 resize-none text-sm"
          rows={1}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={isStreaming}
          className="shrink-0 h-[44px] w-[44px]"
        >
          {isStreaming
            ? <Loader2 className="size-4 animate-spin" />
            : <Send className="size-4" />
          }
        </Button>
      </div>
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToApi(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`
}

function fmtIso(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function periodFromImport(imp: PriceImportSummary): { startDate: string; endDate: string } {
  const todayIso = new Date().toISOString().slice(0, 10)
  return {
    startDate: isoToApi(imp.valid_from),
    endDate: isoToApi(imp.valid_until ?? todayIso),
  }
}

// ─── Seletor de tabela + período (usado em cada lado do comparativo) ───────────

interface TableSelectorProps {
  label: string
  imports: PriceImportSummary[]
  selectedId: string
  onSelect: (id: string) => void
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
}

function TablePeriodSelector({ label, imports, selectedId, onSelect, start, end, onStartChange, onEndChange }: TableSelectorProps) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring w-full"
      >
        {imports.map((imp) => (
          <option key={imp.id} value={imp.id}>
            {fmtIso(imp.valid_from)} → {imp.valid_until ? fmtIso(imp.valid_until) : 'atualmente'}
            {imp.is_active ? ' ●' : ''}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={toInputDate(start)}
          max={toInputDate(end)}
          onChange={(e) => e.target.value && onStartChange(fromInputDate(e.target.value))}
          className="h-6 flex-1 min-w-0 rounded border bg-background px-1.5 text-[11px] text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-[10px] text-muted-foreground shrink-0">→</span>
        <input
          type="date"
          value={toInputDate(end)}
          min={toInputDate(start)}
          onChange={(e) => e.target.value && onEndChange(fromInputDate(e.target.value))}
          className="h-6 flex-1 min-w-0 rounded border bg-background px-1.5 text-[11px] text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  )
}

// ─── Outer component ──────────────────────────────────────────────────────────

interface AgenteChatProps {
  unitSlug: string
  priceImports?: PriceImportSummary[]
}

export function AgenteChat({ unitSlug, priceImports = [] }: AgenteChatProps) {
  const searchParams = useSearchParams()
  const activeSlug = searchParams.get('unit') ?? unitSlug

  const hasComparison = priceImports.length >= 2

  // ── Modo comparativo (2+ tabelas) ─────────────────────────────────────────
  // Padrão: esquerda = tabela mais antiga, direita = tabela mais recente (is_active)
  // priceImports vem ordenado por valid_from DESC → índice 0 = mais recente
  const newestImport  = priceImports[0]
  const previousImport = priceImports[1] ?? priceImports[0]

  const [leftId,  setLeftId]  = useState(previousImport?.id ?? '')
  const [rightId, setRightId] = useState(newestImport?.id  ?? '')

  const leftImp  = priceImports.find((i) => i.id === leftId)  ?? previousImport
  const rightImp = priceImports.find((i) => i.id === rightId) ?? newestImport

  const [leftPeriod,  setLeftPeriod]  = useState(() => leftImp  ? periodFromImport(leftImp)  : getDefaultDateRange())
  const [rightPeriod, setRightPeriod] = useState(() => rightImp ? periodFromImport(rightImp) : getDefaultDateRange())

  function handleLeftSelect(id: string) {
    setLeftId(id)
    const imp = priceImports.find((i) => i.id === id)
    if (imp) setLeftPeriod(periodFromImport(imp))
  }

  function handleRightSelect(id: string) {
    setRightId(id)
    const imp = priceImports.find((i) => i.id === id)
    if (imp) setRightPeriod(periodFromImport(imp))
  }

  // ── Modo simples (0–1 tabela) ──────────────────────────────────────────────
  const singleImport = priceImports[0]
  const singleDefaults = singleImport ? periodFromImport(singleImport) : getDefaultDateRange()
  const [singleStart, setSingleStart] = useState(singleDefaults.startDate)
  const [singleEnd,   setSingleEnd]   = useState(singleDefaults.endDate)
  const [singlePendingStart, setSinglePendingStart] = useState(singleDefaults.startDate)
  const [singlePendingEnd,   setSinglePendingEnd]   = useState(singleDefaults.endDate)
  const singleDirty = singlePendingStart !== singleStart || singlePendingEnd !== singleEnd

  // ── Estado compartilhado ───────────────────────────────────────────────────
  const [chatKey, setChatKey] = useState(0)
  const [applied, setApplied] = useState({
    leftId, rightId,
    leftPeriod, rightPeriod,
    singleStart, singleEnd,
  })

  function apply() {
    setApplied({ leftId, rightId, leftPeriod, rightPeriod, singleStart: singlePendingStart, singleEnd: singlePendingEnd })
    setSingleStart(singlePendingStart)
    setSingleEnd(singlePendingEnd)
    setChatKey((k) => k + 1)
  }

  const comparisonDirty = hasComparison && (
    applied.leftId !== leftId || applied.rightId !== rightId ||
    applied.leftPeriod.startDate !== leftPeriod.startDate ||
    applied.leftPeriod.endDate   !== leftPeriod.endDate   ||
    applied.rightPeriod.startDate !== rightPeriod.startDate ||
    applied.rightPeriod.endDate   !== rightPeriod.endDate
  )

  // Para o chat: KPI usa o período combinado (do mais antigo ao mais recente)
  const combinedStart = hasComparison
    ? (leftPeriod.startDate < rightPeriod.startDate ? leftPeriod.startDate : rightPeriod.startDate)
    : applied.singleStart
  const combinedEnd = hasComparison
    ? (leftPeriod.endDate > rightPeriod.endDate ? leftPeriod.endDate : rightPeriod.endDate)
    : applied.singleEnd

  return (
    <div className="flex flex-1 flex-col rounded-xl border bg-card overflow-hidden min-h-0">
      {/* Barra de contexto */}
      <div className="border-b px-3 py-2 bg-muted/30">
        {hasComparison ? (
          /* ── Modo comparativo ─────────────────────────────────────────── */
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <TablePeriodSelector
                label="Tabela A"
                imports={priceImports}
                selectedId={leftId}
                onSelect={handleLeftSelect}
                start={leftPeriod.startDate}
                end={leftPeriod.endDate}
                onStartChange={(v) => setLeftPeriod((p) => ({ ...p, startDate: v }))}
                onEndChange={(v)   => setLeftPeriod((p) => ({ ...p, endDate: v }))}
              />
            </div>

            <div className="flex flex-col items-center pb-1 shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">vs</span>
            </div>

            <div className="flex-1 min-w-[160px]">
              <TablePeriodSelector
                label="Tabela B"
                imports={priceImports}
                selectedId={rightId}
                onSelect={handleRightSelect}
                start={rightPeriod.startDate}
                end={rightPeriod.endDate}
                onStartChange={(v) => setRightPeriod((p) => ({ ...p, startDate: v }))}
                onEndChange={(v)   => setRightPeriod((p) => ({ ...p, endDate: v }))}
              />
            </div>

            {comparisonDirty && (
              <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5 shrink-0 self-end" onClick={apply}>
                <RefreshCw className="size-3" />
                Aplicar
              </Button>
            )}
          </div>
        ) : (
          /* ── Modo simples ─────────────────────────────────────────────── */
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="size-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">Período de análise:</span>
            <Input
              type="date"
              value={toInputDate(singlePendingStart)}
              max={toInputDate(singlePendingEnd)}
              onChange={(e) => e.target.value && setSinglePendingStart(fromInputDate(e.target.value))}
              onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
              className="h-7 text-xs w-36 px-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date"
              value={toInputDate(singlePendingEnd)}
              min={toInputDate(singlePendingStart)}
              onChange={(e) => e.target.value && setSinglePendingEnd(fromInputDate(e.target.value))}
              onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
              className="h-7 text-xs w-36 px-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
            {singleDirty ? (
              <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={apply}>
                <RefreshCw className="size-3" />
                Aplicar
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground/60">({singleStart} — {singleEnd})</span>
            )}
          </div>
        )}
      </div>

      <AgenteChatInner
        key={chatKey}
        unitSlug={activeSlug}
        startDate={combinedStart}
        endDate={combinedEnd}
        priceImportIds={hasComparison ? [leftId, rightId] : undefined}
        priceAnalysisPeriods={hasComparison ? [leftPeriod, rightPeriod] : undefined}
      />
    </div>
  )
}

const SUGESTOES = [
  'Analise o desempenho por dia da semana e categoria',
  'Quais categorias têm maior RevPAR?',
  'Sugira ajustes de preço para o fim de semana',
  'Compare o desempenho com o período anterior',
]
