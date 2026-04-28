import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'
import type { AgentConfig } from '@/app/api/admin/agent-config/route'
import { UsersManager } from './_components/users-manager'
import { GuardrailsManager } from './_components/guardrails-manager'
import { EventsManager } from './_components/events-manager'
import { CapacityManager } from './_components/capacity-manager'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Shield, CalendarDays, BedDouble } from 'lucide-react'

export const metadata = { title: 'Administração — LHG Revenue Manager' }

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ unit?: string; tab?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (profile?.role !== 'super_admin') redirect('/dashboard')

  const admin = getAdminClient()
  const { unit: unitSlug, tab } = await searchParams

  const [profilesResult, authUsersResult, unitsResult] = await Promise.allSettled([
    admin.from('profiles').select('user_id, role, unit_id, created_at').order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('units').select('id, name, slug').eq('is_active', true).order('name'),
  ])

  const profiles  = profilesResult.status  === 'fulfilled' ? (profilesResult.value.data  ?? []) : []
  const authUsers = authUsersResult.status === 'fulfilled' ? (authUsersResult.value.data?.users ?? []) : []
  const unitsData = unitsResult.status     === 'fulfilled' ? (unitsResult.value.data ?? []) : []

  const emailMap    = new Map(authUsers.map((u) => [u.id, u.email        ?? '']))
  const invitedMap  = new Map(authUsers.map((u) => [u.id, u.invited_at   ?? null]))
  const lastSignMap = new Map(authUsers.map((u) => [u.id, u.last_sign_in_at ?? null]))

  const users = profiles.map((p) => ({
    user_id:    p.user_id,
    email:      emailMap.get(p.user_id)    ?? '',
    role:       p.role,
    unit_id:    p.unit_id,
    created_at: p.created_at,
    invited_at: invitedMap.get(p.user_id)  ?? null,
    last_sign_in: lastSignMap.get(p.user_id) ?? null,
  }))

  // Unidade selecionada (padrão: primeira)
  const activeUnitSlug = unitSlug ?? unitsData[0]?.slug ?? ''
  const activeUnit = unitsData.find((u) => u.slug === activeUnitSlug) ?? unitsData[0]
  const unitsForComponents = unitsData.map((u) => ({ id: u.id, name: u.name, slug: u.slug }))

  // Busca guardrails + último price import + config + eventos + capacity em paralelo
  const [guardrailsResult, priceImportResult, agentConfigResult, eventsResult, capacityResult, channelCostsResult] = activeUnit
    ? await Promise.all([
        supabase
          .from('agent_price_guardrails')
          .select('id, categoria, periodo, dia_tipo, preco_minimo, preco_maximo')
          .eq('unit_id', activeUnit.id)
          .order('categoria')
          .order('periodo')
          .order('dia_tipo'),
        supabase
          .from('price_imports')
          .select('parsed_data')
          .eq('unit_id', activeUnit.id)
          .order('valid_from', { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from('rm_agent_config')
          .select('id, unit_id, pricing_strategy, max_variation_pct, focus_metric, is_active, competitor_urls')
          .eq('unit_id', activeUnit.id)
          .maybeSingle(),
        (admin as any)
          .from('unit_events')
          .select('id, unit_id, title, event_date, event_end_date, event_type, impact_description, created_by, created_at, updated_at')
          .eq('unit_id', activeUnit.id)
          .order('event_date', { ascending: false })
          .limit(100),
        admin
          .from('unit_capacity')
          .select('id, categoria, custo_variavel_locacao, notes')
          .eq('unit_id', activeUnit.id)
          .order('categoria'),
        admin
          .from('unit_channel_costs')
          .select('id, canal, comissao_pct, taxa_fixa, notes')
          .eq('unit_id', activeUnit.id)
          .order('canal'),
      ])
    : [{ data: [] }, { data: null }, { data: null }, { data: [] }, { data: [] }, { data: [] }]

  const guardrailsData = guardrailsResult.data ?? []
  const importRows = (priceImportResult.data?.parsed_data as unknown as ParsedPriceRow[]) ?? []
  const categoriasFromImport = [...new Set(importRows.map((r) => r.categoria))].sort()
  const periodos   = [...new Set(importRows.map((r) => r.periodo))].sort()
  const agentConfig = (agentConfigResult.data ?? null) as AgentConfig | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventsData = (eventsResult as any).data ?? []
  const capacityData = capacityResult.data ?? []
  const channelCostsData = channelCostsResult.data ?? []

  // Disponibilidade real de suítes vem do Automo (descontando bloqueios ativos)
  const { getSuiteAvailabilityByCategory } = await import('@/lib/automo/suite-availability')
  const availabilityData = activeUnit
    ? await getSuiteAvailabilityByCategory(activeUnit.slug).catch(() => [])
    : []

  // União: categorias do import + cadastradas + reportadas pelo Automo
  const categorias = [...new Set([
    ...categoriasFromImport,
    ...capacityData.map((c) => c.categoria),
    ...availabilityData.map((a) => a.categoria),
  ])].sort()

  const defaultTab = tab ?? 'usuarios'

  return (
    <div className="flex flex-1 flex-col gap-6 max-w-2xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie usuários e configurações do sistema.</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-9">
          <TabsTrigger value="usuarios" className="gap-1.5 text-xs">
            <Users className="size-3.5" />
            Usuários
          </TabsTrigger>
          <TabsTrigger value="guardrails" className="gap-1.5 text-xs">
            <Shield className="size-3.5" />
            Guardrails
          </TabsTrigger>
          <TabsTrigger value="eventos" className="gap-1.5 text-xs">
            <CalendarDays className="size-3.5" />
            Eventos
          </TabsTrigger>
          <TabsTrigger value="capacidade" className="gap-1.5 text-xs">
            <BedDouble className="size-3.5" />
            Capacidade
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios" className="mt-6">
          <UsersManager
            initialUsers={users}
            units={unitsData.map((u) => ({ id: u.id, name: u.name }))}
            currentUserId={user.id}
          />
        </TabsContent>

        <TabsContent value="guardrails" className="mt-6">
          {activeUnit ? (
            <GuardrailsManager
              unitSlug={activeUnit.slug}
              unitName={activeUnit.name}
              categorias={categorias}
              periodos={periodos}
              units={unitsForComponents}
              initialGuardrails={guardrailsData.map((g) => ({
                id: g.id,
                categoria: g.categoria,
                periodo: g.periodo,
                dia_tipo: g.dia_tipo,
                preco_minimo: g.preco_minimo,
                preco_maximo: g.preco_maximo,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma unidade disponível.</p>
          )}
        </TabsContent>

        <TabsContent value="eventos" className="mt-6">
          {activeUnit ? (
            <EventsManager
              unitSlug={activeUnit.slug}
              unitName={activeUnit.name}
              units={unitsForComponents}
              initialEvents={eventsData}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma unidade disponível.</p>
          )}
        </TabsContent>

        <TabsContent value="capacidade" className="mt-6">
          {activeUnit ? (
            <CapacityManager
              unitSlug={activeUnit.slug}
              unitName={activeUnit.name}
              categorias={categorias}
              units={unitsForComponents}
              initialCapacity={capacityData.map((c) => ({
                id: c.id,
                categoria: c.categoria,
                custo_variavel_locacao: Number(c.custo_variavel_locacao),
                notes: c.notes,
              }))}
              initialChannelCosts={channelCostsData.map((c) => ({
                id: c.id,
                canal: c.canal,
                comissao_pct: Number(c.comissao_pct),
                taxa_fixa: Number(c.taxa_fixa),
                notes: c.notes,
              }))}
              initialAvailability={availabilityData}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma unidade disponível.</p>
          )}
        </TabsContent>

      </Tabs>
    </div>
  )
}
