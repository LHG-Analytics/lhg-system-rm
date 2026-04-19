'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { User, Building2, Plug, Bell } from 'lucide-react'
import { ProfileSettings } from './profile-settings'
import { UnitSettings } from './unit-settings'
import { IntegrationsSettings } from './integrations-settings'
import { NotificationSettings } from './notification-settings'

interface ConfiguracoesPageClientProps {
  userEmail: string
  userRole: string
  displayName: string | null
  notificationPreferences: Record<string, boolean>
  units: { id: string; name: string; slug: string; city: string | null }[]
  agentConfigs: { unit_id: string; city: string; timezone: string }[]
  activeUnitSlug: string
}

export function ConfiguracoesPageClient({
  userEmail,
  userRole,
  displayName,
  notificationPreferences,
  units,
  agentConfigs,
  activeUnitSlug,
}: ConfiguracoesPageClientProps) {
  const isAdmin = userRole === 'super_admin' || userRole === 'admin'
  const isSuperAdmin = userRole === 'super_admin'

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto w-full">
      <div>
        <h1 className="text-xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie seu perfil, preferências e integrações.</p>
      </div>

      <Tabs defaultValue="perfil">
        <TabsList className="h-9">
          <TabsTrigger value="perfil" className="gap-1.5 text-xs">
            <User className="size-3.5" /> Perfil
          </TabsTrigger>
          <TabsTrigger value="notificacoes" className="gap-1.5 text-xs">
            <Bell className="size-3.5" /> Notificações
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="unidade" className="gap-1.5 text-xs">
              <Building2 className="size-3.5" /> Unidade
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="integracoes" className="gap-1.5 text-xs">
              <Plug className="size-3.5" /> Integrações
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="perfil" className="mt-4">
          <ProfileSettings userEmail={userEmail} displayName={displayName} />
        </TabsContent>

        <TabsContent value="notificacoes" className="mt-4">
          <NotificationSettings initialPreferences={notificationPreferences} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="unidade" className="mt-4">
            <UnitSettings
              units={units}
              agentConfigs={agentConfigs}
              activeUnitSlug={activeUnitSlug}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="integracoes" className="mt-4">
            <IntegrationsSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
