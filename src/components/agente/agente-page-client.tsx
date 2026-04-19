'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, MessageSquare, Trash2, BotMessageSquare, ClipboardCheck, CalendarClock, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { AgenteChat } from '@/components/agente/agente-chat'
import { ProposalsList } from '@/components/agente/proposals-list'
import { ScheduledReviewsList } from '@/components/agente/scheduled-reviews-list'
import { AgentConfigManager } from '@/app/dashboard/admin/_components/agent-config-manager'
import type { UIMessage } from 'ai'
import type { ConversationSummary } from '@/components/agente/agente-chat'
import type { PriceProposal } from '@/app/api/agente/proposals/route'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgenteChatPageProps {
  activeUnit: { id: string; slug: string; name: string } | null
  initialProposals: PriceProposal[]
  userRole?: string
  units?: { id: string; slug: string; name: string }[]
  displayName?: string | null
  timezone?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCHEDULED_REVIEW_PREFIX = '📅'

function isScheduledReview(title: string | null) {
  return title?.startsWith(SCHEDULED_REVIEW_PREFIX) ?? false
}

/** Retorna true se a última mensagem da conversa é do usuário (sem resposta) */
function isAwaitingResponse(msgs: UIMessage[]): boolean {
  if (!msgs.length) return false
  return msgs[msgs.length - 1].role === 'user'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgenteChatPage({ activeUnit, initialProposals, userRole, units = [], displayName, timezone }: AgenteChatPageProps) {
  const searchParams = useSearchParams()
  const unitId   = activeUnit?.id   ?? ''
  const unitSlug = searchParams.get('unit') ?? activeUnit?.slug ?? ''
  const [configOpen, setConfigOpen] = useState(false)
  const canConfig = userRole === 'super_admin' || userRole === 'admin'
  const canManageProposals = userRole === 'super_admin' || userRole === 'admin'

  // ── Histórico de conversas ─────────────────────────────────────────────────
  const [conversations,    setConversations]    = useState<ConversationSummary[]>([])
  const [selectedConvId,   setSelectedConvId]   = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<UIMessage[]>([])
  const [chatKey,          setChatKey]          = useState(0)
  const [proposalsRefreshKey, setProposalsRefreshKey] = useState(0)
  const [activeTab,        setActiveTab]        = useState('chat')
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)

  // Reseta o chat quando a unidade muda (troca via sidebar)
  const prevUnitIdRef = useRef<string>('')
  useEffect(() => {
    if (!unitId) return
    if (prevUnitIdRef.current && prevUnitIdRef.current !== unitId) {
      setSelectedConvId(null)
      setSelectedMessages([])
      setChatKey((k) => k + 1)
    }
    prevUnitIdRef.current = unitId
    loadConversations()
  }, [unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recarrega conversas ao voltar para a aba — captura respostas salvas em background
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && unitId) {
        loadConversations()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abre conversa via ?conv= param (notificação in-app)
  const handledConvParam = useRef(false)
  useEffect(() => {
    if (handledConvParam.current) return
    const convParam = searchParams.get('conv')
    if (convParam) {
      handledConvParam.current = true
      handleSelectConversationById(convParam)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadConversations() {
    const supabase = createClient()
    const { data } = await supabase
      .from('rm_conversations')
      .select('id, title, updated_at, messages')
      .eq('unit_id', unitId)
      .order('updated_at', { ascending: false })
      .limit(30)
    const loaded = (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updated_at: c.updated_at,
      messages: (c.messages as unknown as UIMessage[]) ?? [],
    }))
    setConversations(loaded)

    // Se havia uma conversa selecionada aguardando resposta e agora está resolvida,
    // atualiza selectedMessages e remonta o chat para exibir a resposta
    setSelectedConvId((currentId) => {
      if (!currentId) return currentId
      const fresh = loaded.find((c) => c.id === currentId)
      if (fresh && !isAwaitingResponse(fresh.messages)) {
        setSelectedMessages((prevMsgs) => {
          if (isAwaitingResponse(prevMsgs)) {
            // Estava aguardando — agora tem resposta: remonta o chat
            setChatKey((k) => k + 1)
            return fresh.messages
          }
          return prevMsgs
        })
      }
      return currentId
    })
  }

  // ── Realtime: escuta updates na conversa ativa ────────────────────────────
  // Quando o backend (onFinish) salva a resposta do agente no banco enquanto o
  // cliente estava desconectado, o Supabase emite UPDATE em rm_conversations.
  // Recebemos aqui e atualizamos as mensagens — a conversa "se completa" ao vivo.
  //
  // Race condition tratada: se o UPDATE já disparou ANTES da subscription ser criada
  // (ex: usuário voltou depois que onFinish já salvou), fazemos um fresh fetch logo
  // após criar o canal — se já há resposta, atualizamos sem depender do evento perdido.
  const realtimeConvIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedConvId) return
    const msgs = conversations.find((c) => c.id === selectedConvId)?.messages ?? selectedMessages
    if (!isAwaitingResponse(msgs)) return  // já tem resposta — não precisa subscrever

    realtimeConvIdRef.current = selectedConvId
    const supabase = createClient()

    function applyFreshMsgs(newMsgs: UIMessage[], updatedAt: string, convId: string) {
      setSelectedMessages(newMsgs)
      setChatKey((k) => k + 1)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: newMsgs, updated_at: updatedAt }
            : c
        )
      )
    }

    const channel = supabase
      .channel(`conv-recovery-${selectedConvId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'rm_conversations',
          filter: `id=eq.${selectedConvId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; messages: unknown; updated_at: string; title: string | null }
          const newMsgs = (updated.messages as unknown as UIMessage[]) ?? []
          if (!isAwaitingResponse(newMsgs)) {
            applyFreshMsgs(newMsgs, updated.updated_at, updated.id)
          }
        }
      )
      .subscribe()

    // Fresh fetch imediato: captura resposta já salva antes da subscription existir
    // (race condition: onFinish disparou UPDATE antes do usuário voltar e clicar)
    const convIdSnapshot = selectedConvId
    supabase
      .from('rm_conversations')
      .select('id, messages, updated_at')
      .eq('id', convIdSnapshot)
      .single()
      .then(({ data }) => {
        if (!data || realtimeConvIdRef.current !== convIdSnapshot) return
        const freshMsgs = (data.messages as unknown as UIMessage[]) ?? []
        if (!isAwaitingResponse(freshMsgs)) {
          applyFreshMsgs(freshMsgs, data.updated_at, data.id)
        }
      })

    return () => {
      supabase.removeChannel(channel)
      realtimeConvIdRef.current = null
    }
  }, [selectedConvId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectConversation(conv: ConversationSummary) {
    setSelectedConvId(conv.id)
    setSelectedMessages(conv.messages)
    setChatKey((k) => k + 1)
    setActiveTab('chat')
  }

  function handleSelectConversationById(convId: string) {
    const conv = conversations.find((c) => c.id === convId)
    if (conv) {
      handleSelectConversation(conv)
    } else {
      // Conversa não está na lista local ainda — busca fresca do banco
      const supabase = createClient()
      supabase
        .from('rm_conversations')
        .select('id, title, updated_at, messages')
        .eq('id', convId)
        .single()
        .then(({ data }) => {
          if (data) {
            const conv: ConversationSummary = {
              id: data.id,
              title: data.title,
              updated_at: data.updated_at,
              messages: (data.messages as unknown as UIMessage[]) ?? [],
            }
            setConversations((prev) => [conv, ...prev.filter((c) => c.id !== convId)])
            handleSelectConversation(conv)
          }
        })
    }
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

  function handleProposalSaved() {
    setProposalsRefreshKey((k) => k + 1)
  }

  function handleSelectProposal(proposalId: string) {
    setSelectedProposalId(proposalId)
    setActiveTab('propostas')
  }

  async function handleMessagesUpdate(id: string, msgs: UIMessage[]) {
    const supabase = createClient()
    await supabase
      .from('rm_conversations')
      .update({ messages: JSON.parse(JSON.stringify(msgs)) })
      .eq('id', id)
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

  const pendingCount = initialProposals.filter((p) => p.status === 'pending').length

  // Determina se a conversa ativa está aguardando resposta
  const currentMsgs = conversations.find((c) => c.id === selectedConvId)?.messages ?? selectedMessages
  const awaitingResponse = selectedConvId ? isAwaitingResponse(currentMsgs) : false

  return (
    <div className="flex flex-1 min-h-0 h-full gap-4">

      {/* ── Sidebar de histórico ─────────────────────────────────────── */}
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
            conversations.map((conv) => {
              const isReview = isScheduledReview(conv.title)
              const convAwaiting = isAwaitingResponse(conv.messages)
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectConversation(conv)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSelectConversation(conv)}
                  className={cn(
                    'group w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-accent transition-colors cursor-pointer',
                    selectedConvId === conv.id && 'bg-accent',
                    isReview && 'border-l-2 border-l-blue-500/60'
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className={cn(
                      'text-[11px] font-medium leading-snug line-clamp-2 flex-1',
                      isReview ? 'text-blue-600 dark:text-blue-400' : 'text-foreground'
                    )}>
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
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground/60">
                      {fmtDate(conv.updated_at)}
                    </span>
                    {/* Indicador visual de conversa aguardando resposta */}
                    {convAwaiting && (
                      <span className="flex gap-[2px] items-center">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="block size-[3px] rounded-full bg-primary/60 animate-bounce"
                            style={{ animationDelay: `${i * 0.18}s`, animationDuration: '1.1s' }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Card principal: header + tabs ───────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col rounded-xl border bg-card overflow-hidden min-h-0">

        {/* Cabeçalho do card: título + TabsList + gear */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight leading-tight">Agente RM</h1>
            <p className="text-xs text-muted-foreground truncate">
              {activeUnit ? `Analisando ${activeUnit.name}` : 'Assistente de Revenue Management'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TabsList className="h-8">
              <TabsTrigger value="chat" className="gap-1.5 text-xs h-7 px-3">
                <BotMessageSquare className="size-3.5" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="propostas" className="gap-1.5 text-xs h-7 px-3">
                <ClipboardCheck className="size-3.5" />
                Propostas
                {pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium px-1.5 py-0.5 leading-none">
                    {pendingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="agendamentos" className="gap-1.5 text-xs h-7 px-3">
                <CalendarClock className="size-3.5" />
                Agenda
              </TabsTrigger>
            </TabsList>
            {canConfig && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setConfigOpen(true)}
                title="Configurações do agente"
              >
                <Settings2 className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Sheet de configuração do agente */}
        {canConfig && activeUnit && (
          <Sheet open={configOpen} onOpenChange={setConfigOpen}>
            <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] flex flex-col p-0">
              <SheetHeader className="px-6 py-4 border-b shrink-0">
                <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Settings2 className="size-4 text-primary" />
                  Configurações do Agente — {activeUnit.name}
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <AgentConfigManager
                  unitSlug={activeUnit.slug}
                  unitName={activeUnit.name}
                  units={units.length > 0 ? units : [activeUnit]}
                  initialConfig={null}
                  compact
                />
              </div>
            </SheetContent>
          </Sheet>
        )}

        <TabsContent value="chat" className="flex flex-col flex-1 min-h-0 mt-0">
          <AgenteChat
            key={chatKey}
            unitSlug={unitSlug}
            unitId={unitId}
            selectedConvId={selectedConvId}
            selectedMessages={selectedMessages}
            isAwaitingResponse={awaitingResponse}
            displayName={displayName}
            timezone={timezone}
            onConversationCreated={handleConversationCreated}
            onMessagesUpdate={handleMessagesUpdate}
            onProposalSaved={handleProposalSaved}
            onNavigateToProposals={() => setActiveTab('propostas')}
          />
        </TabsContent>

        <TabsContent value="propostas" className="mt-0 overflow-y-auto p-4">
          <ProposalsList
            unitSlug={activeUnit?.slug ?? ''}
            unitId={unitId}
            initialProposals={initialProposals}
            refreshKey={proposalsRefreshKey}
            selectedProposalId={selectedProposalId}
            canManage={canManageProposals}
          />
        </TabsContent>

        <TabsContent value="agendamentos" className="mt-0 overflow-y-auto p-4">
          <ScheduledReviewsList
            unitSlug={unitSlug}
            unitId={unitId}
            onSelectConversation={handleSelectConversationById}
            onSelectProposal={handleSelectProposal}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
