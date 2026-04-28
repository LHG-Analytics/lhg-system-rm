import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AppSidebar } from '@/components/app-sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationsBell } from '@/components/notifications/notifications-bell'
import { AgentStreamingProvider } from '@/components/agente/agent-streaming-provider'
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

  // super_admin e admin sem unit_id atribuído veem todas as unidades
  const isGlobalRole = profile.role === 'super_admin' || (profile.role === 'admin' && !profile.unit_id)

  if (isGlobalRole) {
    const { data } = await admin
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name')
    units = data ?? []
  } else if (profile.unit_id) {
    const { data } = await admin
      .from('units')
      .select('*')
      .eq('id', profile.unit_id)
      .eq('is_active', true)
      .maybeSingle()
    if (data) units = [data]
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
          <NotificationsBell />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 min-w-0 overflow-x-hidden">
          <AgentStreamingProvider>
            {children}
          </AgentStreamingProvider>
        </main>
      </SidebarInset>
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
