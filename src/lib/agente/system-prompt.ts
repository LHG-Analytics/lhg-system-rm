import type {
  CompanyKPIResponse,
  BookingsKPIResponse,
} from '@/lib/lhg-analytics/types'

function fmt(n: number, style: 'currency' | 'percent' | 'number' = 'number') {
  if (style === 'currency')
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
  if (style === 'percent') return `${n.toFixed(1)}%`
  return new Intl.NumberFormat('pt-BR').format(Math.round(n))
}

function formatTime(hhmmss: string) {
  const parts = hhmmss?.split(':') ?? []
  return parts.length >= 2 ? `${parts[0]}h${parts[1]}m` : hhmmss
}

function buildKPIContext(
  unitName: string,
  period: { startDate: string; endDate: string },
  company: CompanyKPIResponse | null,
  bookings: BookingsKPIResponse | null
): string {
  if (!company) return `Dados de KPI indisponíveis para ${unitName}.`

  const r = company.TotalResult
  const bn = company.BigNumbers[0]
  const cur = bn?.currentDate
  const prev = bn?.previousDate

  const suiteRows = company.DataTableSuiteCategory.flatMap((item) =>
    Object.entries(item).map(([cat, kpi]) => ({
      cat,
      locacoes: kpi.totalRentalsApartments,
      faturamento: kpi.totalValue,
      ticket: kpi.totalTicketAverage,
      ocupacao: kpi.occupancyRate,
      giro: kpi.giro,
      tmo: kpi.averageOccupationTime,
    }))
  )

  const suiteSummary = suiteRows
    .map(
      (s) =>
        `  • ${s.cat}: ${fmt(s.locacoes)} locações | ` +
        `Faturamento ${fmt(s.faturamento, 'currency')} | ` +
        `Ticket ${fmt(s.ticket, 'currency')} | ` +
        `Ocupação ${fmt(s.ocupacao, 'percent')} | ` +
        `Giro ${s.giro.toFixed(2)} | TMO ${formatTime(s.tmo)}`
    )
    .join('\n')

  const bookingsSummary = bookings?.BigNumbers?.[0]
    ? (() => {
        const b = bookings.BigNumbers[0].currentDate
        return `\n### Reservas Online (período)\n` +
          `- Total reservas: ${fmt(b.totalAllBookings)}\n` +
          `- Faturamento reservas: ${fmt(b.totalAllValue, 'currency')}\n` +
          `- Ticket médio reservas: ${fmt(b.totalAllTicketAverage, 'currency')}\n` +
          `- Representatividade: ${b.totalAllRepresentativeness.toFixed(1)}%`
      })()
    : ''

  const vsAnterior = prev
    ? `\n### Comparativo vs período anterior\n` +
      `- Locações: ${fmt(cur.totalAllRentalsApartments)} vs ${fmt(prev.totalAllRentalsApartmentsPreviousData)} anterior\n` +
      `- Faturamento: ${fmt(cur.totalAllValue, 'currency')} vs ${fmt(prev.totalAllValuePreviousData, 'currency')} anterior\n` +
      `- Ticket médio: ${fmt(cur.totalAllTicketAverage, 'currency')} vs ${fmt(prev.totalAllTicketAveragePreviousData, 'currency')} anterior`
    : ''

  return `## KPIs — ${unitName}
Período: ${period.startDate} a ${period.endDate} (últimos 12 meses)

### Totais gerais
- Taxa de Ocupação: ${fmt(r.totalOccupancyRate, 'percent')}
- RevPAR: ${fmt(r.totalRevpar, 'currency')}
- TRevPAR: ${fmt(r.totalTrevpar, 'currency')}
- Ticket Médio: ${fmt(r.totalAllTicketAverage, 'currency')}
- Total Locações: ${fmt(r.totalAllRentalsApartments)}
- Faturamento Total: ${fmt(r.totalAllValue, 'currency')}
- Giro: ${r.totalGiro.toFixed(2)}
- TMO: ${formatTime(r.totalAverageOccupationTime)}
${vsAnterior}
${bookingsSummary}

### Desempenho por categoria de suíte
${suiteSummary}`
}

export function buildSystemPrompt(
  unitName: string,
  period: { startDate: string; endDate: string },
  company: CompanyKPIResponse | null,
  bookings: BookingsKPIResponse | null
): string {
  const kpiContext = buildKPIContext(unitName, period, company, bookings)

  return `Você é o Agente de Revenue Management da LHG Motéis, especialista em precificação e gestão de receita para o setor hoteleiro/moteleiro brasileiro.

## Sua função
Analisar os dados operacionais e de mercado para sugerir estratégias de precificação que maximizem o RevPAR e o TRevPAR da unidade, sempre respeitando limites definidos e apresentando propostas para aprovação humana.

## Regras obrigatórias
1. **Nunca decida sozinho** — você SEMPRE apresenta propostas. O gerente humano aprova ou rejeita.
2. Baseie suas análises nos dados reais fornecidos abaixo.
3. Quando sugerir preços, sempre informe: categoria de suíte, período (3h/6h/12h/pernoite), canal e justificativa.
4. Considere sazonalidade, dia da semana, feriados e eventos locais quando relevante.
5. Responda em português brasileiro.
6. Seja direto e objetivo — o gerente não tem tempo para textos longos.

## Conceitos do negócio
- **Giro:** número médio de locações por suíte por dia — quanto maior, mais eficiente o uso do espaço.
- **RevPAR:** receita por apartamento disponível — principal KPI de precificação.
- **TRevPAR:** receita total (hospedagem + A&B) por apartamento disponível.
- **TMO:** tempo médio de ocupação — influencia a estratégia de preço por período.
- **Períodos:** 3h, 6h, 12h, pernoite — cada um tem dinâmica de demanda distinta.

## Dados atuais da unidade

${kpiContext}

---
Use esses dados como base para suas análises e sugestões. Se o usuário pedir algo fora do escopo de Revenue Management, explique gentilmente que seu foco é precificação e receita.`
}
