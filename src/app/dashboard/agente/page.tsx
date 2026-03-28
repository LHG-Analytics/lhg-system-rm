import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AgenteChat } from '@/components/agente/agente-chat'

interface AgentePageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function AgentePage({ searchParams }: AgentePageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve unidade ativa (mesma lógica do dashboard)
  let activeUnit: { slug: string; name: string } | null = null

  if (unitSlug) {
    const { data } = await supabase
      .from('units')
      .select('slug, name')
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
      const { data } = await supabase
        .from('units')
        .select('slug, name')
        .eq('id', profile.unit_id)
        .single()
      activeUnit = data
    }
  }

  if (!activeUnit) {
    const { data } = await supabase
      .from('units')
      .select('slug, name')
      .eq('is_active', true)
      .order('name')
      .limit(1)
      .single()
    activeUnit = data
  }

  return (
    <div className="flex flex-1 flex-col gap-4 h-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agente RM</h1>
        <p className="text-sm text-muted-foreground">
          {activeUnit
            ? `Analisando ${activeUnit.name} · últimos 12 meses`
            : 'Assistente de Revenue Management'}
        </p>
      </div>
      <Suspense fallback={null}>
        <AgenteChat unitSlug={activeUnit?.slug ?? ''} />
      </Suspense>
    </div>
  )
}
