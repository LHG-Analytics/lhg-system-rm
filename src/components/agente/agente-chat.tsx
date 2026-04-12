'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import type { DateRange } from 'react-day-picker'
import { useSearchParams } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, CalendarIcon, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { MessageResponse } from '@/components/ai-elements/message'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'
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

// Date → "01/04/25" (label compacto)
function fmtRange(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear()).slice(2)
  return `${day}/${month}/${year}`
}

// Retorna range padrão: vigência do import ativo ou últimos 30 dias
function getDefaultRange(imports: PriceImportSummary[]): { from: Date; to: Date } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const active = imports.find((i) => i.is_active) ?? imports[0]
  if (active) {
    return { from: isoToDate(active.valid_from), to: today }
  }
  const from = new Date(today)
  from.setDate(from.getDate() - 29)
  return { from, to: today }
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
  salvar_proposta: {
    loadingText: 'Salvando proposta…',
    doneText:    '✓ Proposta salva — acesse a aba Propostas para aprovar',
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

// ─── Thinking bubble com frases rotativas ────────────────────────────────────

const THINKING_PHRASES = [
  'Consultando dados operacionais…',
  'Analisando o período selecionado…',
  'Cruzando KPIs com a tabela de preços…',
  'Verificando padrões de demanda…',
  'Calculando RevPAR e giro…',
  'Avaliando oportunidades de precificação…',
  'Preparando a análise…',
]

function ThinkingBubble() {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const cycle = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx((i) => (i + 1) % THINKING_PHRASES.length)
        setVisible(true)
      }, 250)
    }, 2200)
    return () => clearInterval(cycle)
  }, [])

  return (
    <div className="flex gap-3 justify-start">
      <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center">
        <Bot className="size-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2.5 min-w-[180px]">
        {/* 3 dots bounce */}
        <div className="flex gap-1 items-end h-4 shrink-0">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block size-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
            />
          ))}
        </div>
        <span
          className={cn(
            'text-xs text-muted-foreground transition-opacity duration-200',
            visible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {THINKING_PHRASES[idx]}
        </span>
      </div>
    </div>
  )
}

const PROPOSAL_STEP_LABELS = [
  'Analisando tabelas de preços…',
  'Verificando KPIs do período…',
  'Calculando variações…',
  'Montando proposta…',
]

function ProposalGeneratingSteps() {
  const [stepIdx, setStepIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStepIdx((s) => Math.min(s + 1, PROPOSAL_STEP_LABELS.length - 1)), 1400)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex flex-col gap-2 w-fit">
      {PROPOSAL_STEP_LABELS.map((label, i) => (
        <div key={label} className={cn(
          'flex items-center gap-2 text-xs transition-all duration-300',
          i < stepIdx ? 'text-emerald-500' : i === stepIdx ? 'text-primary' : 'text-muted-foreground/30'
        )}>
          {i < stepIdx
            ? <CheckCircle2 className="size-3.5 shrink-0" />
            : i === stepIdx
              ? <Loader2 className="size-3.5 animate-spin shrink-0" />
              : <div className="size-3.5 rounded-full border border-current shrink-0 opacity-30" />
          }
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Inner chat (recriado quando key muda) ────────────────────────────────────

interface AgenteChatInnerProps {
  unitSlug: string
  unitId: string
  dateFrom: string   // YYYY-MM-DD
  dateTo: string     // YYYY-MM-DD
  initialMessages?: UIMessage[]
  conversationId?: string | null
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
}

function AgenteChatInner({
  unitSlug, unitId, dateFrom, dateTo,
  initialMessages, conversationId,
  onConversationCreated, onMessagesUpdate, onProposalSaved,
}: AgenteChatInnerProps) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: { unitSlug, dateFrom, dateTo },
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

  // Dispara onProposalSaved quando salvar_proposta termina com sucesso
  useEffect(() => {
    if (status !== 'ready') return
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return
    const saved = lastAssistant.parts
      .filter(isToolUIPart)
      .some(
        (p) =>
          getToolName(p) === 'salvar_proposta' &&
          (p as { state: string }).state === 'output-available' &&
          ((p as { output: unknown }).output as { success?: boolean })?.success === true
      )
    if (saved) onProposalSaved?.()
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const isSubmittingRef = useRef(false)

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

  // Deriva quick replies da última mensagem do assistant
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')
  const quickReplies: Array<{ label: string; texto: string }> = (() => {
    if (!lastAssistantMsg) return []
    const sugerirPart = lastAssistantMsg.parts
      .filter(isToolUIPart)
      .filter((p) => getToolName(p) === 'sugerir_respostas' && (p as { state: string }).state === 'output-available')
      .at(-1)
    if (!sugerirPart) return []
    const out = (sugerirPart as { output: unknown }).output as { opcoes: Array<{ label: string; texto: string }> } | undefined
    return out?.opcoes ?? []
  })()

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  async function submit() {
    const text = textareaRef.current?.value.trim()
    if (!text || isStreaming || isSubmittingRef.current) return
    isSubmittingRef.current = true

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
    isSubmittingRef.current = false
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

                    // sugerir_respostas é renderizado como quick replies, não como chip
                    if (toolName === 'sugerir_respostas') return null

                    // salvar_proposta em loading: etapas animadas
                    if (toolName === 'salvar_proposta' && (state === 'call' || state === 'partial-call')) {
                      return <ProposalGeneratingSteps key={i} />
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
          const hasContent = last.parts.some(
            (p) => (p.type === 'text' && (p as { type: 'text'; text: string }).text.length > 0) || isToolUIPart(p)
          )
          return !hasContent
        })() && <ThinkingBubble />}

        {error && (
          <div className="flex gap-2 items-center text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>Erro ao conectar com o agente. Tente novamente.</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies */}
      {!isStreaming && quickReplies.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex flex-wrap gap-2 border-t">
          {quickReplies.map((opt, i) => (
            <button
              key={i}
              className="text-xs rounded-full border px-3 py-1.5 bg-background hover:bg-accent transition-colors text-foreground"
              onClick={() => {
                if (opt.texto) {
                  if (textareaRef.current) textareaRef.current.value = opt.texto
                  submit()
                } else {
                  textareaRef.current?.focus()
                }
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

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

// ─── Outer component ──────────────────────────────────────────────────────────

interface AgenteChatProps {
  unitSlug: string
  unitId: string
  priceImports?: PriceImportSummary[]
  selectedConvId?: string | null
  selectedMessages?: UIMessage[]
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
}

export function AgenteChat({
  unitSlug, unitId, priceImports = [],
  selectedConvId: externalConvId,
  selectedMessages: externalMessages,
  onConversationCreated: externalOnCreated,
  onMessagesUpdate: externalOnUpdate,
  onProposalSaved,
}: AgenteChatProps) {
  const searchParams = useSearchParams()
  const activeSlug = searchParams.get('unit') ?? unitSlug

  // ── Seletor de período único ───────────────────────────────────────────────
  const defaultRange = getDefaultRange(priceImports)
  const [pending, setPending] = useState<DateRange>({ from: defaultRange.from, to: defaultRange.to })
  const [applied, setApplied] = useState<{ from: Date; to: Date }>(defaultRange)
  const [calOpen, setCalOpen] = useState(false)
  const [chatKey, setChatKey] = useState(0)

  const rangeDirty =
    pending.from?.getTime() !== applied.from.getTime() ||
    pending.to?.getTime()   !== applied.to.getTime()

  function apply() {
    if (!pending.from || !pending.to) return
    setApplied({ from: pending.from, to: pending.to })
    setChatKey((k) => k + 1)
  }

  const dateFrom = dateToIso(applied.from)
  const dateTo   = dateToIso(applied.to)

  // Detecta troca de unidade e remonta o chat
  const prevUnitRef = useRef(unitId)
  useEffect(() => {
    if (prevUnitRef.current !== unitId) {
      prevUnitRef.current = unitId
      const r = getDefaultRange(priceImports)
      setPending({ from: r.from, to: r.to })
      setApplied(r)
      setChatKey((k) => k + 1)
    }
  }, [unitId, priceImports])

  return (
    <>
      {/* Barra de contexto */}
      <div className="border-b px-4 py-3 bg-muted/20 shrink-0">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Período de análise:</span>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button className={cn(
                'flex items-center gap-1.5 h-7 rounded-md border bg-background px-2.5 text-xs',
                'text-foreground cursor-pointer transition-colors hover:bg-accent hover:border-accent-foreground/20',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}>
                <CalendarIcon className="size-3 text-muted-foreground shrink-0" />
                <span>
                  {pending.from ? fmtRange(pending.from) : '—'}
                  <span className="mx-1 text-muted-foreground/50">→</span>
                  {pending.to ? fmtRange(pending.to) : '—'}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="range"
                selected={pending}
                onSelect={(range) => {
                  if (range) setPending(range)
                  if (range?.from && range?.to) setCalOpen(false)
                }}
                numberOfMonths={2}
                disabled={(date) => date > new Date()}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {rangeDirty && pending.from && pending.to && (
            <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={apply}>
              <RefreshCw className="size-3" />
              Aplicar
            </Button>
          )}
        </div>
      </div>

      <AgenteChatInner
        key={chatKey}
        unitSlug={activeSlug}
        unitId={activeSlug ? unitId : ''}
        dateFrom={dateFrom}
        dateTo={dateTo}
        initialMessages={externalMessages}
        conversationId={externalConvId}
        onConversationCreated={externalOnCreated}
        onMessagesUpdate={externalOnUpdate}
        onProposalSaved={onProposalSaved}
      />
    </>
  )
}

const SUGESTOES = [
  'Analise o desempenho por dia da semana e categoria',
  'Quais categorias têm maior RevPAR?',
  'Sugira ajustes de preço para o fim de semana',
  'Compare o desempenho com o período anterior',
]
