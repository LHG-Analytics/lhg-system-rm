'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface Notification {
  id: string
  title: string
  body: string
  type: string
  link: string | null
  read_at: string | null
  created_at: string
}

function fmtDate(iso: string) {
  const d = parseISO(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Agora'
  if (diffMins < 60) return `${diffMins}min atrás`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h atrás`
  return format(d, "dd/MM 'às' HH:mm", { locale: ptBR })
}

export function NotificationsBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const loadNotifications = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, link, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications((data ?? []) as Notification[])
  }, [])

  useEffect(() => {
    loadNotifications()

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    // Subscreve com filtro por user_id após resolver o usuário atual
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      channel = supabase
        .channel('notifications-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 20))
          }
        )
        .subscribe()
    })

    return () => { if (channel) void supabase.removeChannel(channel) }
  }, [loadNotifications])

  async function markAsRead(id: string) {
    const supabase = createClient()
    const readAt = new Date().toISOString()
    await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: readAt } : n))
    )
  }

  async function markAllAsRead() {
    const supabase = createClient()
    const readAt = new Date().toISOString()
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (!unreadIds.length) return
    await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .in('id', unreadIds)
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? readAt }))
    )
  }

  async function deleteNotification(id: string) {
    const supabase = createClient()
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  async function clearRead() {
    const supabase = createClient()
    const readIds = notifications.filter((n) => n.read_at).map((n) => n.id)
    if (!readIds.length) return
    await supabase.from('notifications').delete().in('id', readIds)
    setNotifications((prev) => prev.filter((n) => !n.read_at))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-semibold">Notificações</p>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Marcar lidas
              </button>
            )}
            {notifications.some((n) => n.read_at) && (
              <button
                onClick={clearRead}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
              >
                Limpar lidas
              </button>
            )}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell className="size-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma notificação</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            {notifications.map((n, idx) => (
              <div key={n.id}>
                {idx > 0 && <Separator />}
                <div className={cn(
                  'flex items-start gap-2 px-4 py-3 hover:bg-accent transition-colors group',
                  !n.read_at && 'bg-primary/5'
                )}>
                  <button
                    onClick={() => {
                      if (!n.read_at) markAsRead(n.id)
                      if (n.link) {
                        setOpen(false)
                        router.push(n.link)
                      }
                    }}
                    className={cn(
                      'flex items-start gap-2 flex-1 text-left min-w-0',
                      n.link && 'cursor-pointer'
                    )}
                  >
                    {!n.read_at && (
                      <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                    )}
                    <div className={cn('flex-1 min-w-0', n.read_at && 'pl-3.5')}>
                      <p className="text-xs font-medium leading-snug line-clamp-1">
                        {n.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                        {n.body}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {fmtDate(n.created_at)}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => deleteNotification(n.id)}
                    className="shrink-0 mt-0.5 size-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
