'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { BotMessageSquare, ExternalLink, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AgenteChat } from '@/components/agente/agente-chat'
import type { Database } from '@/types/database.types'

type Unit = Database['public']['Tables']['units']['Row']

interface AgentSidePanelProps {
  units: Unit[]
  userRole: string
}

function AgentSidePanelInner({ units }: AgentSidePanelProps) {
  const pathname    = usePathname()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)
  const [chatKey, setChatKey] = useState(0)

  const unitSlug   = searchParams.get('unit') ?? units[0]?.slug ?? ''
  const activeUnit = units.find((u) => u.slug === unitSlug) ?? units[0]

  // Resetar chat quando a unidade muda (enquanto o painel está aberto)
  const prevSlugRef = useRef(unitSlug)
  useEffect(() => {
    if (prevSlugRef.current !== unitSlug) {
      prevSlugRef.current = unitSlug
      if (isOpen) setChatKey((k) => k + 1)
    }
  }, [unitSlug, isOpen])

  // Ocultar FAB na página principal do Agente RM (já tem chat completo)
  if (pathname?.startsWith('/dashboard/agente')) return null
  if (!activeUnit) return null

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
                onClick={() => setChatKey((k) => k + 1)}
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
