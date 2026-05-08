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
    keyPoints: string[]
    mainWin: string
    mainConcern: string
    priorityAction: string
    tone: 'positive' | 'neutral' | 'warning'
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
    sameWeekLastYear: KPISnapshot | null
  }

  pricing: {
    activePriceTable: {
      id: string
      validFrom: string
      rows: { categoria: string; periodo: string; diaTipo: string; canal: string; preco: number }[]
    } | null
    proposalsApprovedThisWeek: {
      id: string
      approvedAt: string
      rowsCount: number
      avgVariacaoPct: number
    }[]
    lessonsCompleted: {
      categoria: string
      periodo: string
      diaTipo: string
      precoAnterior: number
      precoNovo: number
      variacaoPct: number
      deltaRevpar: number
      deltaGiro: number
      verdict: 'success' | 'neutral' | 'failure'
      checkpointDays: number
    }[]
    elasticityHighlights: {
      categoria: string
      periodo: string
      diaTipo: string
      elasticity: number
      confidence: 'high' | 'medium' | 'low'
      interpretation: string
    }[]
  }

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
