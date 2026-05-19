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

function storageKey(unitId: string) {
  return `lhg-panel-conv-${unitId}`
}

function AgentSidePanelInner({ units, userRole }: AgentSidePanelProps) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [isOpen,           setIsOpen]           = useState(false)
  const [chatKey,          setChatKey]          = useState(0)
  const [selectedConvId,   setSelectedConvId]   = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<UIMessage[] | undefined>()
  const [currentUserId,    setCurrentUserId]    = useState<string | null>(null)

  const unitSlug   = searchParams.get('unit') ?? units[0]?.slug ?? ''
  const activeUnit = units.find((u) => u.slug === unitSlug) ?? units[0]

  // Carrega o userId atual uma única vez
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id)
    })
  }, [])

  // Persiste o convId no localStorage para sobreviver a remounts por Suspense
  useEffect(() => {
    if (!activeUnit || !selectedConvId) return
    try { localStorage.setItem(storageKey(activeUnit.id), selectedConvId) } catch {}
  }, [selectedConvId, activeUnit?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega uma conversa específica por ID
  const loadConversationById = useCallback(async (unitId: string, convId: string, userId: string | null) => {
    const supabase = createClient()
    let q = supabase
      .from('rm_conversations')
      .select('id, messages')
      .eq('unit_id', unitId)
      .eq('id', convId)
    if (userId) q = q.eq('user_id', userId)
    const { data } = await q.maybeSingle()

    if (data) {
      setSelectedConvId(data.id)
      setSelectedMessages((data.messages as unknown as UIMessage[]) ?? [])
    } else {
      // convId salvo não existe mais — cai no fallback de última conversa
      loadLastConversation(unitId, userId) // eslint-disable-line
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega a última conversa do usuário na unidade
  const loadLastConversation = useCallback(async (unitId: string, userId: string | null) => {
    const supabase = createClient()
    let q = supabase
      .from('rm_conversations')
      .select('id, messages')
      .eq('unit_id', unitId)
    if (userId) q = q.eq('user_id', userId)
    const { data } = await q
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setSelectedConvId(data.id)
      setSelectedMessages((data.messages as unknown as UIMessage[]) ?? [])
    }
  }, [])

  // Ref para saber se já carregamos para este unit+chatKey
  const loadedForRef = useRef('')
  // Ref para ler selectedConvId sem adicionar como dep no effect principal
  const selectedConvIdRef = useRef<string | null>(null)
  useEffect(() => { selectedConvIdRef.current = selectedConvId }, [selectedConvId])

  useEffect(() => {
    if (!isOpen || !activeUnit) return
    const key = `${activeUnit.id}:${chatKey}`

    // Nova conversa solicitada explicitamente
    if (chatKey > 0) {
      if (loadedForRef.current === key) return
      loadedForRef.current = key
      // Se selectedConvIdRef ainda aponta para uma conversa, este chatKey++ veio do
      // Realtime recovery (não de handleNewConversation). O chat já remontou com as
      // mensagens corretas — não resetar o estado.
      if (selectedConvIdRef.current) return
      setSelectedConvId(null)
      setSelectedMessages(undefined)
      try { localStorage.removeItem(storageKey(activeUnit.id)) } catch {}
      return
    }

    // Já carregou para este key E tem conversa montada — não refaz
    if (loadedForRef.current === key && selectedConvIdRef.current) return
    loadedForRef.current = key

    // Tenta restaurar a partir do localStorage (sobrevive remounts por Suspense)
    try {
      const savedConvId = localStorage.getItem(storageKey(activeUnit.id))
      if (savedConvId) {
        loadConversationById(activeUnit.id, savedConvId, currentUserId)
        return
      }
    } catch {}

    // Sem localStorage — carrega a última conversa do banco
    loadLastConversation(activeUnit.id, currentUserId)
  }, [isOpen, activeUnit?.id, chatKey, currentUserId, loadConversationById, loadLastConversation]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime recovery: escuta updates na conversa ativa quando aguardando ──
  const isAwaitingResp =
    !!selectedConvId &&
    !!selectedMessages?.length &&
    selectedMessages[selectedMessages.length - 1].role === 'user'

  useEffect(() => {
    if (!isAwaitingResp || !selectedConvId) return

    const supabase = createClient()

    // Fresh fetch imediato — cobre race condition onde onFinish já salvou antes da subscription
    supabase
      .from('rm_conversations')
      .select('messages')
      .eq('id', selectedConvId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const msgs = (data.messages as unknown as UIMessage[]) ?? []
        if (msgs.length > 0 && msgs[msgs.length - 1].role !== 'user') {
          setSelectedMessages(msgs)
          setChatKey((k) => k + 1)
        }
      })

    const channel = supabase
      .channel(`panel-conv-recovery-${selectedConvId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rm_conversations',
        filter: `id=eq.${selectedConvId}`,
      }, (payload) => {
        const newMsgs = (payload.new.messages as unknown as UIMessage[]) ?? []
        if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role !== 'user') {
          setSelectedMessages(newMsgs)
          setChatKey((k) => k + 1)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isAwaitingResp, selectedConvId]) // eslint-disable-line react-hooks/exhaustive-deps

  // visibilitychange: recarrega a conversa ao voltar para a aba
  useEffect(() => {
    if (!selectedConvId || !activeUnit) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadConversationById(activeUnit.id, selectedConvId, currentUserId)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [selectedConvId, activeUnit?.id, currentUserId, loadConversationById]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (activeUnit) {
      try { localStorage.removeItem(storageKey(activeUnit.id)) } catch {}
    }
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
