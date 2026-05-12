'use client'

import { useState } from 'react'
import { FileText, Loader2, Printer } from 'lucide-react'
import type { WeeklyReportData } from '@/lib/reports/types'
import { ExecutiveSummary } from './sections/executive-summary'
import { EvolutionBanner } from './sections/evolution-banner'
import { BudgetTracking } from './sections/budget-tracking'
import { KpisSection } from './sections/kpis-section'
import { PricingSection } from './sections/pricing-section'
import { DiscountsSection } from './sections/discounts-section'
import { DemandSection } from './sections/demand-section'
import { CompetitorsSection } from './sections/competitors-section'
import { OutlookSection } from './sections/outlook-section'
import { IntelligenceSection } from './sections/intelligence-section'
import { AgentConfigSection } from './sections/agent-config-section'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface FullReport {
  id: string
  period_start: string
  period_end: string
  status: 'generating' | 'done' | 'failed'
  generated_at: string | null
  error_msg: string | null
  report_data: WeeklyReportData | null
  ai_summary: string | null
}

interface Props {
  report: FullReport | null
  loading: boolean
  onGenerateNow: () => void
  unitSlug: string
}

const STEPS = [
  'Coletando KPIs da semana…',
  'Analisando concorrentes…',
  'Calculando elasticidades…',
  'Verificando sazonalidade…',
  'Escrevendo resumo executivo…',
]

export function ReportViewer({ report, loading, onGenerateNow, unitSlug }: Props) {
  const [isPrinting, setIsPrinting] = useState(false)

  const handlePrint = async () => {
    setIsPrinting(true)

    const containers = Array.from(
      document.querySelectorAll<HTMLElement>('.recharts-responsive-container')
    )

    const snapshots: { section: HTMLElement; img: HTMLImageElement }[] = []

    for (const container of containers) {
      const svg = container.querySelector<SVGElement>('svg.recharts-surface')
      const section = container.closest<HTMLElement>('[data-pdf-height]')
      if (!svg || !section) continue

      try {
        const { width, height } = svg.getBoundingClientRect()
        if (!width || !height) continue

        const cloned = svg.cloneNode(true) as SVGElement
        cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        cloned.setAttribute('width', String(Math.round(width)))
        cloned.setAttribute('height', String(Math.round(height)))
        cloned.style.overflow = 'visible'

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bg.setAttribute('width', '100%')
        bg.setAttribute('height', '100%')
        bg.setAttribute('fill', '#18181b')
        cloned.insertBefore(bg, cloned.firstChild)

        // btoa base64 — mais confiável que encodeURIComponent para data URLs de SVG
        const svgStr = new XMLSerializer().serializeToString(cloned)
        const b64 = btoa(
          encodeURIComponent(svgStr).replace(/%([0-9A-F]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          )
        )
        const dataUrl = `data:image/svg+xml;base64,${b64}`

        const img = document.createElement('img')
        img.src = dataUrl
        img.style.cssText = 'width:100%;height:auto;display:block;margin:0'

        section.parentElement?.insertBefore(img, section)
        section.style.display = 'none'
        snapshots.push({ section, img })
      } catch {
        // falha silenciosa
      }
    }

    // Aguarda TODAS as imagens SVG renderizarem antes de abrir o diálogo de impressão.
    // Sem isso window.print() abre antes do browser decodificar os data URLs e os
    // gráficos aparecem em branco.
    await Promise.all(
      snapshots.map(({ img }) =>
        new Promise<void>(resolve => {
          if (img.complete) { resolve(); return }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        })
      )
    )

    setIsPrinting(false)

    const restore = () => {
      for (const { section, img } of snapshots) {
        section.style.display = ''
        img.remove()
      }
    }
    window.addEventListener('afterprint', restore, { once: true })
    window.print()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <FileText className="w-12 h-12 text-muted-foreground" />
        <div>
          <p className="font-medium mb-1">Nenhum relatório selecionado</p>
          <p className="text-sm text-muted-foreground mb-4">
            Próximo relatório gerado automaticamente toda segunda às 06h BRT.
          </p>
        </div>
        <Button onClick={onGenerateNow}>Gerar agora</Button>
      </div>
    )
  }

  if (report.status === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <div className="space-y-2 text-center">
          <p className="font-medium">Gerando relatório…</p>
          <div className="space-y-1">
            {STEPS.map((s, i) => (
              <p key={i} className="text-sm text-muted-foreground">{s}</p>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (report.status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <p className="font-medium text-destructive">Falha na geração</p>
        <p className="text-sm text-muted-foreground">{report.error_msg ?? 'Erro desconhecido'}</p>
      </div>
    )
  }

  const data = report.report_data
  if (!data) return null

  const periodLabel = `${format(new Date(report.period_start + 'T12:00:00Z'), "dd 'de' MMMM", { locale: ptBR })} – ${format(new Date(report.period_end + 'T12:00:00Z'), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}`

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-4 print:max-w-none print:px-0 print:py-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{data.period.unit}</h2>
          <p className="text-sm text-muted-foreground">{periodLabel}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0 print:hidden"
          onClick={handlePrint}
          disabled={isPrinting}
        >
          {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          {isPrinting ? 'Preparando…' : 'Exportar PDF'}
        </Button>
      </div>

      <ExecutiveSummary data={data.executiveSummary} aiSummary={report.ai_summary} />
      {data.evolution.hasPreviousReport && <EvolutionBanner data={data.evolution} />}
      <BudgetTracking data={data.budgetTracking} />
      <KpisSection data={data.kpis} />
      <PricingSection data={data.pricing} />
      <DiscountsSection data={data.discounts} />
      <DemandSection data={data.demand} />
      <CompetitorsSection data={data.competitors} />
      <OutlookSection data={data.outlook} />
      <IntelligenceSection data={data.intelligence} />
      <AgentConfigSection data={data.agentConfig} />
    </div>
  )
}
