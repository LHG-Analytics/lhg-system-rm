'use client'

import Link from 'next/link'
import Image, { type StaticImageData } from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import lushLogoSrc from '../../public/lush-logo.png'
import altanaLogoSrc from '../../public/altana - logo.webp'
import andarLogoSrc from '../../public/logo andar de cima.png'
import toutLogoSrc from '../../public/tout-logo.png'
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

// Importações estáticas garantem URLs com hash geradas pelo bundler (mais confiável que caminhos públicos)
const UNIT_LOGO_CONFIG: Record<string, { src: StaticImageData; darkBg?: boolean }> = {
  lush_ipiranga: { src: lushLogoSrc },
  lush_lapa:     { src: lushLogoSrc },
  altana:        { src: altanaLogoSrc, darkBg: true },
  andar_de_cima: { src: andarLogoSrc },
  tout:          { src: toutLogoSrc },
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
        <Image
          src={config.src}
          alt={name}
          width={size}
          height={size}
          onError={() => setImgError(true)}
          className="object-contain"
          style={{ width: size, height: size }}
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
