'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell } from 'lucide-react'
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
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const loadNotifications = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications((data ?? []) as Notification[])
  }, [])

  useEffect(() => {
    loadNotifications()

    const supabase = createClient()
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 20))
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
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
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Marcar todas como lidas
            </button>
          )}
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
                <button
                  onClick={() => { if (!n.read_at) markAsRead(n.id) }}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-accent transition-colors',
                    !n.read_at && 'bg-primary/5'
                  )}
                >
                  <div className="flex items-start gap-2">
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
                  </div>
                </button>
              </div>
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
