'use client'

import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { BotMessageSquare, ExternalLink, Plus, X } from 'lucide-react'
import Link from 'next/link'
import type { UIMessage } from 'ai'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AgenteChat } from '@/components/agente/agente-chat'
import { createClient } from '@/lib/supabase/client'
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

  // Ref para evitar double-fetch: carrega apenas 1x por (unitId + chatKey)
  const loadedForRef = useRef('')

  // Carrega a última conversa quando o painel abre
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

    // chatKey > 0 = nova conversa pedida pelo usuário — não carregar histórico
    if (chatKey > 0) {
      setSelectedConvId(null)
      setSelectedMessages(undefined)
      return
    }

    loadLastConversation(activeUnit.id)
  }, [isOpen, activeUnit?.id, chatKey, loadLastConversation]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resetar tudo quando a unidade muda com o painel aberto
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
    loadedForRef.current = `${activeUnit?.id ?? ''}:new` // evita re-fetch imediato
    setSelectedConvId(null)
    setSelectedMessages(undefined)
    setChatKey((k) => k + 1)
  }

  function handleConversationCreated(id: string, _title: string) {
    setSelectedConvId(id)
  }

  function handleMessagesUpdate(id: string, msgs: UIMessage[]) {
    if (id === selectedConvId || !selectedConvId) {
      setSelectedConvId(id)
      setSelectedMessages(msgs)
    }
  }

  // Ocultar FAB na página principal do Agente RM (já tem chat completo)
  if (pathname?.startsWith('/dashboard/agente')) return null
  if (!activeUnit) return null

  // Conversa retomada aguardando resposta do servidor
  const isAwaitingResponse =
    !!selectedConvId &&
    !!selectedMessages?.length &&
    selectedMessages[selectedMessages.length - 1].role === 'user'

  return (
    <>
      {/* FAB fixo no canto inferior direito */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl px-4 py-3 text-sm font-medium hover:bg-primary/90 transition-all active:scale-95"
        aria-label="Abrir Agente RM"
      >
        <BotMessageSquare className="size-4 shrink-0" />
        <span>Agente RM</span>
      </button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[440px] sm:max-w-[440px] flex flex-col gap-0 p-0 overflow-hidden"
        >
          {/* Cabeçalho do painel */}
          <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
            <BotMessageSquare className="size-4 text-primary shrink-0" />
            <span className="text-sm font-medium flex-1 truncate min-w-0">
              {activeUnit.name}
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
                  href={`/dashboard/agente?unit=${activeUnit.slug}`}
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

          {/* Área do chat — flex-1 para preencher o restante da altura */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
          </div>
        </SheetContent>
      </Sheet>
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
