'use client'

import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { BotMessageSquare, ExternalLink, Plus, X } from 'lucide-react'
import Link from 'next/link'
import type { UIMessage } from 'ai'
import { Button } from '@/components/ui/button'
import { AgenteChat } from '@/components/agente/agente-chat'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Database } from '@/types/database.types'

type Unit = Database['public']['Tables']['units']['Row']

interface AgentSidePanelProps {
  units: Unit[]
  userRole: string
}

function AgentSidePanelInner({ units }: AgentSidePanelProps) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [isOpen,           setIsOpen]           = useState(false)
  const [chatKey,          setChatKey]          = useState(0)
  const [selectedConvId,   setSelectedConvId]   = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<UIMessage[] | undefined>()

  const unitSlug   = searchParams.get('unit') ?? units[0]?.slug ?? ''
  const activeUnit = units.find((u) => u.slug === unitSlug) ?? units[0]

  // Carrega última conversa ao abrir o painel
  const loadedForRef = useRef('')

  const loadLastConversation = useCallback(async (unitId: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('rm_conversations')
      .select('id, messages')
      .eq('unit_id', unitId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setSelectedConvId(data.id)
      setSelectedMessages((data.messages as unknown as UIMessage[]) ?? [])
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !activeUnit) return
    const key = `${activeUnit.id}:${chatKey}`
    if (loadedForRef.current === key) return
    loadedForRef.current = key

    if (chatKey > 0) {
      setSelectedConvId(null)
      setSelectedMessages(undefined)
      return
    }

    loadLastConversation(activeUnit.id)
  }, [isOpen, activeUnit?.id, chatKey, loadLastConversation]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resetar ao trocar de unidade
  const prevSlugRef = useRef(unitSlug)
  useEffect(() => {
    if (prevSlugRef.current !== unitSlug) {
      prevSlugRef.current = unitSlug
      if (isOpen) {
        loadedForRef.current = ''
        setSelectedConvId(null)
        setSelectedMessages(undefined)
        setChatKey(0)
      }
    }
  }, [unitSlug, isOpen])

  function handleNewConversation() {
    loadedForRef.current = `${activeUnit?.id ?? ''}:new`
    setSelectedConvId(null)
    setSelectedMessages(undefined)
    setChatKey((k) => k + 1)
  }

  function handleConversationCreated(id: string) {
    setSelectedConvId(id)
  }

  function handleMessagesUpdate(id: string, msgs: UIMessage[]) {
    if (id === selectedConvId || !selectedConvId) {
      setSelectedConvId(id)
      setSelectedMessages(msgs)
    }
  }

  const isAgentePage = pathname?.startsWith('/dashboard/agente')

  const isAwaitingResponse =
    !!selectedConvId &&
    !!selectedMessages?.length &&
    selectedMessages[selectedMessages.length - 1].role === 'user'

  return (
    <>
      {/* FAB — oculto na página do agente e quando o painel está aberto */}
      {!isAgentePage && !isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl px-4 py-3 text-sm font-medium hover:bg-primary/90 transition-all active:scale-95"
          aria-label="Abrir Agente RM"
        >
          <BotMessageSquare className="size-4 shrink-0" />
          <span>Agente RM</span>
        </button>
      )}

      {/* Overlay — apenas quando aberto */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/*
        Painel SEMPRE montado — CSS slide em vez de Radix Sheet.
        Isso garante que o estado do chat (incluindo streaming em andamento)
        nunca é perdido durante navegação ou ao fechar/reabrir o painel.
      */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-[440px] flex flex-col',
          'bg-background border-l shadow-xl',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          isAgentePage && 'hidden',
        )}
        aria-hidden={!isOpen}
      >
        {/* Cabeçalho */}
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <BotMessageSquare className="size-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1 truncate min-w-0">
            {activeUnit?.name ?? 'Agente RM'}
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleNewConversation}
              title="Nova conversa"
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              asChild
              title="Abrir página completa"
            >
              <Link
                href={`/dashboard/agente?unit=${activeUnit?.slug ?? ''}`}
                onClick={() => setIsOpen(false)}
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setIsOpen(false)}
              title="Fechar"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Chat — preenchendo o restante da altura */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {activeUnit && (
            <AgenteChat
              key={chatKey}
              unitSlug={activeUnit.slug}
              unitId={activeUnit.id}
              selectedConvId={selectedConvId}
              selectedMessages={selectedMessages}
              isAwaitingResponse={isAwaitingResponse}
              onConversationCreated={handleConversationCreated}
              onMessagesUpdate={handleMessagesUpdate}
            />
          )}
        </div>
      </div>
    </>
  )
}

export function AgentSidePanel(props: AgentSidePanelProps) {
  return (
    <Suspense fallback={null}>
      <AgentSidePanelInner {...props} />
    </Suspense>
  )
}
