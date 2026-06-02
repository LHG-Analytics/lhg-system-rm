'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { useSearchParams } from 'next/navigation'
import { useRef, useEffect, useState } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, CheckCircle2, Clock, ChevronRight, Globe, Lock, ChevronDown } from 'lucide-react'
import { CHAT_MODEL_OPTIONS, DEFAULT_CHAT_MODEL_ID, type ChatModelOption } from '@/lib/agente/model'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { MessageResponse } from '@/components/ai-elements/message'
import { OccupancyHeatmap } from '@/components/dashboard/heatmap'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextMode = 'org' | 'personal'

export interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
  messages: UIMessage[]
  context_mode?: ContextMode
}

// ─── Tool call chip (feedback visual durante execução de ferramentas) ────────

const TOOL_META: Record<string, { loadingText: string }> = {
  buscar_kpis_periodo:   { loadingText: 'Buscando dados do período…' },
  buscar_dados_automo:   { loadingText: 'Consultando ERP…' },
  gerar_heatmap:         { loadingText: 'Gerando mapa de calor…' },
  salvar_proposta:       { loadingText: 'Salvando proposta…' },
}

function ToolCallChip({ toolName, state }: { toolName: string; state: string }) {
  const meta = TOOL_META[toolName]
  const isLoading = state === 'call' || state === 'partial-call'
  if (!isLoading) return null
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium w-fit bg-primary/10 text-primary">
      <Loader2 className="size-3 animate-spin" />
      <span>{meta?.loadingText ?? 'Processando…'}</span>
    </div>
  )
}

// ─── Thinking bubble com dots → typewriter ───────────────────────────────────

const THINKING_PHRASES = [
  'Consultando dados operacionais',
  'Analisando o período selecionado',
  'Cruzando KPIs com a tabela de preços',
  'Verificando padrões de demanda',
  'Calculando RevPAR e giro',
  'Avaliando oportunidades de precificação',
  'Preparando a análise',
]

const DOT_DELAYS = ['0ms', '150ms', '300ms'] as const

function ThinkingBubble() {
  // Fase 1: dots imediatos (feedback instantâneo antes do modelo responder)
  // Fase 2: typewriter com frases rotativas (começa após 700ms)
  const [phase, setPhase] = useState<'dots' | 'typing'>('dots')
  const [idx, setIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const [fading, setFading] = useState(false)

  // Transição dots → typewriter
  useEffect(() => {
    const t = setTimeout(() => setPhase('typing'), 700)
    return () => clearTimeout(t)
  }, [])

  // Typewriter + rotação de frases
  useEffect(() => {
    if (phase !== 'typing' || fading) return
    const text = THINKING_PHRASES[idx]
    if (charIdx < text.length) {
      const t = setTimeout(() => setCharIdx((c) => c + 1), 22)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setFading(true)
      setTimeout(() => {
        setIdx((i) => (i + 1) % THINKING_PHRASES.length)
        setCharIdx(0)
        setFading(false)
      }, 350)
    }, 1600)
    return () => clearTimeout(t)
  }, [charIdx, idx, fading, phase])

  return (
    <div className="flex gap-3 justify-start">
      <div className={cn(
        'shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center transition-opacity',
        phase === 'dots' && 'animate-pulse',
      )}>
        <Bot className="size-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center min-h-[38px] min-w-[160px]">
        {phase === 'dots' ? (
          <div className="flex items-center gap-1.5">
            {DOT_DELAYS.map((delay, i) => (
              <span
                key={i}
                className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
                style={{ animation: `thinking-dot 1.2s ease-in-out infinite ${delay}` }}
              />
            ))}
          </div>
        ) : (
          <span className={cn(
            'text-sm text-muted-foreground transition-opacity duration-350',
            fading ? 'opacity-0' : 'opacity-100',
          )}>
            {THINKING_PHRASES[idx].slice(0, charIdx)}
            <span className={cn(
              'inline-block w-[2px] h-[0.85em] bg-muted-foreground/60 ml-0.5 align-middle',
              fading ? 'opacity-0' : 'animate-pulse',
            )} />
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Bubble "aguardando resposta" (conversa retomada sem resposta) ────────────

function AwaitingBubble({ onUnlock }: { onUnlock?: () => Promise<void> }) {
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlocking, setUnlocking] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowUnlock(true), 30_000)
    return () => clearTimeout(t)
  }, [])

  async function handleUnlock() {
    if (!onUnlock) return
    setUnlocking(true)
    try { await onUnlock() } finally { setUnlocking(false) }
  }

  return (
    <div className="flex gap-3 justify-start">
      <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-7 w-7 flex items-center justify-center">
        <Bot className="size-4 text-primary" />
      </div>
      <div className="bg-muted/60 rounded-2xl rounded-bl-sm px-4 py-2.5 flex flex-col gap-2 border border-dashed border-muted-foreground/20">
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-xs text-muted-foreground/70">
            Preparando resposta… você será notificado quando estiver pronta.
          </span>
        </div>
        {showUnlock && onUnlock && (
          <button
            onClick={handleUnlock}
            disabled={unlocking}
            className="self-start text-xs text-primary/70 hover:text-primary underline underline-offset-2 disabled:opacity-50"
          >
            {unlocking ? 'Desbloqueando…' : 'Parece travado? Desbloquear conversa'}
          </button>
        )}
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

// ─── Typewriter para mensagens em streaming ───────────────────────────────────

function useStreamingTypewriter(targetText: string, active: boolean) {
  const [shown, setShown] = useState(active ? '' : targetText)

  useEffect(() => {
    if (!active) {
      setShown(targetText)
      return
    }
    if (shown.length >= targetText.length) return
    const behind = targetText.length - shown.length
    const chars = behind > 100 ? 4 : behind > 40 ? 2 : 1
    const delay = behind > 80 ? 6 : 14
    const t = setTimeout(() => {
      setShown(targetText.slice(0, shown.length + chars))
    }, delay)
    return () => clearTimeout(t)
  }, [shown, targetText, active])

  return shown
}

function StreamingMessageText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const displayed = useStreamingTypewriter(text, isStreaming)
  return (
    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
      <MessageResponse>{displayed}</MessageResponse>
      {isStreaming && (
        <span className="inline-block w-[2px] h-[0.85em] bg-muted-foreground/60 ml-0.5 align-middle animate-pulse" />
      )}
    </div>
  )
}

// ─── Toggle de modo de contexto ───────────────────────────────────────────────

function ContextModeToggle({ value, onChange }: { value: ContextMode; onChange: (m: ContextMode) => void }) {
  const [current, setCurrent] = useState<ContextMode>(value)
  function select(mode: ContextMode) {
    setCurrent(mode)
    onChange(mode)
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex rounded-lg border bg-muted/40 p-0.5 gap-0.5">
        <button
          onClick={() => select('org')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            current === 'org'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Globe className="size-3.5" />
          Contexto da organização
        </button>
        <button
          onClick={() => select('personal')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            current === 'personal'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Lock className="size-3.5" />
          Contexto interno
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground max-w-xs">
        {current === 'org'
          ? 'Inclui decisões compartilhadas, eventos, regras e memória coletiva da unidade.'
          : 'Apenas KPIs e tabela de preços — sem contexto de outras conversas ou decisões passadas.'}
      </p>
    </div>
  )
}

// ─── Seletor de modelo ────────────────────────────────────────────────────────

const TIER_META: Record<ChatModelOption['tier'], { label: string; dot: string; badge: string }> = {
  fast:      { label: 'Rápido',     dot: 'bg-slate-400',   badge: 'bg-slate-400/10 text-slate-400' },
  balanced:  { label: 'Padrão',     dot: 'bg-blue-500',    badge: 'bg-blue-500/10 text-blue-500' },
  reasoning: { label: 'Raciocínio', dot: 'bg-violet-500',  badge: 'bg-violet-500/10 text-violet-500' },
  powerful:  { label: 'Potente',    dot: 'bg-amber-500',   badge: 'bg-amber-500/10 text-amber-500' },
  max:       { label: 'Máximo',     dot: 'bg-rose-500',    badge: 'bg-rose-500/10 text-rose-500' },
}

const TIER_ACCENT: Record<ChatModelOption['tier'], string> = {
  fast:      'border-l-slate-400/40',
  balanced:  'border-l-blue-500/40',
  reasoning: 'border-l-violet-500/40',
  powerful:  'border-l-amber-500/40',
  max:       'border-l-rose-500/40',
}

const LOCAL_STORAGE_MODEL_KEY = 'lhg-chat-model'

function readStoredModelId(): string {
  try { return localStorage.getItem(LOCAL_STORAGE_MODEL_KEY) ?? DEFAULT_CHAT_MODEL_ID } catch { return DEFAULT_CHAT_MODEL_ID }
}

function ModelSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = CHAT_MODEL_OPTIONS.find((m) => m.id === value) ?? CHAT_MODEL_OPTIONS[1]
  const meta = TIER_META[current.tier]

  function select(id: string) {
    onChange(id)
    setOpen(false)
    try { localStorage.setItem(LOCAL_STORAGE_MODEL_KEY, id) } catch {}
  }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background hover:bg-accent transition-colors text-xs font-medium"
      >
        <span className={cn('size-1.5 rounded-full shrink-0', meta.dot)} />
        <span className="max-w-[80px] truncate sm:max-w-none">{current.label}</span>
        <ChevronDown className={cn('size-3 text-muted-foreground transition-transform duration-200 shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Dropdown: right-aligned, min-width 280px, max 92vw para mobile */}
          <div className="absolute bottom-full mb-2 right-0 z-20 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border/60 bg-popover shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-3 pt-2.5 pb-1.5 border-b border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Modelo de IA</p>
            </div>

            {/* Options */}
            <div className="p-1">
              {CHAT_MODEL_OPTIONS.map((m) => {
                const t = TIER_META[m.tier]
                const isActive = m.id === value
                return (
                  <button
                    key={m.id}
                    onClick={() => select(m.id)}
                    className={cn(
                      'w-full flex items-center gap-3 pl-2 pr-3 py-2.5 rounded-xl text-left transition-colors border-l-2',
                      'hover:bg-accent/60',
                      isActive ? cn('bg-accent/80', TIER_ACCENT[m.tier]) : 'border-l-transparent',
                    )}
                  >
                    {/* Tier badge */}
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 min-w-[62px] text-center', t.badge)}>
                      {t.label}
                    </span>

                    {/* Name + description */}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-xs font-semibold leading-tight">{m.label}</span>
                      <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">{m.description}</span>
                    </div>

                    {isActive && <CheckCircle2 className="size-3.5 text-primary shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
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
  contextMode?: ContextMode
  /** true quando a conversa foi retomada e ainda aguarda resposta do servidor */
  isAwaitingResponse?: boolean
  displayName?: string | null
  timezone?: string | null
  /** Prompt a ser enviado automaticamente ao montar o componente (ex: deep link do relatório) */
  autoSubmitPrompt?: string
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
  onNavigateToProposals?: () => void
  onContextModeChange?: (mode: ContextMode) => void
}

function AgenteChatInner({
  unitSlug, unitId,
  initialMessages, conversationId,
  contextMode: initialContextMode,
  isAwaitingResponse,
  displayName, timezone,
  autoSubmitPrompt,
  onConversationCreated, onMessagesUpdate, onProposalSaved, onNavigateToProposals,
  onContextModeChange,
}: AgenteChatInnerProps) {
  const convIdRef = useRef<string | null>(conversationId ?? null)
  // Locked após primeiro envio — o mode é imutável por conversa
  const contextModeRef = useRef<ContextMode>(initialContextMode ?? 'org')

  // Modelo selecionado — persiste em localStorage, mutável a qualquer momento
  const [modelId, setModelId] = useState<string>(readStoredModelId)
  const modelIdRef = useRef(modelId)
  useEffect(() => { modelIdRef.current = modelId }, [modelId])

  // body como função: DefaultChatTransport chama resolve(body) a cada request
  const getBody = useRef(() => {
    // Lê o período do dashboard salvo no localStorage (TTL 4h)
    let dashboardPeriod: { dateFrom: string; dateTo: string; label: string } | undefined
    try {
      const raw = localStorage.getItem('lhg-dashboard-period')
      if (raw) {
        const parsed = JSON.parse(raw) as { dateFrom: string; dateTo: string; label: string; timestamp: number }
        const ageMs = Date.now() - (parsed.timestamp ?? 0)
        if (ageMs < 4 * 60 * 60 * 1000 && parsed.dateFrom && parsed.dateTo) {
          dashboardPeriod = { dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, label: parsed.label }
        }
      }
    } catch { /* sem acesso ao localStorage */ }
    return {
      unitSlug,
      convId: convIdRef.current ?? undefined,
      contextMode: contextModeRef.current,
      modelId: modelIdRef.current,
      dashboardPeriod,
    }
  })

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: getBody.current,
    }),
    messages: initialMessages,
  })

  // Salva mensagens e reseta o lock de submit quando o streaming termina
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current !== 'ready' && status === 'ready' && messages.length > 0 && convIdRef.current) {
      onMessagesUpdate?.(convIdRef.current, messages as UIMessage[])
    }
    if (status === 'ready' || status === 'error') {
      isSubmittingRef.current = false
      setLocalPending(false)
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
  const autoSubmitDoneRef = useRef(false)
  // Ativa imediatamente ao enviar — cobre o gap antes de sendMessage() ser chamado
  const [localPending, setLocalPending] = useState(false)

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

  // Auto-submit quando o componente monta com autoSubmitPrompt (deep link do relatório)
  useEffect(() => {
    if (!autoSubmitPrompt || autoSubmitDoneRef.current || !unitId) return
    autoSubmitDoneRef.current = true
    const t = setTimeout(() => submit(autoSubmitPrompt), 400)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(overrideText?: string) {
    const text = overrideText ?? textareaRef.current?.value.trim()
    if (!text || isStreaming || isSubmittingRef.current) return
    isSubmittingRef.current = true
    setLocalPending(true) // feedback imediato — antes de qualquer async

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
            context_mode: contextModeRef.current,
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
    if (!overrideText && textareaRef.current) textareaRef.current.value = ''
    // isSubmittingRef é resetado no useEffect quando status volta a 'ready'
  }

  // Conversa retomada aguardando resposta: input desabilitado até chegar
  const awaitingOnly = isAwaitingResponse && messages.length > 0 &&
    messages[messages.length - 1].role === 'user' && !isStreaming

  return (
    <>
      <div ref={scrollAreaRef} onScroll={handleScroll} className="flex flex-col flex-1 overflow-y-auto p-4 gap-4 min-h-0">
        {messages.length === 0 && !localPending && (
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

            {/* Toggle de contexto — só visível antes do primeiro envio */}
            <ContextModeToggle
              value={contextModeRef.current}
              onChange={(mode) => {
                contextModeRef.current = mode
                onContextModeChange?.(mode)
              }}
            />

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
                  // Só texto antes do sugerir_respostas — evita duplicação pós-tool-result
                  const firstSugerirIdx = msg.parts.findIndex(
                    (p) => isToolUIPart(p) && getToolName(p) === 'sugerir_respostas'
                  )
                  const relevantParts = firstSugerirIdx >= 0
                    ? msg.parts.slice(0, firstSugerirIdx)
                    : msg.parts
                  const text = relevantParts
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { type: 'text'; text: string }).text)
                    .join('')
                  if (!text) return null
                  const isLastMsg = msg.id === lastAssistantMsg?.id
                  return (
                    <StreamingMessageText
                      text={text}
                      isStreaming={isStreaming && isLastMsg}
                    />
                  )
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

        {/* Option cards inline — aparece assim que sugerir_respostas retorna (sem aguardar fim do stream) */}
        {!awaitingOnly && quickReplies.length > 0 && (
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
        {awaitingOnly && (
          <AwaitingBubble
            onUnlock={conversationId ? async () => {
              const supabase = createClient()
              const { data } = await supabase
                .from('rm_conversations')
                .select('messages')
                .eq('id', conversationId)
                .single()
              const existing = (data?.messages ?? []) as unknown as UIMessage[]
              if (existing[existing.length - 1]?.role === 'assistant') return
              const closing: UIMessage = {
                id: Math.random().toString(36).slice(2, 12),
                role: 'assistant',
                parts: [{ type: 'text', text: 'Análise concluída em background. Acesse a aba **Propostas** para revisar, ou envie uma nova mensagem.' }],
              }
              const updated = [...existing, closing]
              await supabase
                .from('rm_conversations')
                .update({ messages: JSON.parse(JSON.stringify(updated)) })
                .eq('id', conversationId)
              onMessagesUpdate?.(conversationId, updated)
            } : undefined}
          />
        )}

        {(() => {
          // Regra: o "pensando" fica visível desde o envio ATÉ a resposta do agente começar
          // a renderizar conteúdo (texto ou tool). Não depende de timing de localPending/isStreaming
          // (que têm janelas onde ambos ficam false: criação da conversa, gaps de status do AI SDK).
          if (awaitingOnly || error) return false
          const last = messages[messages.length - 1]
          const lastHasContent = last?.role === 'assistant' && last.parts.some(
            (p) => (p.type === 'text' && (p as { type: 'text'; text: string }).text.length > 0) || isToolUIPart(p)
          )
          if (lastHasContent) return false
          // Aguardando enquanto: enviou agora (última msg é do usuário) OU pendente OU streaming sem conteúdo
          return last?.role === 'user' || localPending || isStreaming
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
      <div className="border-t px-3 pt-2 pb-3 flex flex-col gap-1.5">
        <div className="flex gap-2 items-end">
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
            onClick={() => submit()}
            disabled={isStreaming || awaitingOnly}
            className="shrink-0 h-[44px] w-[44px]"
          >
            {isStreaming
              ? <Loader2 className="size-4 animate-spin" />
              : <Send className="size-4" />
            }
          </Button>
        </div>
        {/* Seletor de modelo — sempre visível abaixo do input */}
        <div className="flex items-center justify-end">
          <ModelSelector value={modelId} onChange={setModelId} />
        </div>
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
  contextMode?: ContextMode
  displayName?: string | null
  timezone?: string | null
  /** Prompt a ser enviado automaticamente ao montar (ex: deep link do relatório) */
  autoSubmitPrompt?: string
  onConversationCreated?: (id: string, title: string) => void
  onMessagesUpdate?: (id: string, msgs: UIMessage[]) => void
  onProposalSaved?: () => void
  onNavigateToProposals?: () => void
  onContextModeChange?: (mode: ContextMode) => void
}

export function AgenteChat({
  unitSlug, unitId,
  selectedConvId: externalConvId,
  selectedMessages: externalMessages,
  isAwaitingResponse,
  contextMode,
  displayName, timezone,
  autoSubmitPrompt,
  onConversationCreated: externalOnCreated,
  onMessagesUpdate: externalOnUpdate,
  onProposalSaved,
  onNavigateToProposals,
  onContextModeChange,
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
      contextMode={contextMode}
      displayName={displayName}
      timezone={timezone}
      autoSubmitPrompt={autoSubmitPrompt}
      onConversationCreated={externalOnCreated}
      onMessagesUpdate={externalOnUpdate}
      onProposalSaved={onProposalSaved}
      onNavigateToProposals={onNavigateToProposals}
      onContextModeChange={onContextModeChange}
    />
  )
}

const SUGESTOES = [
  'Fazer diagnóstico completo e gerar proposta de preços',
  'Revisar precificação do fim de semana',
  'Analisar concorrentes e sugerir ajustes de preço',
  'Investigar anomalias e oportunidades de melhoria',
]
