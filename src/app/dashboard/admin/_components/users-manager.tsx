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
import { Loader2, UserPlus, Trash2, Mail, CheckCircle2, Clock, Pencil, Check, X } from 'lucide-react'
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
  super_admin: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  admin:       'bg-blue-500/10 text-blue-500 border-blue-500/20',
  manager:     'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  viewer:      'bg-muted/50 text-muted-foreground border-border',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

// ─── Linha de usuário com edição inline ──────────────────────────────────────

interface UserRowProps {
  u: UserEntry
  units: Unit[]
  isMe: boolean
  onUpdate: (userId: string, role: string, unitId: string | null) => void
  onDelete: (userId: string) => void
}

function UserRow({ u, units, isMe, onUpdate, onDelete }: UserRowProps) {
  const [editing, setEditing]   = useState(false)
  const [role, setRole]         = useState(u.role)
  const [unitId, setUnitId]     = useState(u.unit_id ?? 'all')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const unit = units.find((un) => un.id === u.unit_id)
  const hasLoggedIn = !!u.last_sign_in

  function handleCancel() {
    setRole(u.role)
    setUnitId(u.unit_id ?? 'all')
    setError(null)
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: u.user_id,
          role,
          unit_id: unitId === 'all' ? null : unitId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      onUpdate(u.user_id, role, unitId === 'all' ? null : unitId)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn(
      'rounded-xl border bg-card px-4 py-3 flex flex-col gap-2 transition-colors',
      editing && 'border-primary/30 bg-primary/5'
    )}>
      {/* Cabeçalho: email + badges + ações */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{u.email}</span>
            {isMe && <span className="text-[10px] text-muted-foreground">(você)</span>}
            {!editing && (
              <>
                <Badge variant="outline" className={cn('text-[10px] gap-1', ROLE_CLASS[u.role])}>
                  {ROLE_LABELS[u.role] ?? u.role}
                </Badge>
                {unit && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {unit.name}
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            {hasLoggedIn ? (
              <span className="flex items-center gap-1 text-[11px] text-emerald-500">
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

        {/* Botões de ação */}
        {!isMe && (
          <div className="flex items-center gap-1 shrink-0">
            {editing ? (
              <>
                <Button
                  variant="ghost" size="icon"
                  className="size-7 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                  onClick={handleSave} disabled={saving}
                  title="Salvar alterações"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleCancel} disabled={saving}
                  title="Cancelar"
                >
                  <X className="size-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost" size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                  onClick={() => setEditing(true)}
                  title="Editar perfil e unidade"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(u.user_id)}
                  title="Remover acesso"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controles de edição */}
      {editing && (
        <div className="flex flex-col gap-2 pt-1 border-t border-border/50">
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Perfil</Label>
              <Select value={role} onValueChange={setRole} disabled={saving}>
                <SelectTrigger className="h-8 text-xs">
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
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Unidade</Label>
              <Select value={unitId} onValueChange={setUnitId} disabled={saving}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as unidades</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Container principal ──────────────────────────────────────────────────────

export function UsersManager({ initialUsers, units, currentUserId }: UsersManagerProps) {
  const [users, setUsers]           = useState<UserEntry[]>(initialUsers)
  const [email, setEmail]           = useState('')
  const [role, setRole]             = useState('manager')
  const [unitId, setUnitId]         = useState<string>('all')
  const [inviting, setInviting]     = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting]     = useState(false)

  const handleInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, unit_id: unitId === 'all' ? null : unitId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao convidar')
      setSuccess(`Convite enviado para ${email}`)
      setEmail('')
      setUsers((prev) => [{
        user_id:    data.user_id,
        email,
        role,
        unit_id:    unitId === 'all' ? null : unitId,
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

  const handleUpdate = useCallback((userId: string, newRole: string, newUnitId: string | null) => {
    setUsers((prev) =>
      prev.map((u) => u.user_id === userId ? { ...u, role: newRole, unit_id: newUnitId } : u)
    )
  }, [])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/invite?userId=${confirmDelete}`, { method: 'DELETE' })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error ?? 'Erro ao remover') }
      setUsers((prev) => prev.filter((u) => u.user_id !== confirmDelete))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [confirmDelete])

  return (
    <div className="flex flex-col gap-8 max-w-2xl">

      {/* Formulário de convite */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <UserPlus className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Convidar novo usuário</p>
            <p className="text-xs text-muted-foreground">O usuário receberá um email com link de acesso.</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}
        {success && (
          <div className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 flex items-center gap-2">
            <Mail className="size-4 shrink-0" />{success}
          </div>
        )}

        <form onSubmit={handleInvite} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
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

          <div className="grid grid-cols-2 gap-3">
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
              <Label className="text-xs">Unidade</Label>
              <Select value={unitId} onValueChange={setUnitId} disabled={inviting}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as unidades</SelectItem>
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
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {users.length} {users.length === 1 ? 'usuário' : 'usuários'} com acesso
          </p>
          <p className="text-[11px] text-muted-foreground">Clique em ✏️ para editar perfil ou unidade</p>
        </div>

        {users.map((u) => (
          <UserRow
            key={u.user_id}
            u={u}
            units={units}
            isMe={u.user_id === currentUserId}
            onUpdate={handleUpdate}
            onDelete={setConfirmDelete}
          />
        ))}
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
