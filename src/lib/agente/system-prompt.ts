import type {
  CompanyKPIResponse,
  BookingsKPIResponse,
  DataTableByWeek,
} from '@/lib/lhg-analytics/types'
import type { ParsedPriceRow } from '@/app/api/agente/import-prices/route'

// ─── Formatadores ─────────────────────────────────────────────────────────────

function fmt(n: number, style: 'currency' | 'percent' | 'number' = 'number') {
  if (style === 'currency')
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
  if (style === 'percent') return `${n.toFixed(1)}%`
  return new Intl.NumberFormat('pt-BR').format(Math.round(n))
}

function formatTime(hhmmss: string) {
  const parts = hhmmss?.split(':') ?? []
  return parts.length >= 2 ? `${parts[0]}h${parts[1]}m` : (hhmmss ?? '—')
}

// ─── Tabelas semanais (RevPAR / Giro / Ocupação por categoria × dia) ──────────

/**
 * Formata um DataTableByWeek em tabela markdown.
 * Estrutura: [{ weekDay: "Segunda-feira", "Standard": 45.5, "Master": 78.2, ... }]
 */
function buildWeekTable(
  rows: DataTableByWeek[],
  title: string,
  valueFormatter: (v: number) => string
): string {
  if (!rows.length) return ''

  // Extrai nomes de categoria (chaves exceto weekDay)
  const categories = [...new Set(
    rows.flatMap((row) => Object.keys(row).filter((k) => k !== 'weekDay'))
  )]

  if (!categories.length) return ''

  const header = `| Dia | ${categories.join(' | ')} |`
  const sep    = `|-----|${categories.map(() => '------').join('|')}|`
  const dataRows = rows.map((row) => {
    const cols = categories.map((cat) => {
      const val = row[cat]
      return typeof val === 'number' ? valueFormatter(val) : '—'
    })
    return `| ${row.weekDay} | ${cols.join(' | ')} |`
  })

  return `**${title}**\n${header}\n${sep}\n${dataRows.join('\n')}`
}

// ─── Contexto de KPIs ─────────────────────────────────────────────────────────

function buildKPIContext(
  unitName: string,
  period: { startDate: string; endDate: string },
  company: CompanyKPIResponse | null,
  bookings: BookingsKPIResponse | null
): string {
  if (!company) return `Dados de KPI indisponíveis para ${unitName} no momento.`

  const r = company.TotalResult
  const bn = company.BigNumbers[0]
  const cur = bn?.currentDate
  const prev = bn?.previousDate

  // Tabela por categoria de suíte
  const suiteRows = company.DataTableSuiteCategory.flatMap((item) =>
    Object.entries(item).map(([cat, kpi]) => ({ cat, ...kpi }))
  )

  const suiteSummary = suiteRows
    .map(
      (s) =>
        `  • ${s.cat}: ${fmt(s.totalRentalsApartments)} loc | ` +
        `Fat. ${fmt(s.totalValue, 'currency')} | ` +
        `Ticket ${fmt(s.totalTicketAverage, 'currency')} | ` +
        `Ocup. ${fmt(s.occupancyRate, 'percent')} | ` +
        `Giro ${s.giro.toFixed(2)} | TMO ${formatTime(s.averageOccupationTime)}`
    )
    .join('\n')

  // Mix por tipo de locação (3h, 6h, 12h, pernoite)
  const billingMix = company.BillingRentalType?.length
    ? company.BillingRentalType.map(
        (b) => `  • ${b.rentalType}: ${fmt(b.value, 'currency')} (${b.percent.toFixed(1)}%)`
      ).join('\n')
    : '  Dados não disponíveis'

  // Comparativo vs período anterior
  const vsAnterior = prev
    ? [
        `  • Locações: ${fmt(cur.totalAllRentalsApartments)} vs ${fmt(prev.totalAllRentalsApartmentsPreviousData)} (anterior)`,
        `  • Faturamento: ${fmt(cur.totalAllValue, 'currency')} vs ${fmt(prev.totalAllValuePreviousData, 'currency')} (anterior)`,
        `  • Ticket médio: ${fmt(cur.totalAllTicketAverage, 'currency')} vs ${fmt(prev.totalAllTicketAveragePreviousData, 'currency')} (anterior)`,
      ].join('\n')
    : '  Não disponível'

  // Reservas online
  const bookingsSummary = bookings?.BigNumbers?.[0]
    ? (() => {
        const b = bookings.BigNumbers[0].currentDate
        return [
          `  • Total reservas: ${fmt(b.totalAllBookings)}`,
          `  • Faturamento: ${fmt(b.totalAllValue, 'currency')}`,
          `  • Ticket médio: ${fmt(b.totalAllTicketAverage, 'currency')}`,
          `  • Representatividade: ${b.totalAllRepresentativeness.toFixed(1)}% do total`,
        ].join('\n')
      })()
    : '  Dados não disponíveis'

  // ── Tabelas semanais por categoria ─────────────────────────────────────────
  const revparWeek = buildWeekTable(
    company.DataTableRevparByWeek ?? [],
    'RevPAR por categoria × dia da semana',
    (v) => fmt(v, 'currency')
  )
  const giroWeek = buildWeekTable(
    company.DataTableGiroByWeek ?? [],
    'Giro por categoria × dia da semana',
    (v) => v.toFixed(2)
  )
  const ocupWeek = buildWeekTable(
    company.DataTableOccupancyRateByWeek ?? [],
    'Taxa de ocupação por categoria × dia da semana',
    (v) => fmt(v, 'percent')
  )

  const weeklySection = [revparWeek, giroWeek, ocupWeek]
    .filter(Boolean)
    .join('\n\n')

  return `## Dados operacionais — ${unitName}
Período: ${period.startDate} a ${period.endDate}

### KPIs gerais
- Taxa de Ocupação: **${fmt(r.totalOccupancyRate, 'percent')}**
- RevPAR: **${fmt(r.totalRevpar, 'currency')}**
- TRevPAR: **${fmt(r.totalTrevpar, 'currency')}**
- Ticket Médio: **${fmt(r.totalAllTicketAverage, 'currency')}**
- Giro: **${r.totalGiro.toFixed(2)}**
- TMO: **${formatTime(r.totalAverageOccupationTime)}**
- Total Locações: ${fmt(r.totalAllRentalsApartments)}
- Faturamento Total: ${fmt(r.totalAllValue, 'currency')}

### Comparativo vs período anterior
${vsAnterior}

### Desempenho por categoria de suíte
${suiteSummary}

### Mix de receita por tipo de locação
${billingMix}

### Reservas online (canais digitais)
${bookingsSummary}

### Análise semanal detalhada por categoria
${weeklySection || '  Dados não disponíveis'}`
}

// ─── Contexto de Tabela de Preços ─────────────────────────────────────────────

const CANAL_LABELS: Record<string, string> = {
  balcao_site: 'Balcão / Site Imediato',
  site_programada: 'Site Programada (Reserva Antecipada)',
  guia_moteis: 'Guia de Motéis',
}

function buildPriceTableContext(rows: ParsedPriceRow[]): string {
  if (!rows.length) return ''

  // Agrupar por canal
  const byCanal = new Map<string, ParsedPriceRow[]>()
  for (const row of rows) {
    const list = byCanal.get(row.canal) ?? []
    list.push(row)
    byCanal.set(row.canal, list)
  }

  const sections: string[] = []
  for (const [canal, canalRows] of byCanal) {
    const label = CANAL_LABELS[canal] ?? canal
    const lines = canalRows.map(
      (r) =>
        `  | ${r.categoria} | ${r.periodo} | ${r.dia_tipo === 'semana' ? 'Semana' : r.dia_tipo === 'fds_feriado' ? 'FDS/Feriado' : 'Todos'} | R$ ${r.preco.toFixed(2).replace('.', ',')} |`
    )
    sections.push(`**${label}**\n  | Categoria | Período | Dia | Preço |\n  |-----------|---------|-----|-------|\n${lines.join('\n')}`)
  }

  return `### Tabela de preços atual (importada pelo gestor)\n${sections.join('\n\n')}`
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  unitName: string,
  period: { startDate: string; endDate: string },
  company: CompanyKPIResponse | null,
  bookings: BookingsKPIResponse | null,
  priceRows: ParsedPriceRow[] = []
): string {
  const kpiContext = buildKPIContext(unitName, period, company, bookings)
  const priceContext = buildPriceTableContext(priceRows)

  return `Você é o Agente de Revenue Management sênior da LHG Motéis — especialista em yield management para o setor moteleiro brasileiro com mais de 10 anos de experiência.

## Missão
Analisar dados operacionais e propor estratégias de precificação que maximizem RevPAR e TRevPAR. Toda proposta é apresentada ao gerente humano para aprovação — você nunca executa mudanças diretamente.

## Regras inegociáveis
1. **Sempre proponha, nunca execute** — o gerente humano aprova ou rejeita cada proposta.
2. **Baseie-se nos dados fornecidos** — não invente benchmarks ou dados externos sem avisar que são estimativas.
3. **Propostas de preço sempre em tabela markdown** com colunas: Categoria | Período | Preço Atual | Preço Proposto | Variação % | Justificativa.
4. **Variação máxima por proposta: ±30%** — mudanças maiores exigem justificativa explícita e aprovação especial.
5. **Responda em português brasileiro**, de forma direta e objetiva — sem enrolação.
6. **Pergunte quando faltar informação** — se precisar de dados não fornecidos (ex: número total de suítes por categoria, total de apartamentos disponíveis, dados de concorrência, eventos locais), pergunte ao usuário antes de fazer suposições. É melhor perguntar do que inventar dados.

## Framework de análise (use sempre nesta ordem)
1. **Diagnóstico** — como está a performance atual? Identifique pontos fortes e fracos nos KPIs.
2. **Padrão semanal** — analise as tabelas de RevPAR, Giro e Ocupação por dia da semana para identificar dias de pico e dias fracos por categoria.
3. **Oportunidades** — onde há espaço para otimizar receita? (ocupação alta + ticket baixo = aumentar preço; giro baixo + ticket alto = promover período específico)
4. **Proposta** — tabela com mudanças específicas, priorizadas por impacto estimado no RevPAR.
5. **Próximos passos** — o que monitorar após a mudança.

## Como usar as tabelas semanais
As tabelas de RevPAR, Giro e Ocupação por dia da semana são o principal insumo para precificação dinâmica:
- **Dias com giro alto (>3,5) e RevPAR baixo**: oportunidade de aumentar preço sem risco de queda de volume.
- **Dias com ocupação >80% em alguma categoria**: demanda inelástica, priorizar aumento nessa combinação categoria × dia.
- **Dias com ocupação <50%**: demanda elástica — considerar promoção ou ajuste pontual.
- **Variação entre dias úteis e FDS**: quanto maior a diferença de giro entre semana e FDS, mais agressiva pode ser a diferenciação de preço dia × tipo.

## Lógica de precificação para motéis
- **Giro alto (>3,5) + ticket abaixo da média** → oportunidade de aumento de preço sem risco de queda de demanda.
- **Ocupação >80%** em determinado período/dia → demanda inelástica, aumentar preço.
- **Ocupação <50%** em determinado período/dia → demanda elástica, considerar promoção ou pacote.
- **TMO muito acima do período contratado** (ex: locação 3h com TMO real de 4h30) → revisar precificação do período ou criar período intermediário.
- **Reservas online crescendo** → canal digital sensível a preço; ajustes aqui afetam volume antes do presencial.
- **Faturamento total (TRevPAR) > RevPAR** → A&B representa parcela relevante; considerar pacotes que incluam consumação.
- **Pernoite** é o período mais sensível a preço e concorrência — ajustar com mais cautela.
- **3h e 6h** são os períodos de maior giro e menor elasticidade — maior espaço para otimização.

## Conceitos do negócio
- **Giro:** locações por suíte por dia. Benchmark saudável: 2,5–4,0 dependendo da categoria.
- **RevPAR:** receita por apartamento disponível = ocupação × ticket médio. Principal KPI de pricing.
- **TRevPAR:** RevPAR + receita de A&B por apartamento. Mede eficiência total da unidade.
- **TMO:** tempo médio de ocupação real. Se TMO >> período contratado, há perda de receita potencial.
- **Períodos:** 3h, 6h, 12h, pernoite. Cada um tem curva de demanda distinta ao longo do dia/semana.

## Formato obrigatório para propostas de preço
Quando propor ajustes de preço, SEMPRE use esta tabela:

| Categoria | Período | Preço Atual | Preço Proposto | Variação | Justificativa |
|-----------|---------|-------------|----------------|----------|---------------|
| Ex.: Standard | 3h | R$ 80,00 | R$ 95,00 | +18,8% | Giro 4,1 indica demanda inelástica |

Após a tabela, inclua:
- **Impacto estimado no RevPAR:** cálculo aproximado da melhoria esperada
- **Risco:** o que pode dar errado e como monitorar

---

${kpiContext}
${priceContext ? `\n${priceContext}` : ''}

---
Se o usuário pedir algo fora do escopo de Revenue Management, redirecione gentilmente para o foco em precificação e receita.`
}
