'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Building2, CheckCircle2, RefreshCw, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { type BudgetConfig, DEFAULT_BUDGET_CONFIG, resolveBudgetConfig } from '@/lib/budget/google-sheets'

interface UnitConfig {
  unit_id: string
  city: string
  timezone: string
  budget_sheet_url: string
  budget_config: BudgetConfig
  budget_last_sync: string | null
}

interface UnitSettingsProps {
  units: { id: string; name: string; slug: string; city: string | null }[]
  agentConfigs: { unit_id: string; city: string; timezone: string; budget_sheet_url: string | null; budget_config: unknown; budget_last_sync: string | null }[]
  activeUnitSlug: string
}

const TIMEZONES = [
  { value: 'America/Sao_Paulo',    label: 'Brasília (UTC−3)' },
  { value: 'America/Fortaleza',    label: 'Fortaleza (UTC−3)' },
  { value: 'America/Recife',       label: 'Recife (UTC−3)' },
  { value: 'America/Belem',        label: 'Belém (UTC−3)' },
  { value: 'America/Manaus',       label: 'Manaus (UTC−4)' },
  { value: 'America/Cuiaba',       label: 'Cuiabá (UTC−4)' },
  { value: 'America/Porto_Velho',  label: 'Porto Velho (UTC−4)' },
  { value: 'America/Rio_Branco',   label: 'Rio Branco (UTC−5)' },
  { value: 'America/Noronha',      label: 'Fernando de Noronha (UTC−2)' },
]

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function formatSyncDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function UnitSettings({ units, agentConfigs, activeUnitSlug }: UnitSettingsProps) {
  const [selectedSlug, setSelectedSlug] = useState(activeUnitSlug)
  const activeUnit = units.find((u) => u.slug === selectedSlug) ?? units[0]

  const configForUnit = (unitId: string): UnitConfig => {
    const existing = agentConfigs.find((c) => c.unit_id === unitId)
    return {
      unit_id:          unitId,
      city:             existing?.city ?? 'Sao Paulo,BR',
      timezone:         existing?.timezone ?? 'America/Sao_Paulo',
      budget_sheet_url: existing?.budget_sheet_url ?? '',
      budget_config:    resolveBudgetConfig(existing?.budget_config),
      budget_last_sync: existing?.budget_last_sync ?? null,
    }
  }

  const [configs, setConfigs]       = useState<Record<string, UnitConfig>>(() => {
    const map: Record<string, UnitConfig> = {}
    for (const u of units) map[u.id] = configForUnit(u.id)
    return map
  })
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [syncing, setSyncing]       = useState(false)
  const [syncResult, setSyncResult] = useState<{
    receita_total: number; receita_locacoes: number; receita_prod_serv: number | null
    ticket: number | null; giro: number | null; revpar: number | null
    month: number; year: number; months_synced: number; isFallback: boolean
  } | null>(null)
  const [syncError, setSyncError]   = useState<string | null>(null)

  const current = activeUnit ? configs[activeUnit.id] : null

  function updateCurrent(patch: Partial<UnitConfig>) {
    if (!activeUnit) return
    setConfigs((prev) => ({ ...prev, [activeUnit.id]: { ...prev[activeUnit.id], ...patch } }))
  }

  function updateBudgetConfig(patch: Partial<BudgetConfig>) {
    if (!activeUnit || !current) return
    updateCurrent({ budget_config: { ...current.budget_config, ...patch } })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeUnit || !current) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id:          activeUnit.id,
          city:             current.city,
          timezone:         current.timezone,
          budget_sheet_url: current.budget_sheet_url || null,
          budget_config:    current.budget_config,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSync() {
    if (!activeUnit || !current?.budget_sheet_url) return
    setSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      const res = await fetch('/api/admin/budget-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug: selectedSlug }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao sincronizar')
      const now = new Date()
      setSyncResult({
        receita_total:     data.receita_total ?? data.receita_locacoes,
        receita_locacoes:  data.receita_locacoes,
        receita_prod_serv: data.receita_prod_serv ?? null,
        ticket:            data.ticket  ?? null,
        giro:              data.giro    ?? null,
        revpar:            data.revpar  ?? null,
        month:             data.month,
        year:              data.year,
        months_synced:     data.months_synced ?? 1,
        isFallback:        data.month !== (now.getMonth() + 1),
      })
      updateCurrent({ budget_last_sync: new Date().toISOString() })
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  if (!activeUnit || !current) return null

  const cfg = current.budget_config
  const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Configurações gerais da unidade ─── */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Configurações da unidade</p>
            <p className="text-xs text-muted-foreground">Fuso horário e cidade usados pelo agente RM.</p>
          </div>
        </div>

        {units.length > 1 && (
          <Select value={selectedSlug} onValueChange={setSelectedSlug}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.slug} value={u.slug}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Fuso horário</Label>
              <Select value={current.timezone} onValueChange={(v) => updateCurrent({ timezone: v })} disabled={saving}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Cidade (para clima e eventos)</Label>
              <Input
                placeholder="Ex: Sao Paulo,BR"
                value={current.city}
                onChange={(e) => updateCurrent({ city: e.target.value })}
                disabled={saving}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Formato da cidade: <span className="font-mono">Nome da Cidade,XX</span> onde XX é o código ISO do país (ex: BR, US).
          </p>

          <Separator />

          {/* ─── Planilha de orçamento ─── */}
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <FileSpreadsheet className="size-3.5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold">Orçamento — Google Sheets</p>
              <p className="text-[11px] text-muted-foreground">
                Receita total = locações + produtos + serviços. Ticket = receita total / total de locações.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* URL */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">URL da planilha</Label>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={current.budget_sheet_url}
                onChange={(e) => updateCurrent({ budget_sheet_url: e.target.value })}
                disabled={saving}
                className="h-9 text-sm font-mono text-[11px]"
              />
            </div>

            {/* ── Locações ── */}
            <div className="rounded-lg border px-3 py-2.5 flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Aba de Locações</p>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">Nome da aba</Label>
                  <Input
                    placeholder={DEFAULT_BUDGET_CONFIG.locacoes_tab}
                    value={cfg.locacoes_tab}
                    onChange={(e) => updateBudgetConfig({ locacoes_tab: e.target.value })}
                    disabled={saving}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Linha Receita</Label>
                    <Input
                      type="number" min={1}
                      placeholder={String(DEFAULT_BUDGET_CONFIG.locacoes_receita_row)}
                      value={cfg.locacoes_receita_row}
                      onChange={(e) => updateBudgetConfig({ locacoes_receita_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.locacoes_receita_row })}
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Linha Total Loc.</Label>
                    <Input
                      type="number" min={1}
                      placeholder={String(DEFAULT_BUDGET_CONFIG.locacoes_total_row)}
                      value={cfg.locacoes_total_row}
                      onChange={(e) => updateBudgetConfig({ locacoes_total_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.locacoes_total_row })}
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Linha Giro</Label>
                    <Input
                      type="number" min={1}
                      placeholder={String(DEFAULT_BUDGET_CONFIG.locacoes_giro_row)}
                      value={cfg.locacoes_giro_row}
                      onChange={(e) => updateBudgetConfig({ locacoes_giro_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.locacoes_giro_row })}
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Linha RevPAR</Label>
                    <Input
                      type="number" min={1}
                      placeholder={String(DEFAULT_BUDGET_CONFIG.locacoes_revpar_row)}
                      value={cfg.locacoes_revpar_row}
                      onChange={(e) => updateBudgetConfig({ locacoes_revpar_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.locacoes_revpar_row })}
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Produtos e Serviços ── */}
            <div className="rounded-lg border px-3 py-2.5 flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Aba de Produtos e Serviços</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">Nome da aba</Label>
                  <Input
                    placeholder={DEFAULT_BUDGET_CONFIG.prod_serv_tab}
                    value={cfg.prod_serv_tab}
                    onChange={(e) => updateBudgetConfig({ prod_serv_tab: e.target.value })}
                    disabled={saving}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">Linha Produtos</Label>
                  <Input
                    type="number" min={1}
                    placeholder={String(DEFAULT_BUDGET_CONFIG.prod_serv_produtos_row)}
                    value={cfg.prod_serv_produtos_row}
                    onChange={(e) => updateBudgetConfig({ prod_serv_produtos_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.prod_serv_produtos_row })}
                    disabled={saving}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">Linha Serviços</Label>
                  <Input
                    type="number" min={1}
                    placeholder={String(DEFAULT_BUDGET_CONFIG.prod_serv_servicos_row)}
                    value={cfg.prod_serv_servicos_row}
                    onChange={(e) => updateBudgetConfig({ prod_serv_servicos_row: parseInt(e.target.value) || DEFAULT_BUDGET_CONFIG.prod_serv_servicos_row })}
                    disabled={saving}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Compartilhe a planilha com o e-mail da conta de serviço em{' '}
              <span className="font-mono bg-muted px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</span>.
              Colunas C–N = jan–dez em todas as abas.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Feedback do sync */}
            <div className="text-xs text-muted-foreground">
              {current.budget_last_sync && !syncResult && (
                <span>Último sync: {formatSyncDate(current.budget_last_sync)}</span>
              )}
              {syncResult && !syncResult.isFallback && (
                <span className="text-emerald-600 flex flex-col gap-0.5">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    {syncResult.months_synced} {syncResult.months_synced === 1 ? 'mês sincronizado' : 'meses sincronizados'} ({syncResult.year})
                  </span>
                  <span className="pl-4 text-[10px] font-mono text-muted-foreground">
                    Total {formatCurrency(syncResult.receita_total)}
                    {syncResult.receita_prod_serv != null && (
                      <> (Loc {formatCurrency(syncResult.receita_locacoes)} + P&S {formatCurrency(syncResult.receita_prod_serv)})</>
                    )}
                    {syncResult.ticket != null && ` · Ticket R$${syncResult.ticket.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                    {syncResult.giro   != null && ` · Giro ${syncResult.giro.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}
                    {syncResult.revpar != null && ` · RevPAR R$${syncResult.revpar.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </span>
                </span>
              )}
              {syncResult?.isFallback && (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertCircle className="size-3" />
                  Mês atual vazio — usando {MONTHS_PT[(syncResult.month - 1)]}.: {formatCurrency(syncResult.receita_total)}
                </span>
              )}
              {syncError && (
                <span className="text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" />
                  {syncError}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {current.budget_sheet_url && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleSync}
                  disabled={syncing || saving}
                >
                  {syncing
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <RefreshCw className="size-3.5" />}
                  Sincronizar agora
                </Button>
              )}
              <Button type="submit" size="sm" className="gap-1.5" disabled={saving}>
                {saving
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : saved
                  ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                  : null}
                {saved ? 'Salvo!' : 'Salvar'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
