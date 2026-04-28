import type { CompanyKPIResponse } from '@/lib/kpis/types'

/**
 * KPI baseline capturado no momento da aprovação de uma proposta.
 * Usado pela revisão +7d/+14d/+28d para comparar antes/depois numa
 * janela igual e isolar contribuição da proposta de outros fatores.
 */
export interface ProposalKpiBaseline {
  snapshot_at: string         // ISO timestamp da captura
  window_days: number          // duração da janela analisada (default 28)
  start_date: string           // YYYY-MM-DD início da janela do baseline
  end_date: string             // YYYY-MM-DD fim da janela do baseline
  kpis: {
    total: {
      revpar: number
      trevpar: number
      giro: number
      ocupacao: number
      ticket: number
      total_rentals: number
      total_value: number
    }
    by_category: Array<{
      categoria: string
      revpar: number
      trevpar: number
      giro: number
      ocupacao: number
      ticket: number
      total_rentals: number
    }>
  }
  context: {
    weather_dominant_condition: string | null
    weather_avg_temp: number | null
    events_active: string[]
    active_table_id: string | null
  }
}

interface BaselineContext {
  windowDays?: number
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  weatherCondition?: string | null
  weatherAvgTemp?: number | null
  activeEvents?: string[]
  activeTableId?: string | null
}

/**
 * Constrói o baseline a partir de uma resposta de KPIs da Automo.
 * O caller é responsável por buscar os KPIs com janela apropriada
 * (default 28 dias antes da aprovação).
 */
export function buildProposalBaseline(
  company: CompanyKPIResponse,
  ctx: BaselineContext,
): ProposalKpiBaseline {
  const t = company.TotalResult

  const byCategory = (company.DataTableSuiteCategory ?? []).flatMap((item) =>
    Object.entries(item).map(([categoria, kpi]) => ({
      categoria,
      revpar: kpi.revpar,
      trevpar: kpi.trevpar,
      giro: kpi.giro,
      ocupacao: kpi.occupancyRate,
      ticket: kpi.totalTicketAverage,
      total_rentals: kpi.totalRentalsApartments,
    })),
  )

  return {
    snapshot_at: new Date().toISOString(),
    window_days: ctx.windowDays ?? 28,
    start_date: ctx.startDate,
    end_date: ctx.endDate,
    kpis: {
      total: {
        revpar: t.totalRevpar,
        trevpar: t.totalTrevpar,
        giro: t.totalGiro,
        ocupacao: t.totalOccupancyRate,
        ticket: t.totalAllTicketAverage,
        total_rentals: t.totalAllRentalsApartments,
        total_value: t.totalAllValue,
      },
      by_category: byCategory,
    },
    context: {
      weather_dominant_condition: ctx.weatherCondition ?? null,
      weather_avg_temp: ctx.weatherAvgTemp ?? null,
      events_active: ctx.activeEvents ?? [],
      active_table_id: ctx.activeTableId ?? null,
    },
  }
}

/**
 * Calcula janela default de 28 dias terminando no dia anterior à aprovação.
 * Retorna formato DD/MM/YYYY (esperado por fetchCompanyKPIsFromAutomo).
 */
export function defaultBaselineWindow(approvedAt: Date = new Date()): {
  startDDMMYYYY: string
  endDDMMYYYY: string
  startISO: string
  endISO: string
} {
  const end = new Date(approvedAt)
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 27) // 28 dias incluindo o end

  const fmtDDMM = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const fmtISO = (d: Date) => d.toISOString().slice(0, 10)

  return {
    startDDMMYYYY: fmtDDMM(start),
    endDDMMYYYY: fmtDDMM(end),
    startISO: fmtISO(start),
    endISO: fmtISO(end),
  }
}
