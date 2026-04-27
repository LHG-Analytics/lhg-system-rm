'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { useSearchParams } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { MessageResponse } from '@/components/ai-elements/message'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
  messages: UIMessage[]
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
  'Consultando dados operacionais',
  'Analisando o período selecionado',
  'Cruzando KPIs com a tabela de preços',
  'Verificando padrões de demanda',
  'Calculando RevPAR e giro',
  'Avaliando oportunidades de precificação',
  'Preparando a análise',
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
      }, 350)
    }, 3500)
    return () => clearInterval(cycle)
  }, [])

  return (
    <div className="flex gap-3 justify-start">
      <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center">
        <Bot className="size-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2 min-w-[180px]">
        <span
          className={cn(
            'text-xs text-muted-foreground transition-opacity duration-300',
            visible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {THINKING_PHRASES[idx]}
        </span>
        <span className="flex gap-[3px] items-center shrink-0 mt-px">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block size-[3px] rounded-full bg-muted-foreground/50 animate-bounce"
              style={{ animationDelay: `${i * 0.18}s`, animationDuration: '1.1s' }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

// ─── Bubble "aguardando resposta" (conversa retomada sem resposta) ────────────

function AwaitingBubble() {
  return (
    <div className="flex gap-3 justify-start">
      <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center">
        <Bot className="size-4 text-primary" />
      </div>
      <div className="bg-muted/60 rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2 border border-dashed border-muted-foreground/20">
        <Clock className="size-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground/70">
          Preparando resposta… você será notificado quando estiver pronta.
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

// ─── Saudação personalizada ───────────────────────────────────────────────────

function computeGreeting(displayName?: string | null, timezone?: string | null): string {
  const tz = timezone ?? 'America/Sao_Paulo'
  const hourStr = new Date().toLocaleString('pt-BR', { timeZone: tz, hour: '2-digit', hour12: false })
  const hour = parseInt(hourStr, 10)
  const period = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const firstName = displayName?.trim().split(' ')[0]
  return firstName ? `${period}, ${firstName}` : `${period}!`
}

// ─── Inner chat (recriado quando key muda) ────────────────────────────────────

interface AgenteChatInnerProps {
  unitSlug: string
  unitId: string
  initialMessages?: UIMessage[]
  conversationId?: string | null
  /** true quando a conversa foi retomada e ainda aguarda resposta do servidor */
  isAwaitingResponse?: boolean
  displayName?: string | null
  timezone?: string | null
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
  onNavigateToProposals?: () => void
}

function AgenteChatInner({
  unitSlug, unitId,
  initialMessages, conversationId,
  isAwaitingResponse,
  displayName, timezone,
  onConversationCreated, onMessagesUpdate, onProposalSaved, onNavigateToProposals,
}: AgenteChatInnerProps) {
  const convIdRef = useRef<string | null>(conversationId ?? null)

  // body como função: DefaultChatTransport chama resolve(body) a cada request
  const getBody = useRef(() => ({
    unitSlug,
    convId: convIdRef.current ?? undefined,
  }))

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: getBody.current,
    }),
    messages: initialMessages,
  })

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

  // ─── Option Cards ──────────────────────────────────────────────────────────
  function OptionCards({ options, onSelect }: {
    options: Array<{ label: string; texto: string; descricao?: string }>
    onSelect: (label: string, texto: string) => void
  }) {
    const count = options.length
    return (
      <div className={cn(
        'ml-10 grid gap-2',
        count >= 4 ? 'grid-cols-2' : 'grid-cols-1 max-w-sm'
      )}>
        {options.map((opt, i) => {
          const isEmpty = !opt.texto || opt.texto === ''
          return (
            <button
              key={i}
              onClick={() => onSelect(opt.label, opt.texto)}
              className={cn(
                'group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left',
                'transition-all duration-150 cursor-pointer select-none',
                'hover:bg-accent hover:border-primary/30 hover:shadow-sm active:scale-[0.98]',
                isEmpty
                  ? 'border-dashed border-muted-foreground/30 text-muted-foreground bg-transparent'
                  : 'border-border/60 bg-background'
              )}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium leading-snug">{opt.label}</span>
                {opt.descricao && (
                  <span className="text-xs text-muted-foreground leading-snug">{opt.descricao}</span>
                )}
              </div>
              <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
            </button>
          )
        })}
      </div>
    )
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevMessageCountRef = useRef(0)
  const isSubmittingRef = useRef(false)

  function scrollToBottom() {
    const el = scrollAreaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  function isNearBottom() {
    const el = scrollAreaRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }

  function handleScroll() {
    // Se o usuário scrollou para cima (longe do fundo), para o auto-scroll
    // Se voltou perto do fundo, reativa
    userScrolledUpRef.current = !isNearBottom()
  }

  useEffect(() => {
    const newMessageAdded = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length
    if (newMessageAdded) {
      const lastMsg = messages[messages.length - 1]
      // Nova mensagem do usuário → sempre scroll pro fundo
      if (lastMsg?.role === 'user') {
        userScrolledUpRef.current = false
        scrollToBottom()
        return
      }
    }
    // Durante streaming ou nova msg do assistente: só scrolla se estiver perto do fundo
    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [messages])

  const isStreaming = status === 'streaming' || status === 'submitted'

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')
  const quickReplies: Array<{ label: string; texto: string; descricao?: string }> = (() => {
    if (!lastAssistantMsg) return []
    const sugerirPart = lastAssistantMsg.parts
      .filter(isToolUIPart)
      .filter((p) => getToolName(p) === 'sugerir_respostas' && (p as { state: string }).state === 'output-available')
      .at(-1)
    if (!sugerirPart) return []
    const out = (sugerirPart as { output: unknown }).output as { opcoes: Array<{ label: string; texto: string; descricao?: string }> } | undefined
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

    if (!convIdRef.current && unitId) {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const title = text.slice(0, 80)
        const initialUserMsg: UIMessage = {
          id: Math.random().toString(36).slice(2, 12),
          role: 'user',
          parts: [{ type: 'text', text }],
        }
        const { data } = await supabase
          .from('rm_conversations')
          .insert({
            unit_id: unitId,
            user_id: user.id,
            title,
            messages: JSON.parse(JSON.stringify([initialUserMsg])),
          })
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

  // Conversa retomada aguardando resposta: input desabilitado até chegar
  const awaitingOnly = isAwaitingResponse && messages.length > 0 &&
    messages[messages.length - 1].role === 'user' && !isStreaming

  return (
    <>
      <div ref={scrollAreaRef} onScroll={handleScroll} className="flex flex-col flex-1 overflow-y-auto p-4 gap-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center px-4">
            <div className="rounded-full bg-primary/10 p-4 shadow-sm">
              <Bot className="size-9 text-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-2xl font-semibold tracking-tight">
                {computeGreeting(displayName, timezone)}
              </h2>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                Como posso ajudar com a gestão de receitas hoje?
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (textareaRef.current) textareaRef.current.value = s
                    textareaRef.current?.focus()
                  }}
                  className="text-xs rounded-full border px-3.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:border-border transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'assistant') {
            const hasVisible = msg.parts.some(
              (p) => (p.type === 'text' && (p as { type: 'text'; text: string }).text.length > 0) ||
                     (isToolUIPart(p) && getToolName(p) !== 'sugerir_respostas')
            )
            if (!hasVisible) return null
          }
          return (
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
                {msg.parts
                  .filter(isToolUIPart)
                  .map((p, i) => {
                    const toolName = getToolName(p)
                    const state = (p as { state: string }).state

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

                    if (toolName === 'sugerir_respostas') return null

                    if (toolName === 'salvar_proposta' && (state === 'call' || state === 'partial-call')) {
                      return <ProposalGeneratingSteps key={i} />
                    }

                    return <ToolCallChip key={i} toolName={toolName} state={state} />
                  })
                }
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
          )
        })}

        {/* Option cards inline — aparece após a última resposta do agente */}
        {!isStreaming && !awaitingOnly && quickReplies.length > 0 && (
          <OptionCards
            options={quickReplies}
            onSelect={(label, texto) => {
              if (texto === '__propostas') {
                onNavigateToProposals?.()
              } else if (texto) {
                if (textareaRef.current) textareaRef.current.value = texto
                submit()
              } else {
                textareaRef.current?.focus()
              }
            }}
          />
        )}

        {/* Indicador: aguardando resposta do servidor (conversa retomada) */}
        {awaitingOnly && <AwaitingBubble />}

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

      {/* Input */}
      <div className="border-t p-3 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          placeholder={awaitingOnly ? 'Aguardando resposta do agente…' : 'Pergunte ao agente RM…'}
          className="min-h-[44px] max-h-32 resize-none text-sm"
          rows={1}
          onKeyDown={handleKeyDown}
          disabled={isStreaming || awaitingOnly}
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={isStreaming || awaitingOnly}
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
  selectedConvId?: string | null
  selectedMessages?: UIMessage[]
  isAwaitingResponse?: boolean
  displayName?: string | null
  timezone?: string | null
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
  onNavigateToProposals?: () => void
}

export function AgenteChat({
  unitSlug, unitId,
  selectedConvId: externalConvId,
  selectedMessages: externalMessages,
  isAwaitingResponse,
  displayName, timezone,
  onConversationCreated: externalOnCreated,
  onMessagesUpdate: externalOnUpdate,
  onProposalSaved,
  onNavigateToProposals,
}: AgenteChatProps) {
  const searchParams = useSearchParams()
  const activeSlug = searchParams.get('unit') ?? unitSlug

  return (
    <AgenteChatInner
      unitSlug={activeSlug}
      unitId={activeSlug ? unitId : ''}
      initialMessages={externalMessages}
      conversationId={externalConvId}
      isAwaitingResponse={isAwaitingResponse}
      displayName={displayName}
      timezone={timezone}
      onConversationCreated={externalOnCreated}
      onMessagesUpdate={externalOnUpdate}
      onProposalSaved={onProposalSaved}
      onNavigateToProposals={onNavigateToProposals}
    />
  )
}

const SUGESTOES = [
  'Analise o desempenho por dia da semana e categoria',
  'Quais categorias têm maior RevPAR?',
  'Sugira ajustes de preço para o fim de semana',
  'Compare o desempenho com o período anterior',
]
