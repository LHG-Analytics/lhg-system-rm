'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import {
  BarChart3,
  BotMessageSquare,
  Building2,
  ChevronsUpDown,
  Hotel,
  LayoutDashboard,
  LogOut,
  Settings,
  Tags,
  Warehouse,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database.types'

type Unit = Database['public']['Tables']['units']['Row']
type UserRole = Database['public']['Enums']['user_role']

interface AppSidebarProps {
  units: Unit[]
  activeUnit: Unit
  userEmail: string
  userRole: UserRole
}

// Configuração por slug: src da logo e classe de fundo do container
// bg: 'dark' para logos brancas (precisam de fundo escuro), 'light' para logos escuras/coloridas
const UNIT_LOGO_CONFIG: Record<string, { src: string; darkBg?: boolean }> = {
  lush_ipiranga: { src: '/lush-logo.png' },
  lush_lapa:     { src: '/lush-logo.png' },
  altana:        { src: '/altana - logo.webp', darkBg: true },
  andar_de_cima: { src: '/logo andar de cima.png' },
  tout:          { src: '/tout-logo.png' },
}

function UnitLogo({ slug, name, size = 32 }: { slug: string; name: string; size?: number }) {
  const [imgError, setImgError] = useState(false)
  const config = UNIT_LOGO_CONFIG[slug]

  if (config && !imgError) {
    const bgClass = config.darkBg ? 'bg-zinc-900' : 'bg-transparent'
    return (
      <div
        className={`flex items-center justify-center rounded-lg overflow-hidden shrink-0 ${bgClass}`}
        style={{ width: size, height: size, minWidth: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={config.src}
          alt={name}
          onError={() => setImgError(true)}
          className="object-contain w-full h-full"
        />
      </div>
    )
  }

  return (
    <div
      className="flex items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shrink-0"
      style={{ width: size, height: size, minWidth: size }}
    >
      <Hotel className="size-4" />
    </div>
  )
}

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Preços', href: '/dashboard/precos', icon: Tags },
  { label: 'Disponibilidade', href: '/dashboard/disponibilidade', icon: Warehouse },
  { label: 'Agente RM', href: '/dashboard/agente', icon: BotMessageSquare },
  { label: 'Relatórios', href: '/dashboard/relatorios', icon: BarChart3 },
]

const adminNavItems = [
  { label: 'Configurações', href: '/dashboard/configuracoes', icon: Settings },
  { label: 'Administração', href: '/dashboard/admin', icon: Building2 },
]

export function AppSidebar({ units, activeUnit: defaultUnit, userEmail, userRole }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setOpen, isMobile } = useSidebar()

  const unitSlug = searchParams.get('unit')
  const activeUnit = units.find((u) => u.slug === unitSlug) ?? defaultUnit

  const showAdmin = userRole === 'super_admin' || userRole === 'admin'

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleUnitChange(unit: Unit) {
    router.push(`${pathname}?unit=${unit.slug}`)
  }

  const initials = userEmail
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase()

  return (
    <Sidebar
      collapsible="icon"
      onMouseEnter={() => !isMobile && setOpen(true)}
      onMouseLeave={() => !isMobile && setOpen(false)}
    >
      {/* Unit selector */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <UnitLogo slug={activeUnit.slug} name={activeUnit.name} size={32} />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{activeUnit.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {activeUnit.city ?? 'LHG Motéis'}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Unidades
                </DropdownMenuLabel>
                {units.map((unit) => (
                  <DropdownMenuItem
                    key={unit.id}
                    onClick={() => handleUnitChange(unit)}
                    className="gap-2 p-2"
                  >
                    <UnitLogo slug={unit.slug} name={unit.name} size={20} />
                    {unit.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Main navigation */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestão</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const href = `${item.href}?unit=${activeUnit.slug}`
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={item.label}
                  >
                    <Link href={href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>

        {showAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarMenu>
              {adminNavItems.map((item) => {
                const href = `${item.href}?unit=${activeUnit.slug}`
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <Link href={href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* User menu */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userEmail.split('@')[0]}</span>
                    <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{userEmail.split('@')[0]}</p>
                    <p className="text-xs text-muted-foreground">{userEmail}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="size-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
