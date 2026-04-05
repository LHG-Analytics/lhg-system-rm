import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PriceImport } from '@/components/precos/price-import'
import { PriceList } from '@/components/precos/price-list'

interface PrecosPageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function PrecosPage({ searchParams }: PrecosPageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolver unidade ativa
  let activeUnit: { id: string; slug: string; name: string } | null = null

  if (unitSlug) {
    const { data } = await supabase
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
      const { data } = await supabase
        .from('units')
        .select('id, slug, name')
        .eq('id', profile.unit_id)
        .single()
      activeUnit = data
    }
  }

  if (!activeUnit) {
    const { data } = await supabase
      .from('units')
      .select('id, slug, name')
      .eq('is_active', true)
      .order('name')
      .limit(1)
      .single()
    activeUnit = data
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Preços</h1>
        <p className="text-sm text-muted-foreground">
          {activeUnit
            ? `Gerenciamento de tabela de preços — ${activeUnit.name}`
            : 'Gerenciamento de tabela de preços'}
        </p>
      </div>

      {activeUnit ? (
        <>
          {/* Lista de tabelas com realtime */}
          <PriceList unitSlug={activeUnit.slug} unitId={activeUnit.id} />

          {/* Importar nova tabela */}
          <PriceImport unitSlug={activeUnit.slug} unitName={activeUnit.name} />
        </>
      ) : (
        <p className="text-muted-foreground">Nenhuma unidade disponível.</p>
      )}
    </div>
  )
}
