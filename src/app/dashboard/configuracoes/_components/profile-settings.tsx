'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, User, KeyRound, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface ProfileSettingsProps {
  userEmail: string
  displayName: string | null
}

export function ProfileSettings({ userEmail, displayName: initialDisplayName }: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [savingName, setSavingName]   = useState(false)
  const [savedName, setSavedName]     = useState(false)
  const [nameError, setNameError]     = useState<string | null>(null)

  const [currentPwd, setCurrentPwd]   = useState('')
  const [newPwd, setNewPwd]           = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [savingPwd, setSavingPwd]     = useState(false)
  const [savedPwd, setSavedPwd]       = useState(false)
  const [pwdError, setPwdError]       = useState<string | null>(null)

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSavingName(true)
    setNameError(null)
    setSavedName(false)
    try {
      const res = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName || null }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setSavedName(true)
      setTimeout(() => setSavedName(false), 3000)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSavingName(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPwd !== confirmPwd) { setPwdError('As senhas não coincidem'); return }
    if (newPwd.length < 8) { setPwdError('A senha deve ter pelo menos 8 caracteres'); return }
    setSavingPwd(true)
    setPwdError(null)
    setSavedPwd(false)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: newPwd })
      if (error) throw error
      setSavedPwd(true)
      setCurrentPwd('')
      setNewPwd('')
      setConfirmPwd('')
      setTimeout(() => setSavedPwd(false), 3000)
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Erro ao alterar senha')
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Nome de exibição */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <User className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Informações do perfil</p>
            <p className="text-xs text-muted-foreground">Seu nome de exibição no sistema.</p>
          </div>
        </div>

        <form onSubmit={handleSaveName} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={userEmail} disabled className="h-9 text-sm bg-muted/40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Nome de exibição</Label>
            <Input
              placeholder="Seu nome"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={savingName}
              className="h-9 text-sm"
            />
          </div>
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" className="gap-1.5" disabled={savingName}>
              {savingName
                ? <Loader2 className="size-3.5 animate-spin" />
                : savedName
                ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                : null}
              {savedName ? 'Salvo!' : 'Salvar'}
            </Button>
          </div>
        </form>
      </div>

      {/* Alterar senha */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Alterar senha</p>
            <p className="text-xs text-muted-foreground">Só aplicável a contas com login por email/senha.</p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Nova senha</Label>
            <Input
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              disabled={savingPwd}
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Confirmar nova senha</Label>
            <Input
              type="password"
              placeholder="Repita a nova senha"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              disabled={savingPwd}
              className="h-9 text-sm"
            />
          </div>
          {pwdError && <p className="text-xs text-destructive">{pwdError}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" className="gap-1.5" disabled={savingPwd || !newPwd}>
              {savingPwd
                ? <Loader2 className="size-3.5 animate-spin" />
                : savedPwd
                ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                : null}
              {savedPwd ? 'Senha alterada!' : 'Alterar senha'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
