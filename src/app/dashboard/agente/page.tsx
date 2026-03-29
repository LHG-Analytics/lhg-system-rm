import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { AgenteChatPage } from '@/components/agente/agente-page-client'
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
    <Suspense fallback={null}>
      <AgenteChatPage
        activeUnit={activeUnit}
        initialProposals={initialProposals}
        priceImports={priceImports}
      />
    </Suspense>
  )
}
