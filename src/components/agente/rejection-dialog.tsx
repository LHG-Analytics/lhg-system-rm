'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PRICE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'precos_muito_altos',           label: 'Preços muito altos' },
  { value: 'precos_muito_baixos',          label: 'Preços muito baixos' },
  { value: 'estrategia_inadequada',        label: 'Estratégia inadequada' },
  { value: 'item_especifico_errado',       label: 'Item(ns) específico(s) errado(s)' },
  { value: 'momento_inadequado',           label: 'Momento inadequado' },
  { value: 'concorrencia_nao_considerada', label: 'Concorrência não considerada' },
  { value: 'margem_insuficiente',          label: 'Margem insuficiente' },
  { value: 'outro',                        label: 'Outro' },
]

const DISCOUNT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'desconto_alto_demais',  label: 'Desconto alto demais' },
  { value: 'desconto_baixo_demais', label: 'Desconto baixo demais' },
  { value: 'condicao_inadequada',   label: 'Condição inadequada' },
  { value: 'momento_inadequado',    label: 'Momento inadequado' },
  { value: 'outro',                 label: 'Outro' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'price' | 'discount'
  loading?: boolean
  onConfirm: (reasonType: string, reasonText: string) => void
}

export function RejectionDialog({ open, onOpenChange, kind, loading = false, onConfirm }: Props) {
  const [reasonType, setReasonType] = useState('')
  const [reasonText, setReasonText] = useState('')

  const reasons = kind === 'price' ? PRICE_REASONS : DISCOUNT_REASONS

  function handleConfirm() {
    if (!reasonType) return
    onConfirm(reasonType, reasonText.trim())
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReasonType('')
      setReasonText('')
    }
    onOpenChange(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rejeitar proposta</AlertDialogTitle>
          <AlertDialogDescription>
            Captura o motivo da rejeição para que o agente RM aprenda e evite repetir o mesmo padrão.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Motivo principal *</Label>
            <Select value={reasonType} onValueChange={setReasonType}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Detalhes (opcional)</Label>
            <Textarea
              rows={3}
              placeholder="Ex: aumento de 12% no Master FDS é agressivo demais; concorrente Drops está em R$ 280"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              O texto aqui aparece na memória do agente em conversas futuras — seja específico.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              disabled={!reasonType || loading}
              onClick={handleConfirm}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : 'Confirmar rejeição'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
