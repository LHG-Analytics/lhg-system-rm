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
}

function AgenteChatInner({ unitSlug, startDate, endDate }: AgenteChatInnerProps) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: { unitSlug, startDate, endDate },
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

// ─── Outer component (gerencia seletor de período) ────────────────────────────

interface AgenteChatProps {
  unitSlug: string
}

export function AgenteChat({ unitSlug }: AgenteChatProps) {
  const searchParams = useSearchParams()
  const activeSlug = searchParams.get('unit') ?? unitSlug

  const defaults = getDefaultDateRange()

  // Datas aplicadas ao chat atual
  const [startDate, setStartDate] = useState(defaults.startDate)
  const [endDate, setEndDate] = useState(defaults.endDate)

  // Datas pendentes (ainda não aplicadas)
  const [pendingStart, setPendingStart] = useState(defaults.startDate)
  const [pendingEnd, setPendingEnd] = useState(defaults.endDate)

  // Incrementar essa key força remount do AgenteChatInner com novo transport
  const [chatKey, setChatKey] = useState(0)

  const isDirty = pendingStart !== startDate || pendingEnd !== endDate

  function applyDates() {
    setStartDate(pendingStart)
    setEndDate(pendingEnd)
    setChatKey((k) => k + 1) // reseta a conversa com o novo período
  }

  return (
    <div className="flex flex-1 flex-col rounded-xl border bg-card overflow-hidden min-h-0">
      {/* Seletor de período */}
      <div className="flex items-center gap-2 border-b px-3 py-2 bg-muted/30 flex-wrap">
        <Calendar className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground shrink-0">Período de análise:</span>
        <Input
          type="date"
          value={toInputDate(pendingStart)}
          max={toInputDate(pendingEnd)}
          onChange={(e) => e.target.value && setPendingStart(fromInputDate(e.target.value))}
          className="h-7 text-xs w-36 px-2"
        />
        <span className="text-xs text-muted-foreground">até</span>
        <Input
          type="date"
          value={toInputDate(pendingEnd)}
          min={toInputDate(pendingStart)}
          onChange={(e) => e.target.value && setPendingEnd(fromInputDate(e.target.value))}
          className="h-7 text-xs w-36 px-2"
        />
        {isDirty && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs gap-1.5"
            onClick={applyDates}
          >
            <RefreshCw className="size-3" />
            Aplicar
          </Button>
        )}
        {!isDirty && (
          <span className="text-xs text-muted-foreground/60">
            ({startDate} — {endDate})
          </span>
        )}
      </div>

      {/* Inner chat — remontado quando chatKey muda (novo período aplicado) */}
      <AgenteChatInner
        key={chatKey}
        unitSlug={activeSlug}
        startDate={startDate}
        endDate={endDate}
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
