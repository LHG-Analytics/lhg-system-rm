import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PriceImportQueue, ImportJobHistory } from '@/components/precos/price-import-queue'
import { PriceList } from '@/components/precos/price-list'

interface DescontosPageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function DescontosPage({ searchParams }: DescontosPageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
        <h1 className="text-2xl font-semibold tracking-tight">Descontos</h1>
        <p className="text-sm text-muted-foreground">
          {activeUnit
            ? `Política de descontos do Guia de Motéis — ${activeUnit.name}`
            : 'Política de descontos do Guia de Motéis'}
        </p>
      </div>

      {activeUnit ? (
        <div className="flex flex-col gap-4">
          <PriceImportQueue unitSlug={activeUnit.slug} unitName={activeUnit.name} importType="discounts" />
          <Tabs defaultValue="tabelas">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="tabelas">Descontos importados</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="tabelas" className="mt-4">
              <PriceList unitSlug={activeUnit.slug} unitId={activeUnit.id} importType="discounts" />
            </TabsContent>
            <TabsContent value="historico" className="mt-4">
              <ImportJobHistory unitSlug={activeUnit.slug} unitId={activeUnit.id} unitName={activeUnit.name} importType="discounts" />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="text-muted-foreground">Nenhuma unidade disponível.</p>
      )}
    </div>
  )
}
