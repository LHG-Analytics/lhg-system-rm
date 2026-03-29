'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { useSearchParams } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, CalendarIcon, RefreshCw, Plus, MessageSquare, Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { MessageResponse } from '@/components/ai-elements/message'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
  messages: UIMessage[]
}

export interface PriceImportSummary {
  id: string
  imported_at: string
  canals: string[]
  is_active: boolean
  valid_from: string
  valid_until: string | null
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// DD/MM/YYYY → YYYY-MM-DD
function toIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// YYYY-MM-DD → DD/MM/YYYY
function fromIso(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

// Date → YYYY-MM-DD
function dateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// YYYY-MM-DD → Date (local, sem timezone shift)
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// DD/MM/YYYY → "19 nov 25" (label compacto para chip)
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
function fmtChip(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return `${parseInt(d)} ${MESES[parseInt(m) - 1]} ${y.slice(2)}`
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

// ─── Tool call chip (feedback visual durante execução de ferramentas) ────────

const TOOL_META: Record<string, { loadingText: string; doneText: string }> = {
  buscar_kpis_periodo: {
    loadingText: 'Buscando dados do período…',
    doneText: 'Dados do período carregados',
  },
  buscar_dados_automo: {
    loadingText: 'Consultando ERP…',
    doneText: 'ERP consultado',
  },
  gerar_heatmap: {
    loadingText: 'Gerando mapa de calor…',
    doneText: 'Mapa de calor gerado',
  },
}

function ToolCallChip({ toolName, state }: { toolName: string; state: string }) {
  const meta = TOOL_META[toolName]
  const isLoading = state === 'call' || state === 'partial-call'
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium w-fit',
      isLoading
        ? 'bg-primary/10 text-primary'
        : 'bg-green-500/10 text-green-600 dark:text-green-400'
    )}>
      {isLoading
        ? <Loader2 className="size-3 animate-spin" />
        : <CheckCircle2 className="size-3" />}
      <span>{isLoading ? (meta?.loadingText ?? 'Processando…') : (meta?.doneText ?? 'Concluído')}</span>
    </div>
  )
}

// ─── Inner chat (recriado quando key muda) ────────────────────────────────────

interface AgenteChatInnerProps {
  unitSlug: string
  unitId: string
  startDate: string
  endDate: string
  priceImportIds?: string[]
  priceAnalysisPeriods?: { startDate: string; endDate: string }[]
  initialMessages?: UIMessage[]
  conversationId?: string | null
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
}

function AgenteChatInner({
  unitSlug, unitId, startDate, endDate,
  priceImportIds, priceAnalysisPeriods,
  initialMessages, conversationId,
  onConversationCreated, onMessagesUpdate,
}: AgenteChatInnerProps) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: { unitSlug, startDate, endDate, priceImportIds, priceAnalysisPeriods },
    }),
    messages: initialMessages,
  })

  // Ref para o ID da conversa ativa (não precisa triggerar re-render)
  const convIdRef = useRef<string | null>(conversationId ?? null)

  // Salva mensagens sempre que o streaming termina
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current !== 'ready' && status === 'ready' && messages.length > 0 && convIdRef.current) {
      onMessagesUpdate?.(convIdRef.current, messages as UIMessage[])
    }
    prevStatusRef.current = status
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function submit() {
    const text = textareaRef.current?.value.trim()
    if (!text || isStreaming) return

    // Cria a conversa no Supabase ao enviar a primeira mensagem
    if (!convIdRef.current && unitId) {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const title = text.slice(0, 80)
        const { data } = await supabase
          .from('rm_conversations')
          .insert({ unit_id: unitId, user_id: user.id, title, messages: [] })
          .select('id')
          .single()
        if (data) {
          convIdRef.current = data.id
          onConversationCreated?.(data.id, title)
        }
      }
    }

    sendMessage({ text })
    if (textareaRef.current) textareaRef.current.value = ''
  }

  return (
    <>
      {/* Área de mensagens */}
      <div ref={scrollAreaRef} onScroll={handleScroll} className="flex flex-col flex-1 overflow-y-auto p-4 gap-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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

            {msg.role === 'user' ? (
              <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap">
                {msg.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null
                )}
              </div>
            ) : (
              <div className={cn(
                'flex flex-col gap-2',
                // Se tem heatmap, ocupa largura total; senão, limita a 80%
                msg.parts.some((p) => isToolUIPart(p) && getToolName(p) === 'gerar_heatmap' && (p as { state: string }).state === 'output-available')
                  ? 'w-full'
                  : 'max-w-[80%]'
              )}>
                {/* Tool parts: chips de loading/done + heatmap inline */}
                {msg.parts
                  .filter(isToolUIPart)
                  .map((p, i) => {
                    const toolName = getToolName(p)
                    const state = (p as { state: string }).state

                    // Heatmap com output disponível: renderiza componente visual
                    if (toolName === 'gerar_heatmap' && state === 'output-available') {
                      const output = (p as { output: unknown }).output as
                        | { startDate: string; endDate: string; metric: 'giro' | 'ocupacao'; rangeLabel: string; unitSlug: string }
                        | { error: string }
                      if ('error' in output) {
                        return (
                          <div key={i} className="flex gap-2 items-center text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                            <AlertCircle className="size-4 shrink-0" />
                            <span>{output.error}</span>
                          </div>
                        )
                      }
                      return (
                        <OccupancyHeatmap
                          key={i}
                          unitSlug={output.unitSlug}
                          startDate={output.startDate}
                          endDate={output.endDate}
                          rangeLabel={output.rangeLabel}
                        />
                      )
                    }

                    // Outros tools: chip animado
                    return <ToolCallChip key={i} toolName={toolName} state={state} />
                  })
                }
                {/* Text bubble */}
                {(() => {
                  const text = msg.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { type: 'text'; text: string }).text)
                    .join('')
                  return text ? (
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
                      <MessageResponse>{text}</MessageResponse>
                    </div>
                  ) : null
                })()}
              </div>
            )}

            {msg.role === 'user' && (
              <div className="shrink-0 rounded-full bg-secondary p-1.5 h-7 w-7 flex items-center justify-center mt-0.5">
                <User className="size-4" />
              </div>
            )}
          </div>
        ))}

        {isStreaming && (() => {
          const last = messages[messages.length - 1]
          if (!last || last.role === 'user') return true
          // Mostra spinner enquanto mensagem do assistant não tem texto nem tool chips
          const hasContent = last.parts.some(
            (p) => (p.type === 'text' && (p as { type: 'text'; text: string }).text.length > 0) || isToolUIPart(p)
          )
          return !hasContent
        })() && (
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

// ─── DateChip: botão que abre Calendar num Popover ────────────────────────────

interface DateChipProps {
  value: string   // DD/MM/YYYY
  onChange: (v: string) => void
  min?: string    // DD/MM/YYYY
  max?: string    // DD/MM/YYYY
  placeholder?: string
}

function DateChip({ value, onChange, min, max, placeholder }: DateChipProps) {
  const [open, setOpen] = useState(false)
  const selected = value ? isoToDate(toIso(value)) : undefined
  const fromDate = min ? isoToDate(toIso(min)) : undefined
  const toDate   = max ? isoToDate(toIso(max)) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex items-center gap-1.5 h-7 flex-1 rounded-md border bg-background px-2 text-xs',
          'text-foreground cursor-pointer transition-colors hover:bg-accent hover:border-accent-foreground/20',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}>
          <CalendarIcon className="size-3 text-muted-foreground shrink-0" />
          <span className="truncate">{value ? fmtChip(value) : (placeholder ?? '—')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) { onChange(fromIso(dateToIso(date))); setOpen(false) }
          }}
          disabled={(date) => {
            if (fromDate && date < fromDate) return true
            if (toDate   && date > toDate)   return true
            return false
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
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

// Corpo do seletor sem label (label fica no grid externo)
function TableSelectorBody({ imports, selectedId, onSelect, start, end, onStartChange, onEndChange }: Omit<TableSelectorProps, 'label'>) {
  return (
    <div className="flex flex-col gap-2 w-[220px]">
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger className="h-8 text-xs w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {imports.map((imp) => (
            <SelectItem key={imp.id} value={imp.id} className="text-xs">
              {fmtIso(imp.valid_from)} → {imp.valid_until ? fmtIso(imp.valid_until) : 'atualmente'}
              {imp.is_active ? '  ●' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5 w-full">
        <DateChip value={start} onChange={onStartChange} max={end} />
        <span className="text-[10px] text-muted-foreground/40 shrink-0">→</span>
        <DateChip value={end} onChange={onEndChange} min={start} />
      </div>
    </div>
  )
}

// Mantido para compatibilidade de tipo (não usado no comparativo direto)
function TablePeriodSelector(props: TableSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{props.label}</span>
      <TableSelectorBody {...props} />
    </div>
  )
}

// ─── Outer component ──────────────────────────────────────────────────────────

interface AgenteChatProps {
  unitSlug: string
  unitId: string
  priceImports?: PriceImportSummary[]
}

export function AgenteChat({ unitSlug, unitId, priceImports = [] }: AgenteChatProps) {
  const searchParams = useSearchParams()
  const activeSlug = searchParams.get('unit') ?? unitSlug

  // ── Histórico de conversas ─────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<UIMessage[]>([])

  useEffect(() => {
    if (!unitId) return
    loadConversations()
  }, [unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadConversations() {
    const supabase = createClient()
    const { data } = await supabase
      .from('rm_conversations')
      .select('id, title, updated_at, messages')
      .eq('unit_id', unitId)
      .order('updated_at', { ascending: false })
      .limit(30)
    setConversations((data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updated_at: c.updated_at,
      messages: (c.messages as unknown as UIMessage[]) ?? [],
    })))
  }

  function handleSelectConversation(conv: ConversationSummary) {
    setSelectedConvId(conv.id)
    setSelectedMessages(conv.messages)
    setChatKey((k) => k + 1)
  }

  function handleNewConversation() {
    setSelectedConvId(null)
    setSelectedMessages([])
    setChatKey((k) => k + 1)
  }

  function handleConversationCreated(id: string, title: string) {
    setSelectedConvId(id)
    setConversations((prev) => [
      { id, title, updated_at: new Date().toISOString(), messages: [] },
      ...prev,
    ])
  }

  async function handleMessagesUpdate(id: string, msgs: UIMessage[]) {
    const supabase = createClient()
    await supabase
      .from('rm_conversations')
      .update({ messages: JSON.parse(JSON.stringify(msgs)) })
      .eq('id', id)
    // Atualiza lista local
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, messages: msgs, updated_at: new Date().toISOString() } : c))
    )
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const supabase = createClient()
    await supabase.from('rm_conversations').delete().eq('id', id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (selectedConvId === id) handleNewConversation()
  }

  function fmtDate(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Ontem'
    if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' })
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }

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
    <div className="flex flex-1 min-h-0 gap-3">

      {/* ── Painel de histórico ─────────────────────────────────────────── */}
      <div className="w-52 shrink-0 flex flex-col rounded-xl border bg-card overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b">
          <Button
            variant="default"
            size="sm"
            className="w-full h-7 text-xs gap-1.5"
            onClick={handleNewConversation}
          >
            <Plus className="size-3" />
            Nova conversa
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {conversations.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-6 px-3">
              Nenhuma conversa ainda
            </p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectConversation(conv)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSelectConversation(conv)}
                className={cn(
                  'group w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-accent transition-colors cursor-pointer',
                  selectedConvId === conv.id && 'bg-accent'
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[11px] font-medium leading-snug line-clamp-2 flex-1 text-foreground">
                    {conv.title ?? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="size-3 shrink-0" />
                        Conversa
                      </span>
                    )}
                  </span>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:text-destructive transition-all"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground/60">
                  {fmtDate(conv.updated_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Chat card ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col rounded-xl border bg-card overflow-hidden min-h-0">
      {/* Barra de contexto */}
      <div className="border-b px-4 py-3 bg-muted/20">
        {hasComparison ? (
          /* ── Modo comparativo ─────────────────────────────────────────── */
          <div className="flex flex-col items-center gap-1.5">
            {/* Grid 3 colunas: label A | vazio | label B */}
            <div className="grid grid-cols-[220px_48px_220px] items-end">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Tabela A</span>
              <div />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Tabela B</span>
            </div>
            {/* Grid 3 colunas: body A | vs (centrado no Select) | body B */}
            <div className="grid grid-cols-[220px_48px_220px] items-start">
              <TableSelectorBody
                imports={priceImports}
                selectedId={leftId}
                onSelect={handleLeftSelect}
                start={leftPeriod.startDate}
                end={leftPeriod.endDate}
                onStartChange={(v) => setLeftPeriod((p) => ({ ...p, startDate: v }))}
                onEndChange={(v)   => setLeftPeriod((p) => ({ ...p, endDate: v }))}
              />
              {/* h-8 = altura do Select, flex centra o "vs" verticalmente nele */}
              <div className="flex items-center justify-center h-8">
                <span className="text-[11px] font-bold tracking-widest text-muted-foreground/30 uppercase">vs</span>
              </div>
              <TableSelectorBody
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
              <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 mt-0.5" onClick={apply}>
                <RefreshCw className="size-3" />
                Aplicar
              </Button>
            )}
          </div>
        ) : (
          /* ── Modo simples ─────────────────────────────────────────────── */
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">Período de análise:</span>
            <DateChip
              value={singlePendingStart}
              onChange={setSinglePendingStart}
              max={singlePendingEnd}
            />
            <span className="text-xs text-muted-foreground/50">→</span>
            <DateChip
              value={singlePendingEnd}
              onChange={setSinglePendingEnd}
              min={singlePendingStart}
            />
            {singleDirty && (
              <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={apply}>
                <RefreshCw className="size-3" />
                Aplicar
              </Button>
            )}
          </div>
        )}
      </div>

      <AgenteChatInner
        key={chatKey}
        unitSlug={activeSlug}
        unitId={activeSlug ? unitId : ''}
        startDate={combinedStart}
        endDate={combinedEnd}
        priceImportIds={hasComparison ? [leftId, rightId] : undefined}
        priceAnalysisPeriods={hasComparison ? [leftPeriod, rightPeriod] : undefined}
        initialMessages={selectedMessages}
        conversationId={selectedConvId}
        onConversationCreated={handleConversationCreated}
        onMessagesUpdate={handleMessagesUpdate}
      />
      </div>
    </div>
  )
}

const SUGESTOES = [
  'Analise o desempenho por dia da semana e categoria',
  'Quais categorias têm maior RevPAR?',
  'Sugira ajustes de preço para o fim de semana',
  'Compare o desempenho com o período anterior',
]
