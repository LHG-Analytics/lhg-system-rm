import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

  let units: Unit[] = []

  if (profile.role === 'super_admin') {
    const { data } = await supabase
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name')
    units = data ?? []
  } else if (profile.unit_id) {
    const { data } = await supabase
      .from('units')
      .select('*')
      .eq('id', profile.unit_id)
      .single()
    if (data) units = [data]
  }

  const activeUnit = units[0]
  if (!activeUnit) {
    // Usuário sem unidade atribuída — mostra erro amigável
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Nenhuma unidade atribuída ao seu usuário. Contate o administrador.
        </p>
      </div>
    )
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
