'use client'

/**
 * AgentStreamingProvider
 *
 * Mantém o streaming do agente vivo mesmo quando o usuário navega para
 * outra página. Quando AgenteChatInner desmonta durante um streaming,
 * ele registra a sessão aqui via `startBackground`. O BackgroundStreamer
 * (componente invisível) re-envia a última mensagem do usuário, conclui
 * o streaming, salva no banco e cria uma notificação in-app.
 */

import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackgroundSession {
  /** Chave única para forçar recriação do BackgroundStreamer */
  key: number
  convId: string
  unitId: string
  unitSlug: string
  dateFrom: string
  dateTo: string
  /** Mensagens anteriores à última do usuário (histórico limpo) */
  messagesBeforeLastUser: UIMessage[]
  /** Texto da última mensagem do usuário que será re-enviada */
  lastUserText: string
}

interface AgentStreamingContextValue {
  startBackground: (session: BackgroundSession) => void
  clearBackground: () => void
  isBackgroundRunning: boolean
  backgroundConvId: string | null
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AgentStreamingContext = createContext<AgentStreamingContextValue>({
  startBackground: () => {},
  clearBackground: () => {},
  isBackgroundRunning: false,
  backgroundConvId: null,
})

export function useAgentStreaming() {
  return useContext(AgentStreamingContext)
}

// ─── BackgroundStreamer ───────────────────────────────────────────────────────

interface BackgroundStreamerProps {
  session: BackgroundSession
  onDone: (convId: string, unitId: string, messages: UIMessage[]) => Promise<void>
  onClear: () => void
}

function BackgroundStreamer({ session, onDone, onClear }: BackgroundStreamerProps) {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agente/chat',
      body: {
        unitSlug: session.unitSlug,
        dateFrom: session.dateFrom,
        dateTo: session.dateTo,
      },
    }),
    messages: session.messagesBeforeLastUser,
  })

  const triggeredRef  = useRef(false)
  const completedRef  = useRef(false)
  const prevStatusRef = useRef(status)

  // Dispara a mensagem do usuário assim que o hook inicializa (status = 'ready')
  useEffect(() => {
    if (status === 'ready' && !triggeredRef.current) {
      triggeredRef.current = true
      sendMessage({ text: session.lastUserText })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Detecta conclusão: status voltou para 'ready' após ter enviado
  useEffect(() => {
    if (
      prevStatusRef.current !== 'ready' &&
      status === 'ready' &&
      triggeredRef.current &&
      !completedRef.current &&
      messages.some((m) => m.role === 'assistant')
    ) {
      completedRef.current = true
      onDone(session.convId, session.unitId, messages as UIMessage[]).finally(onClear)
    }
    prevStatusRef.current = status
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return null
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AgentStreamingProvider({ children }: { children: React.ReactNode }) {
  const [bgSession, setBgSession] = useState<BackgroundSession | null>(null)

  async function handleDone(convId: string, unitId: string, messages: UIMessage[]) {
    const supabase = createClient()

    // 1. Salva as mensagens completas no banco
    await supabase
      .from('rm_conversations')
      .update({ messages: JSON.parse(JSON.stringify(messages)) })
      .eq('id', convId)

    // 2. Cria notificação in-app para o usuário
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'info',
      title: 'Agente RM respondeu',
      body: 'Sua consulta foi processada. Clique para ver a resposta.',
      link: `/dashboard/agente?conv=${convId}`,
    })
  }

  const value: AgentStreamingContextValue = {
    startBackground: (session) => {
      // Ignora se já há uma sessão ativa para o mesmo convId
      if (bgSession?.convId === session.convId) return
      setBgSession(session)
    },
    clearBackground: () => setBgSession(null),
    isBackgroundRunning: bgSession !== null,
    backgroundConvId: bgSession?.convId ?? null,
  }

  return (
    <AgentStreamingContext.Provider value={value}>
      {children}
      {bgSession && (
        <BackgroundStreamer
          key={bgSession.key}
          session={bgSession}
          onDone={handleDone}
          onClear={() => setBgSession(null)}
        />
      )}
    </AgentStreamingContext.Provider>
  )
}
