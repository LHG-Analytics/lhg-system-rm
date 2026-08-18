export interface KPISnapshot {
  revpar: number
  trevpar: number
  giro: number
  ocupacao: number
  ticket: number
  receita: number
  locacoes: number
  tmo: number
}

export interface WeeklyReportData {
  period: {
    start: string
    end: string
    unit: string
    unitSlug: string
    generatedAt: string
  }

  executiveSummary: {
    headline: string
    /** Leitura interpretativa (3-5 frases) — o que aconteceu e por quê, como um especialista de RM explicaria pro dono do negócio. Opcional só por compat com relatórios salvos antes desse campo existir. */
    diagnosis?: string
    keyPoints: string[]
    priorityAction: string
    /** O que observar/monitorar na próxima semana. Opcional por compat com relatórios antigos. */
    watchNextWeek?: string
    tone: 'positive' | 'neutral' | 'warning'
    /** Tipo de ação prioritária para gerar o link correto */
    actionType: 'price_proposal' | 'discount_proposal' | 'agent_config' | 'none'
    /** Link /dashboard/agente?unit=X&q=PROMPT — auto-envia o prompt ao clicar */
    agentPromptLink?: string
    /** Sugestão de mudança na configuração do agente (ex: estratégia, foco) */
    agentConfigSuggestion?: string
  }

  evolution: {
    hasPreviousReport: boolean
    previousPeriodStart: string | null
    kpiDeltas: {
      revpar: number
      giro: number
      ocupacao: number
      ticket: number
      receita: number
      tmo: number
    }
    guiaShareDelta: number
    metaGapDelta: number
    lessonsVerdict: { acertos: number; neutros: number; falhas: number }
    anomaliesNewCount: number
    anomaliesResolvedCount: number
  }

  budgetTracking: {
    monthName: string
    monthDaysTotal: number
    monthDaysElapsed: number
    realizado: number
    projecao: number
    meta: number
    paceDiarioNecessario: number
    paceDiarioAtual: number
    aiLeverageComment: string
  }

  kpis: {
    current: KPISnapshot
    previousWeek: KPISnapshot | null
    previousMonth: KPISnapshot | null
    sameWeekLastYear: KPISnapshot | null
  }

  /** Oportunidades detectadas por categoria × período/turno/dia da semana — o "plano de ação" do relatório. */
  opportunities: {
    dimension: 'periodo' | 'turno' | 'dia_semana'
    categoria: string
    label: string
    metric: 'giro' | 'revpar'
    value: number
    benchmarkValue: number
    gapPct: number
    direction: 'below' | 'above'
    suggestion: string
    agentPromptLink: string
  }[]

  discounts: {
    activeDiscounts: {
      categoria: string
      periodo: string
      diaSemana: string
      faixaHoraria: string
      tipoDesconto: string
      valor: number
    }[]
    guiaSharePct: number
    guiaSharePrevWeek: number
    discountProposalsApprovedThisWeek: number
    topDiscountImpact: string
  }

  demand: {
    channelMix: { canal: string; label: string; reservas: number; receita: number; representatividade: number }[]
    periodMix: { periodo: string; locacoes: number; receita: number; ticket: number; pct: number }[]
    peakDow: string
    peakHourRange: string
    valleyDow: string
    /** Giro e receita por categoria de suíte × turno (Pico/Fora de pico ou Diurno/Noturno).
     *  Opcional — relatórios gerados antes desse campo existir não o têm no JSONB salvo. */
    turnoCategoryTable?: { categoria: string; turno: string; locacoes: number; giro: number; receita: number; capacidade: number }[]
  }

  competitors: {
    gaps: {
      categoria: string
      periodo: string
      diaTipo: string
      precoNosso: number
      medianaConc: number
      gapPct: number
      position: 'underprice' | 'aligned' | 'overprice'
      categoriaConc?: string
      competitorName?: string
      /** Comodidades que temos e o concorrente não tem (vantagem qualitativa) */
      amenityAdvantage?: string[]
      /** Período real do concorrente quando houve match aproximado (ex: "2h" para nosso "3h") */
      competitorPeriodo?: string
      /** TRUE quando o período foi aproximado para casar com o nosso */
      periodoAproximado?: boolean
    }[]
    changesDetectedCount: number
    changesDirection: 'up' | 'down' | 'mixed' | 'none'
    dominantPosition: 'underprice' | 'aligned' | 'overprice'
  }

  outlook: {
    seasonalFactors: {
      date: string
      dowLabel: string
      factorRevpar: number
      factorGiro: number
      level: 'hot' | 'normal' | 'cold'
    }[]
    upcomingEvents: {
      title: string
      eventDate: string
      eventType: string
      impactDescription: string
    }[]
    revenueForecast: {
      month: string
      projected: number
      budgeted: number
      gapPct: number
    }[]
  }

  intelligence: {
    anomaliesDetected: { metric: string; direction: string; zScore: number; scope: string }[]
    anomaliesResolved: { metric: string; resolvedAt: string }[]
    newLessonsCount: number
    elasticityUpdatedCount: number
    seasonalityRecomputed: boolean
    weekHighlight: string
    historicalInsights?: {
      fromDate: string
      toDate: string
      changesCount: number
      avgChangePct: number
      kpiBefore: { revpar: number; giro: number } | null
      kpiAfter: { revpar: number; giro: number } | null
      deltaRevpar: number | null
      deltaGiro: number | null
      verdict: 'success' | 'neutral' | 'failure' | 'unknown'
      topChanges: {
        categoria: string
        periodo: string
        diaTipo: string
        canal: string
        precoAnterior: number
        precoNovo: number
        variacaoPct: number
      }[]
    }[]
  }

  agentConfig: {
    pricingStrategy: string
    focusMetric: string
    maxVariationPct: number
    guardrailsCount: number
    sharedContext: string | null
    suiteCapacity: {
      categoria: string
      total: number
      bloqueadas: number
      disponiveis: number
      motivosBloqueio: string[]
    }[]
  }
}

export interface ReportMetadata {
  id: string
  period_start: string
  period_end: string
  status: 'generating' | 'done' | 'failed'
  generated_at: string | null
  error_msg: string | null
}
