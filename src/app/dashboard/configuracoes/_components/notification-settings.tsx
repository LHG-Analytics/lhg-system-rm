'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Bell, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NotificationItem {
  key: string
  label: string
  description: string
}

const NOTIFICATION_ITEMS: NotificationItem[] = [
  {
    key: 'scheduled_reviews',
    label: 'Revisões agendadas',
    description: 'Notificação quando o Agente RM concluir uma revisão automática de preços.',
  },
  {
    key: 'import_complete',
    label: 'Importações concluídas',
    description: 'Notificação quando uma planilha de preços ou descontos for importada com sucesso.',
  },
  {
    key: 'import_errors',
    label: 'Erros de importação',
    description: 'Notificação quando uma importação falhar ou necessitar de atenção.',
  },
  {
    key: 'competitor_analysis',
    label: 'Análise de concorrentes',
    description: 'Notificação quando uma nova análise de preços de concorrentes for concluída.',
  },
  {
    key: 'proposals',
    label: 'Propostas de preço',
    description: 'Notificação quando o agente gerar uma nova proposta de preços pendente de aprovação.',
  },
]

interface NotificationSettingsProps {
  initialPreferences: Record<string, boolean>
}

export function NotificationSettings({ initialPreferences }: NotificationSettingsProps) {
  const defaultPrefs = NOTIFICATION_ITEMS.reduce<Record<string, boolean>>((acc, item) => {
    acc[item.key] = initialPreferences[item.key] ?? true
    return acc
  }, {})

  const [prefs, setPrefs]     = useState(defaultPrefs)
  const [saved, setSaved]     = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function handleToggle(key: string, value: boolean) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setError(null)
    try {
      const res = await fetch('/api/admin/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_preferences: next }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
    } catch (err) {
      setPrefs((prev) => ({ ...prev, [key]: !value }))
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <Bell className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Notificações in-app</p>
          <p className="text-xs text-muted-foreground">Controle quais eventos geram notificação no sino do header.</p>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col divide-y divide-border">
        {NOTIFICATION_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`notif-${item.key}`} className="text-sm font-medium cursor-pointer">
                  {item.label}
                </Label>
                {saved === item.key && (
                  <CheckCircle2 className={cn('size-3 text-emerald-500 transition-opacity')} />
                )}
              </div>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Switch
              id={`notif-${item.key}`}
              checked={prefs[item.key] ?? true}
              onCheckedChange={(v) => handleToggle(item.key, v)}
              className="shrink-0 mt-0.5"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
