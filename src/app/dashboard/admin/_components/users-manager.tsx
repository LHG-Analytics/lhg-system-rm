'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, UserPlus, Trash2, Mail, CheckCircle2, Clock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface UserEntry {
  user_id: string
  email: string
  role: string
  unit_id: string | null
  created_at: string
  invited_at: string | null
  last_sign_in: string | null
}

interface Unit {
  id: string
  name: string
}

interface UsersManagerProps {
  initialUsers: UserEntry[]
  units: Unit[]
  currentUserId: string
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Gerente',
  viewer: 'Visualizador',
}

const ROLE_CLASS: Record<string, string> = {
  super_admin: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  admin: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  manager: 'bg-green-500/10 text-green-600 border-green-500/20',
  viewer: 'bg-muted/50 text-muted-foreground border-border',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function UsersManager({ initialUsers, units, currentUserId }: UsersManagerProps) {
  const [users, setUsers] = useState<UserEntry[]>(initialUsers)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('manager')
  const [unitId, setUnitId] = useState<string>('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, unit_id: unitId || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao convidar')
      setSuccess(`Convite enviado para ${email}`)
      setEmail('')
      // Adiciona à lista localmente
      setUsers((prev) => [{
        user_id: data.user_id,
        email,
        role,
        unit_id: unitId || null,
        created_at: new Date().toISOString(),
        invited_at: new Date().toISOString(),
        last_sign_in: null,
      }, ...prev])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setInviting(false)
    }
  }, [email, role, unitId])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/invite?userId=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erro ao remover')
      }
      setUsers((prev) => prev.filter((u) => u.user_id !== confirmDelete))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete])

  const needsUnit = role !== 'super_admin'

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Usuários</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie quem tem acesso ao sistema. Apenas usuários convidados podem fazer login.
        </p>
      </div>

      {/* Formulário de invite */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="size-4" />
          Convidar novo usuário
        </h2>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}
        {success && (
          <div className="rounded-lg bg-green-500/10 px-4 py-3 text-sm text-green-600 flex items-center gap-2">
            <Mail className="size-4" />{success}
          </div>
        )}

        <form onSubmit={handleInvite} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1 flex flex-col gap-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="nome@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={inviting}
                className="h-9 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Perfil</Label>
              <Select value={role} onValueChange={setRole} disabled={inviting}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Gerente</SelectItem>
                  <SelectItem value="viewer">Visualizador</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Unidade {!needsUnit && <span className="text-muted-foreground">(opcional)</span>}</Label>
              <Select value={unitId} onValueChange={setUnitId} disabled={inviting}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecionar…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas as unidades</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" className="gap-1.5" disabled={inviting}>
              {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
              Enviar convite
            </Button>
          </div>
        </form>
      </div>

      {/* Lista de usuários */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {users.length} {users.length === 1 ? 'usuário' : 'usuários'} com acesso
        </h2>

        {users.map((u) => {
          const unit = units.find((un) => un.id === u.unit_id)
          const isMe = u.user_id === currentUserId
          const hasLoggedIn = !!u.last_sign_in

          return (
            <div key={u.user_id} className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{u.email}</span>
                  {isMe && <span className="text-[10px] text-muted-foreground">(você)</span>}
                  <Badge variant="outline" className={cn('text-[10px] gap-1', ROLE_CLASS[u.role])}>
                    {ROLE_LABELS[u.role] ?? u.role}
                  </Badge>
                  {unit && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {unit.name}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {hasLoggedIn ? (
                    <span className="flex items-center gap-1 text-[11px] text-green-600">
                      <CheckCircle2 className="size-3" />
                      Último acesso {fmtDate(u.last_sign_in)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="size-3" />
                      Aguardando aceite do convite
                    </span>
                  )}
                </div>
              </div>

              {!isMe && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmDelete(u.user_id)}
                  title="Remover acesso"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          )
        })}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário perderá o acesso imediatamente e não conseguirá mais fazer login.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
