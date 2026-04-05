'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, MessageSquare, Trash2, BotMessageSquare, ClipboardCheck, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { AgenteChat } from '@/components/agente/agente-chat'
import { ProposalsList } from '@/components/agente/proposals-list'
import { ScheduledReviewsList } from '@/components/agente/scheduled-reviews-list'
import type { UIMessage } from 'ai'
import type { ConversationSummary, PriceImportSummary } from '@/components/agente/agente-chat'
import type { PriceProposal } from '@/app/api/agente/proposals/route'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgenteChatPageProps {
  activeUnit: { id: string; slug: string; name: string } | null
  initialProposals: PriceProposal[]
  priceImports: PriceImportSummary[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCHEDULED_REVIEW_PREFIX = '📅'

function isScheduledReview(title: string | null) {
  return title?.startsWith(SCHEDULED_REVIEW_PREFIX) ?? false
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgenteChatPage({ activeUnit, initialProposals, priceImports }: AgenteChatPageProps) {
  const searchParams = useSearchParams()
  const unitId   = activeUnit?.id   ?? ''
  const unitSlug = searchParams.get('unit') ?? activeUnit?.slug ?? ''

  // ── Histórico de conversas ─────────────────────────────────────────────────
  const [conversations,    setConversations]    = useState<ConversationSummary[]>([])
  const [selectedConvId,   setSelectedConvId]   = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<UIMessage[]>([])
  const [chatKey,          setChatKey]          = useState(0)
  const [proposalsRefreshKey, setProposalsRefreshKey] = useState(0)
  const [activeTab,        setActiveTab]        = useState('chat')

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
    setActiveTab('chat')
  }

  function handleSelectConversationById(convId: string) {
    const conv = conversations.find((c) => c.id === convId)
    if (conv) {
      handleSelectConversation(conv)
    } else {
      // Conversa não está na lista local ainda — carrega do banco
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
                  <span className="text-[10px] text-muted-foreground/60">
                    {fmtDate(conv.updated_at)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Card principal: header + tabs ───────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col rounded-xl border bg-card overflow-hidden min-h-0">

        {/* Cabeçalho do card: título + TabsList */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight leading-tight">Agente RM</h1>
            <p className="text-xs text-muted-foreground truncate">
              {activeUnit ? `Analisando ${activeUnit.name}` : 'Assistente de Revenue Management'}
            </p>
          </div>
          <TabsList className="h-8 shrink-0">
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
        </div>

        <TabsContent value="chat" className="flex flex-col flex-1 min-h-0 mt-0">
          <AgenteChat
            key={chatKey}
            unitSlug={unitSlug}
            unitId={unitId}
            priceImports={priceImports}
            selectedConvId={selectedConvId}
            selectedMessages={selectedMessages}
            onConversationCreated={handleConversationCreated}
            onMessagesUpdate={handleMessagesUpdate}
            onProposalSaved={handleProposalSaved}
          />
        </TabsContent>

        <TabsContent value="propostas" className="mt-0 overflow-y-auto p-4">
          <ProposalsList
            unitSlug={activeUnit?.slug ?? ''}
            initialProposals={initialProposals}
            refreshKey={proposalsRefreshKey}
          />
        </TabsContent>

        <TabsContent value="agendamentos" className="mt-0 overflow-y-auto p-4">
          <ScheduledReviewsList
            unitSlug={unitSlug}
            onSelectConversation={handleSelectConversationById}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
