import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AppSidebar } from '@/components/app-sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationsBell } from '@/components/notifications/notifications-bell'
import { AgentStreamingProvider } from '@/components/agente/agent-streaming-provider'
import { CurrencyProvider } from '@/components/currency-context'
import { AgentSidePanel } from '@/components/agente/agent-side-panel'
import { OnboardingGuide } from '@/components/onboarding/onboarding-guide'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import type { Database } from '@/types/database.types'

type Unit = Database['public']['Tables']['units']['Row']

// Usa admin client para buscar unidades — evita falha silenciosa de RLS
// em contas recém-criadas onde current_user_unit_id() ainda não propagou
function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/login')

  const admin = getAdminClient()
  let units: Unit[] = []

  // Qualquer role sem unit_id atribuído vê todas as unidades ativas
  if (!profile.unit_id) {
    const { data } = await admin
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name')
    units = data ?? []
  } else {
    // Busca a unidade atribuída sem filtro is_active — usuário atribuído deve ver
    // sua unidade independentemente do status (evita tela de "sem unidades")
    const { data } = await admin
      .from('units')
      .select('*')
      .eq('id', profile.unit_id)
      .maybeSingle()
    if (data) units = [data]

    // Fallback: admin/super_admin com unit_id inválido → acesso a todas as unidades ativas
    if (!units.length && ['admin', 'super_admin'].includes(profile.role ?? '')) {
      const { data: allUnits } = await admin
        .from('units')
        .select('*')
        .eq('is_active', true)
        .order('name')
      units = allUnits ?? []
    }
  }

  const activeUnit = units[0]
  if (!activeUnit) {
    return <NoUnitScreen email={user.email ?? ''} unitId={profile.unit_id} />
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <Suspense fallback={null}>
        <AppSidebar
          units={units}
          activeUnit={activeUnit}
          userEmail={user.email ?? ''}
          userRole={profile.role}
        />
      </Suspense>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          {/* Trigger visível só no mobile — no desktop o hover abre a sidebar */}
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Separator orientation="vertical" className="mr-2 h-4 md:hidden" />
          <div className="flex-1" />
          <OnboardingGuide userRole={profile.role ?? ''} unitSlug={activeUnit.slug} />
          <NotificationsBell />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 min-w-0 overflow-x-hidden">
          <Suspense fallback={null}>
            <CurrencyProvider>
              <AgentStreamingProvider>
                {children}
              </AgentStreamingProvider>
            </CurrencyProvider>
          </Suspense>
        </main>
      </SidebarInset>
      <Suspense fallback={null}>
        <AgentSidePanel units={units} userRole={profile.role ?? ''} />
      </Suspense>
    </SidebarProvider>
  )
}

// ─── Tela de erro: usuário sem unidade configurada ────────────────────────────

function NoUnitScreen({ email, unitId }: { email: string; unitId: string | null }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <span className="text-2xl">⚠️</span>
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Acesso não configurado</h2>
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade foi atribuída à conta <span className="font-medium text-foreground">{email}</span>.
            {unitId && (
              <span className="block mt-1 text-xs font-mono text-muted-foreground/60">unit_id: {unitId}</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Contate o administrador do sistema para que ele atribua uma unidade ao seu usuário.
          </p>
        </div>
        <a
          href="/api/auth/signout"
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Sair da conta
        </a>
      </div>
    </div>
  )
}
