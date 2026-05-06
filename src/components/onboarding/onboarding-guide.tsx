'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, FileSpreadsheet, Bot, Building2, Globe, Users,
  TrendingUp, ThumbsUp, BarChart2, CheckCircle2, Circle, HelpCircle, Sparkles,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ─── Constantes ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lhg-onboarding-v1'

interface Step {
  id: string
  title: string
  description: string
  link: string
  linkLabel: string
  icon: React.ReactNode
}

const SETUP_STEPS: Step[] = [
  {
    id: 'import-prices',
    title: 'Importar tabela de preços',
    description: 'Faça upload do CSV com os preços atuais da unidade. O agente usa essa tabela como base para todas as propostas.',
    link: '/dashboard/precos',
    linkLabel: 'Ir para Preços',
    icon: <FileSpreadsheet className="size-4" />,
  },
  {
    id: 'configure-agent',
    title: 'Configurar o Agente RM',
    description: 'Defina estratégia (conservador/moderado/agressivo), guardrails de preço mínimo/máximo e capacidade das suítes.',
    link: '/dashboard/admin?tab=agente',
    linkLabel: 'Ir para Admin → Agente RM',
    icon: <Bot className="size-4" />,
  },
  {
    id: 'budget-sheet',
    title: 'Vincular planilha de orçamento',
    description: 'Conecte o Google Sheets com as metas mensais. O agente compara resultados reais vs meta em cada análise.',
    link: '/dashboard/admin?tab=agente&agente_tab=config',
    linkLabel: 'Configurar orçamento',
    icon: <TrendingUp className="size-4" />,
  },
  {
    id: 'competitors',
    title: 'Adicionar concorrentes',
    description: 'Cadastre as URLs dos concorrentes para análise automática de preços. Suporta Guia de Motéis, Cheerio e Playwright.',
    link: '/dashboard/concorrentes',
    linkLabel: 'Ir para Concorrentes',
    icon: <Globe className="size-4" />,
  },
  {
    id: 'invite-team',
    title: 'Convidar a equipe',
    description: 'Adicione gerentes e colaboradores que vão acompanhar o sistema. Cada usuário tem um perfil com permissões específicas.',
    link: '/dashboard/admin?tab=usuarios',
    linkLabel: 'Gerenciar usuários',
    icon: <Users className="size-4" />,
  },
]

const USAGE_STEPS: Step[] = [
  {
    id: 'monitor-dashboard',
    title: 'Monitorar KPIs no Dashboard',
    description: 'Acompanhe RevPAR, giro, ocupação e faturamento por período. O widget de anomalias alerta quedas automáticas.',
    link: '/dashboard',
    linkLabel: 'Abrir Dashboard',
    icon: <LayoutDashboard className="size-4" />,
  },
  {
    id: 'generate-proposal',
    title: 'Gerar proposta de preços',
    description: 'Acesse o Agente RM, peça diagnóstico completo e salve a proposta para revisão.',
    link: '/dashboard/agente',
    linkLabel: 'Abrir Agente RM',
    icon: <Bot className="size-4" />,
  },
  {
    id: 'approve-proposal',
    title: 'Aprovar a primeira proposta',
    description: 'Na aba Propostas do Agente RM, revise os ajustes sugeridos e aprove a proposta. O agente explica cada decisão.',
    link: '/dashboard/agente',
    linkLabel: 'Ver Propostas',
    icon: <ThumbsUp className="size-4" />,
  },
  {
    id: 'agent-performance',
    title: 'Acompanhar performance do agente',
    description: 'Na aba Performance do Agente RM, veja o impacto das propostas aprovadas nos KPIs após 7, 14 e 28 dias.',
    link: '/dashboard/agente',
    linkLabel: 'Ver Performance',
    icon: <BarChart2 className="size-4" />,
  },
  {
    id: 'analyze-competitors',
    title: 'Analisar concorrentes periodicamente',
    description: 'Rode análise de concorrentes semanalmente para comparar preços e identificar gaps. O agente injeta os dados nas propostas.',
    link: '/dashboard/concorrentes',
    linkLabel: 'Analisar concorrentes',
    icon: <Building2 className="size-4" />,
  },
]

// ─── Helpers de localStorage ──────────────────────────────────────────────────

function loadState(): { dismissed: boolean; done: string[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { dismissed: false, done: [] }
  } catch {
    return { dismissed: false, done: [] }
  }
}

function saveState(state: { dismissed: boolean; done: string[] }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* noop */ }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  userRole: string
  unitSlug: string
}

export function OnboardingGuide({ userRole, unitSlug }: Props) {
  const router = useRouter()
  const isAdmin = userRole === 'super_admin' || userRole === 'admin'

  const [open, setOpen]           = useState(false)
  const [done, setDone]           = useState<string[]>([])
  const [autoCompleted, setAutoCompleted] = useState<string[]>([])
  const [mounted, setMounted]     = useState(false)

  const fetchAutoStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/onboarding/status?unitSlug=${unitSlug}`)
      if (!res.ok) return
      const data = await res.json()
      setAutoCompleted(data.completedSteps ?? [])
    } catch { /* noop */ }
  }, [unitSlug])

  useEffect(() => {
    setMounted(true)
    if (!isAdmin) return
    const state = loadState()
    setDone(state.done)
    if (!state.dismissed) {
      const t = setTimeout(() => setOpen(true), 800)
      return () => clearTimeout(t)
    }
  }, [isAdmin])

  // Busca status automático toda vez que o diálogo abre
  useEffect(() => {
    if (open && isAdmin) fetchAutoStatus()
  }, [open, isAdmin, fetchAutoStatus])

  if (!isAdmin || !mounted) return null

  const isDone = (id: string) => done.includes(id) || autoCompleted.includes(id)
  const isAuto = (id: string) => autoCompleted.includes(id)

  const totalSetup  = SETUP_STEPS.length
  const doneSetup   = SETUP_STEPS.filter((s) => isDone(s.id)).length
  const allSetupDone = doneSetup === totalSetup

  function toggleStep(id: string) {
    if (isAuto(id)) return // bloqueado: detectado automaticamente
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id]
    setDone(next)
    saveState({ ...loadState(), done: next })
  }

  function handleDismiss() {
    saveState({ dismissed: true, done })
    setOpen(false)
  }

  function handleNavigate(link: string) {
    setOpen(false)
    router.push(link)
  }

  return (
    <>
      {/* ── Trigger: botão "?" no header ─────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Guia de início rápido"
      >
        <HelpCircle className="size-4" />
      </button>

      {/* ── Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-xl max-h-[80vh] flex flex-col p-0 gap-0"
          style={{ overflow: 'visible' }}
        >
          {/* ── Balão do agente — à esquerda do diálogo (só em telas largas) ── */}
          <div
            className="absolute right-full top-6 pr-3 pointer-events-none hidden lg:flex gap-2.5 items-start"
            style={{ width: '230px' }}
          >
            <div className="shrink-0 flex size-8 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20 mt-1">
              <Sparkles className="size-3.5 text-primary" />
            </div>
            <div className="flex-1 relative bg-card border rounded-2xl rounded-tr-sm px-3 py-2.5 text-[12.5px] leading-relaxed shadow-md">
              Veja os <span className="font-medium">passos essenciais</span> para configurar e usar o sistema. Marque conforme você avança. 🚀
              {/* Seta apontando para a direita (→ diálogo) */}
              <span className="absolute top-[10px] -right-[9px] block w-0 h-0 border-t-[8px] border-b-[8px] border-l-[9px] border-t-transparent border-b-transparent border-l-border" />
              <span className="absolute top-[10px] -right-[8px] block w-0 h-0 border-t-[8px] border-b-[8px] border-l-[9px] border-t-transparent border-b-transparent border-l-card" />
            </div>
          </div>

          {/* ── Header ──────────────────────────────────────────────── */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="text-base font-semibold">
              Guia de início rápido
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allSetupDone
                ? '✅ Configuração inicial completa! Siga a rotina de uso.'
                : `Configuração inicial: ${doneSetup}/${totalSetup} etapas concluídas`}
            </p>

            {/* Barra de progresso da configuração inicial */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(doneSetup / totalSetup) * 100}%` }}
              />
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* ── Configuração inicial ──────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                1. Configuração inicial (fazer uma vez)
              </h3>
              <div className="space-y-2">
                {SETUP_STEPS.map((step, i) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={i + 1}
                    isDone={isDone(step.id)}
                    isAuto={isAuto(step.id)}
                    onToggle={() => toggleStep(step.id)}
                    onNavigate={() => handleNavigate(step.link)}
                  />
                ))}
              </div>
            </section>

            {/* ── Rotina de uso ─────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                2. Rotina de uso (recorrente)
              </h3>
              <div className="space-y-2">
                {USAGE_STEPS.map((step, i) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={i + 1}
                    isDone={isDone(step.id)}
                    isAuto={isAuto(step.id)}
                    onToggle={() => toggleStep(step.id)}
                    onNavigate={() => handleNavigate(step.link)}
                  />
                ))}
              </div>
            </section>
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t shrink-0">
            <button
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Não mostrar novamente
            </button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── StepRow ─────────────────────────────────────────────────────────────────

function StepRow({ step, index, isDone, isAuto, onToggle, onNavigate }: {
  step: Step
  index: number
  isDone: boolean
  isAuto: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border p-3 transition-colors',
      isDone ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-card hover:bg-accent/30',
    )}>
      {/* Checkbox */}
      <button
        onClick={onToggle}
        disabled={isAuto}
        className={cn('shrink-0 mt-0.5', isAuto ? 'cursor-default' : 'cursor-pointer')}
        title={
          isAuto
            ? 'Concluído automaticamente pelo sistema'
            : isDone ? 'Marcar como pendente' : 'Marcar como concluído'
        }
      >
        {isDone
          ? <CheckCircle2 className={cn('size-4.5', isAuto ? 'text-primary' : 'text-emerald-500')} />
          : <Circle className="size-4.5 text-muted-foreground/40" />}
      </button>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground/60 tabular-nums">
            {String(index).padStart(2, '0')}
          </span>
          <span className={cn(
            'text-xs font-medium',
            isDone ? 'line-through text-muted-foreground' : 'text-foreground',
          )}>
            {step.title}
          </span>
          {isAuto && (
            <span className="text-[9px] font-medium text-primary/80 bg-primary/10 rounded px-1 py-px">
              automático
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {step.description}
        </p>
      </div>

      {/* Botão de navegação */}
      <button
        onClick={onNavigate}
        className="shrink-0 text-[10px] font-medium text-primary hover:underline whitespace-nowrap mt-0.5"
      >
        {step.linkLabel} →
      </button>
    </div>
  )
}
