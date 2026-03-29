import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { AgenteChat } from '@/components/agente/agente-chat'
import { ProposalsList } from '@/components/agente/proposals-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BotMessageSquare, ClipboardCheck } from 'lucide-react'
import type { Database } from '@/types/database.types'
import type { PriceProposal } from '@/app/api/agente/proposals/route'
import type { PriceImportSummary } from '@/components/agente/agente-chat'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface AgentePageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function AgentePage({ searchParams }: AgentePageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve unidade ativa (3 níveis de fallback)
  const admin = getAdminClient()
  let activeUnit: { id: string; slug: string; name: string } | null = null

  if (unitSlug) {
    const { data } = await admin
      .from('units')
      .select('id, slug, name')
      .eq('slug', unitSlug)
      .eq('is_active', true)
      .single()
    activeUnit = data
  }

  if (!activeUnit) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('unit_id')
      .eq('user_id', user.id)
      .single()

    if (profile?.unit_id) {
      const { data } = await admin
        .from('units')
        .select('id, slug, name')
        .eq('id', profile.unit_id)
        .single()
      activeUnit = data
    }
  }

  if (!activeUnit) {
    const { data } = await admin
      .from('units')
      .select('id, slug, name')
      .eq('is_active', true)
      .order('name')
      .limit(1)
      .single()
    activeUnit = data
  }

  // Buscar propostas e imports em paralelo
  const [proposalsResult, importsResult] = await Promise.all([
    activeUnit
      ? supabase
          .from('price_proposals')
          .select('*')
          .eq('unit_id', activeUnit.id)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    activeUnit
      ? admin
          .from('price_imports')
          .select('id, imported_at, canals, is_active, valid_from, valid_until')
          .eq('unit_id', activeUnit.id)
          .order('valid_from', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const initialProposals = (proposalsResult.data ?? []) as unknown as PriceProposal[]
  const priceImports = (importsResult.data ?? []) as PriceImportSummary[]

  return (
    <div className="flex flex-1 flex-col gap-4 h-full min-h-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agente RM</h1>
        <p className="text-sm text-muted-foreground">
          {activeUnit ? `Analisando ${activeUnit.name}` : 'Assistente de Revenue Management'}
        </p>
      </div>

      <Tabs defaultValue="chat" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="chat" className="gap-2">
            <BotMessageSquare className="size-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="propostas" className="gap-2">
            <ClipboardCheck className="size-4" />
            Propostas
            {initialProposals.filter((p) => p.status === 'pending').length > 0 && (
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium px-1.5 py-0.5 leading-none">
                {initialProposals.filter((p) => p.status === 'pending').length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex flex-col flex-1 min-h-0 mt-0 pt-4">
          <Suspense fallback={null}>
            <AgenteChat unitSlug={activeUnit?.slug ?? ''} unitId={activeUnit?.id ?? ''} priceImports={priceImports} />
          </Suspense>
        </TabsContent>

        <TabsContent value="propostas" className="mt-0 pt-4 overflow-y-auto">
          <ProposalsList
            unitSlug={activeUnit?.slug ?? ''}
            initialProposals={initialProposals}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
