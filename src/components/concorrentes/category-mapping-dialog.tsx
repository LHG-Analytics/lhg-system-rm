'use client'

import { useState, useMemo } from 'react'
import { GitMerge, ArrowRight, Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AgentConfig, CategoryMapEntry, CompetitorUrl } from '@/app/api/admin/agent-config/route'
import type { CompetitorSnapshot, MappedPrice } from '@/app/api/agente/competitor-analysis/route'

interface CategoryMappingDialogProps {
  config: AgentConfig | null
  snapshots: CompetitorSnapshot[]
  unitSlug: string
  onSaved: () => void
}

export function CategoryMappingDialog({
  config,
  snapshots,
  unitSlug,
  onSaved,
}: CategoryMappingDialogProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [localMap, setLocalMap] = useState<CategoryMapEntry[]>(() =>
    (config?.competitor_category_map as CategoryMapEntry[] | undefined) ?? []
  )

  // Reset local map when dialog opens (picks up latest config)
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setLocalMap((config?.competitor_category_map as CategoryMapEntry[] | undefined) ?? [])
    }
    setOpen(next)
  }

  // Nomes de concorrentes ativos (presentes em config.competitor_urls)
  const activeCompetitorNames = useMemo(() => {
    const urls = (config?.competitor_urls as unknown as CompetitorUrl[] | undefined) ?? []
    return new Set(urls.map((c) => c.name))
  }, [config])

  // Normaliza para deduplicação: remove acentos + lowercase
  // "Suíte 50 Tons" e "Suite 50 Tons" → mesma chave "suite 50 tons"
  function normKey(s: string) {
    return s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  }

  // Categorias únicas por concorrente extraídas dos snapshots — apenas concorrentes ativos
  // Usa Map<normalizedKey, canonicalName> para deduplicar variações de acento/maiúsculas
  const competitorCategories = useMemo(() => {
    const map = new Map<string, Map<string, string>>() // competitorName → Map<normKey, displayName>
    for (const snap of snapshots) {
      if (!activeCompetitorNames.has(snap.competitor_name)) continue
      if (!snap.mapped_prices?.length) continue
      const cats = map.get(snap.competitor_name) ?? new Map<string, string>()
      for (const p of snap.mapped_prices as unknown as MappedPrice[]) {
        const cat = p.categoria_concorrente?.trim()
        if (!cat) continue
        const key = normKey(cat)
        // Prefere a forma com acento correto (ex: "Suíte") sobre a sem acento ("Suite")
        const existing = cats.get(key)
        if (!existing || cat.length > existing.length) cats.set(key, cat)
      }
      map.set(snap.competitor_name, cats)
    }
    // Converte para Map<competitorName, string[]> (lista de nomes canônicos ordenada)
    const result = new Map<string, string[]>()
    for (const [name, catMap] of map) {
      result.set(name, [...catMap.values()].sort())
    }
    return result
  }, [snapshots])

  // Nossas categorias — de suite_amenities ou fallback via mapped_prices.categoria_nossa
  const ourCategories = useMemo(() => {
    const keys = Object.keys(config?.suite_amenities ?? {})
    if (keys.length) return keys
    const cats = new Set<string>()
    for (const snap of snapshots) {
      for (const p of snap.mapped_prices as unknown as MappedPrice[]) {
        if (p.categoria_nossa) cats.add(p.categoria_nossa)
      }
    }
    return [...cats]
  }, [config, snapshots])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      await fetch('/api/admin/agent-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: config.unit_id, competitor_category_map: localMap }),
      })
    } finally {
      setSaving(false)
    }

    setRecomputing(true)
    try {
      await fetch('/api/admin/recompute-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitSlug }),
      })
    } finally {
      setRecomputing(false)
    }

    setOpen(false)
    onSaved()
  }

  const hasCompetitors = competitorCategories.size > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <GitMerge className="size-3.5" />
          Mapear suítes
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-base">Mapeamento de Suítes de Concorrentes</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Corrija os mapeamentos automáticos de categorias. O mapeamento manual tem prioridade sobre as heurísticas de nome, comodidades e preço.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {!hasCompetitors ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum snapshot disponível. Analise ao menos um concorrente primeiro.
            </p>
          ) : ourCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma categoria nossa encontrada. Configure as comodidades das suítes no painel de administração.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {[...competitorCategories.entries()].map(([competitorName, cats]) => (
                <div key={competitorName} className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold text-foreground border-b pb-1.5">{competitorName}</p>
                  {cats.map((competitorCat) => {
                    const entry = localMap.find(
                      (e) => e.competitor_name === competitorName && e.competitor_cat === competitorCat
                    )
                    const currentValue = entry?.nossa_cat ?? '__none__'
                    return (
                      <div key={competitorCat} className="flex items-center gap-3 py-1 border-b last:border-0">
                        <span className="flex-1 text-sm font-medium truncate">{competitorCat}</span>
                        <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                        <Select
                          value={currentValue}
                          onValueChange={(val) => {
                            setLocalMap((prev) => {
                              const filtered = prev.filter(
                                (e) => !(e.competitor_name === competitorName && e.competitor_cat === competitorCat)
                              )
                              if (val === '__none__') return filtered
                              return [...filtered, { competitor_name: competitorName, competitor_cat: competitorCat, nossa_cat: val }]
                            })
                          }}
                        >
                          <SelectTrigger className="w-[180px] h-8 text-sm shrink-0">
                            <SelectValue placeholder="Sem mapeamento" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem mapeamento</SelectItem>
                            {ourCategories.map((cat) => (
                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving || recomputing}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || recomputing || !hasCompetitors}
            className="gap-1.5"
          >
            {saving ? (
              <><Loader2 className="size-3.5 animate-spin" />Salvando...</>
            ) : recomputing ? (
              <><Loader2 className="size-3.5 animate-spin" />Reprocessando gaps...</>
            ) : (
              <><Save className="size-3.5" />Salvar e reprocessar</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
