import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CompetitorAnalysisManager } from '@/components/concorrentes/competitor-analysis-manager'

interface ConcorrentesPageProps {
  searchParams: Promise<{ unit?: string }>
}

export default async function ConcorrentesPage({ searchParams }: ConcorrentesPageProps) {
  const { unit: unitSlug } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Carrega todas as unidades ativas
  const { data: units } = await supabase
    .from('units')
    .select('id, slug, name')
    .eq('is_active', true)
    .order('name')

  const allUnits = units ?? []

  // Resolve unidade ativa
  let activeUnit: { id: string; slug: string; name: string } | null = null

  if (unitSlug) {
    activeUnit = allUnits.find((u) => u.slug === unitSlug) ?? null
  }

  if (!activeUnit && profile.unit_id) {
    activeUnit = allUnits.find((u) => u.id === profile.unit_id) ?? null
  }

  if (!activeUnit) {
    activeUnit = allUnits[0] ?? null
  }

  if (!activeUnit) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Concorrentes</h1>
        </div>
        <p className="text-muted-foreground">Nenhuma unidade disponível.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Concorrentes</h1>
        <p className="text-sm text-muted-foreground">
          Monitore preços de concorrentes via scraping automático com análise por IA.
        </p>
      </div>

      <CompetitorAnalysisManager
        unitSlug={activeUnit.slug}
        unitName={activeUnit.name}
        units={allUnits}
      />
    </div>
  )
}
