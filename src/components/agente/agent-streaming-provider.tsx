'use client'

/**
 * AgentStreamingProvider
 *
 * Wrapper de contexto mantido para compatibilidade de imports.
 * A estratégia de background foi migrada para o servidor:
 * o onFinish do /api/agente/chat/route.ts salva as mensagens e
 * cria notificação mesmo quando o cliente desconecta (SSE fechado).
 */

import { createContext, useContext } from 'react'

interface AgentStreamingContextValue {
  isBackgroundRunning: boolean
}

const AgentStreamingContext = createContext<AgentStreamingContextValue>({
  isBackgroundRunning: false,
})

export function useAgentStreaming() {
  return useContext(AgentStreamingContext)
}

export function AgentStreamingProvider({ children }: { children: React.ReactNode }) {
  return (
    <AgentStreamingContext.Provider value={{ isBackgroundRunning: false }}>
      {children}
    </AgentStreamingContext.Provider>
  )
}
