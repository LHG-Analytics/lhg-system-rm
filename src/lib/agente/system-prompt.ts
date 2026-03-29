import type {
  CompanyKPIResponse,
  BookingsKPIResponse,
  DataTableGiroByWeek,
  DataTableRevparByWeek,
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

// ─── Tabelas semanais (RevPAR / Giro por categoria × dia) ────────────────────
// Estrutura real da API: Array<{ [categoria]: { [dia]: { giro, totalGiro } } }>

const DAY_ORDER_PT = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
const DAY_ABBR: Record<string, string> = {
  'segunda-feira': 'Seg', 'terça-feira': 'Ter', 'quarta-feira': 'Qua',
  'quinta-feira':  'Qui', 'sexta-feira':  'Sex', 'sábado':       'Sáb', 'domingo': 'Dom',
}

function buildGiroWeekTable(data: DataTableGiroByWeek[]): string {
  if (!data?.length) return ''
  const rows = data.map((item) => { const [cat, days] = Object.entries(item)[0]; return { cat, days } })
  const dayCols = DAY_ORDER_PT.filter((d) => d in rows[0].days)
  const header = `| Categoria | ${dayCols.map((d) => DAY_ABBR[d]).join(' | ')} |`
  const sep    = `|-----------|${dayCols.map(() => '------').join('|')}|`
  const dataRows = rows.map(({ cat, days }) =>
    `| ${cat} | ${dayCols.map((d) => days[d]?.giro.toFixed(2) ?? '—').join(' | ')} |`
  )
  // Total vem do totalGiro de qualquer entrada
  const totals = dayCols.map((d) => rows.find((r) => r.days[d])?.days[d]?.totalGiro.toFixed(2) ?? '—')
  const totalRow = `| **Total** | ${totals.join(' | ')} |`
  return `**Giro por categoria × dia da semana**\n${header}\n${sep}\n${dataRows.join('\n')}\n${totalRow}`
}

function buildRevparWeekTable(data: DataTableRevparByWeek[]): string {
  if (!data?.length) return ''
  const rows = data.map((item) => { const [cat, days] = Object.entries(item)[0]; return { cat, days } })
  const dayCols = DAY_ORDER_PT.filter((d) => d in rows[0].days)
  const fmtCur = (v: number) => fmt(v, 'currency')
  const header = `| Categoria | ${dayCols.map((d) => DAY_ABBR[d]).join(' | ')} |`
  const sep    = `|-----------|${dayCols.map(() => '------').join('|')}|`
  const dataRows = rows.map(({ cat, days }) =>
    `| ${cat} | ${dayCols.map((d) => days[d] ? fmtCur(days[d].revpar) : '—').join(' | ')} |`
  )
  const totals = dayCols.map((d) => { const v = rows.find((r) => r.days[d])?.days[d]?.totalRevpar; return v !== undefined ? fmtCur(v) : '—' })
  const totalRow = `| **Total** | ${totals.join(' | ')} |`
  return `**RevPAR por categoria × dia da semana**\n${header}\n${sep}\n${dataRows.join('\n')}\n${totalRow}`
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

  // BigNumbers — comparativo três colunas: período atual | mesmo período ano passado | previsão mês
  const forecast = bn?.monthlyForecast
  function delta(a: number, b: number) {
    if (!b) return ''
    const pct = ((a - b) / b) * 100
    return ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`
  }

  const bigNumbers = cur && prev
    ? `| Métrica | Período atual | Mesmo período ano anterior | Δ a/a | Previsão fechamento do mês |
|---------|--------------|---------------------------|-------|---------------------------|
| Faturamento | ${fmt(cur.totalAllValue, 'currency')} | ${fmt(prev.totalAllValuePreviousData, 'currency')} | ${delta(cur.totalAllValue, prev.totalAllValuePreviousData)} | ${forecast ? fmt(forecast.totalAllValueForecast, 'currency') : '—'} |
| Locações | ${fmt(cur.totalAllRentalsApartments)} | ${fmt(prev.totalAllRentalsApartmentsPreviousData)} | ${delta(cur.totalAllRentalsApartments, prev.totalAllRentalsApartmentsPreviousData)} | ${forecast ? fmt(forecast.totalAllRentalsApartmentsForecast) : '—'} |
| Ticket Médio | ${fmt(cur.totalAllTicketAverage, 'currency')} | ${fmt(prev.totalAllTicketAveragePreviousData, 'currency')} | ${delta(cur.totalAllTicketAverage, prev.totalAllTicketAveragePreviousData)} | ${forecast ? fmt(forecast.totalAllTicketAverageForecast, 'currency') : '—'} |
| TRevPAR | ${fmt(cur.totalAllTrevpar, 'currency')} | ${fmt(prev.totalAllTrevparPreviousData, 'currency')} | ${delta(cur.totalAllTrevpar, prev.totalAllTrevparPreviousData)} | ${forecast ? fmt(forecast.totalAllTrevparForecast, 'currency') : '—'} |
| Giro | ${cur.totalAllGiro.toFixed(2)} | ${prev.totalAllGiroPreviousData.toFixed(2)} | ${delta(cur.totalAllGiro, prev.totalAllGiroPreviousData)} | ${forecast ? forecast.totalAllGiroForecast.toFixed(2) : '—'} |
| TMO | ${formatTime(cur.totalAverageOccupationTime)} | ${formatTime(prev.totalAverageOccupationTimePreviousData)} | — | ${forecast ? formatTime(forecast.totalAverageOccupationTimeForecast) : '—'} |`
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
  const revparWeek = buildRevparWeekTable(company.DataTableRevparByWeek ?? [])
  const giroWeek   = buildGiroWeekTable(company.DataTableGiroByWeek ?? [])

  const weeklySection = [revparWeek, giroWeek]
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

### Comparativo: período atual × ano anterior × previsão de fechamento do mês
${bigNumbers}

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

export interface PriceImportForPrompt {
  rows: ParsedPriceRow[]
  valid_from: string
  valid_until: string | null
}

export interface KPIPeriod {
  /** Label exibido no system prompt — ex: "Período A — Tabela anterior" */
  label?: string
  period: { startDate: string; endDate: string }
  company: CompanyKPIResponse | null
  bookings: BookingsKPIResponse | null
}

function buildSinglePriceTable(rows: ParsedPriceRow[], validFrom: string, validUntil: string | null): string {
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

  const vigencia = `${validFrom}${validUntil ? ` → ${validUntil}` : ' → atualmente'}`
  return `#### Tabela vigente ${vigencia}\n${sections.join('\n\n')}`
}

function buildPriceTablesContext(imports: PriceImportForPrompt[]): string {
  const valid = imports.filter((i) => i.rows.length > 0)
  if (!valid.length) return ''

  if (valid.length === 1) {
    const imp = valid[0]
    const vigencia = `${imp.valid_from}${imp.valid_until ? ` → ${imp.valid_until}` : ' → atualmente'}`
    return `### Tabela de preços (${vigencia})\n${buildSinglePriceTable(imp.rows, imp.valid_from, imp.valid_until).replace(/^####.*\n/, '')}`
  }

  // Múltiplas tabelas — renderizar todas para comparação
  const blocks = valid.map((imp) => buildSinglePriceTable(imp.rows, imp.valid_from, imp.valid_until))
  return `### Histórico de tabelas de preços (${valid.length} versões — use para comparação e análise de evolução)\n\n${blocks.join('\n\n---\n\n')}`
}

// ─── Formatador reutilizável (exportado para uso em tool responses) ───────────

export { buildKPIContext }

// ─── System Prompt ─────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  unitName: string,
  kpiData: KPIPeriod | KPIPeriod[],
  priceImports: PriceImportForPrompt[] = []
): string {
  // ── Montar contexto de KPIs (1 ou N períodos) ─────────────────────────────
  const periods = Array.isArray(kpiData) ? kpiData : [kpiData]

  let kpiContext: string
  if (periods.length === 1) {
    kpiContext = buildKPIContext(unitName, periods[0].period, periods[0].company, periods[0].bookings)
  } else {
    // Modo comparativo: cada período tem seu bloco com label
    const blocks = periods.map((p, i) => {
      const label = p.label ?? `Período ${String.fromCharCode(65 + i)}`
      const ctx = buildKPIContext(unitName, p.period, p.company, p.bookings)
      // Substitui o "## Dados operacionais — {nome}" pelo label do período
      return ctx.replace(/^## Dados operacionais[^\n]*\n/, `### ${label}\n`)
    })
    kpiContext = `## Dados operacionais comparativos — ${unitName}\n\n${blocks.join('\n\n---\n\n')}`
  }

  const priceContext = buildPriceTablesContext(priceImports)

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

## Acesso a dados em tempo real (ferramentas disponíveis)
Você tem acesso direto ao banco de dados e à API de analytics da unidade. **Use esses dados ativamente** — nunca diga que não tem acesso a dados ou que depende do usuário para trazer informações.

- **buscar_kpis_periodo**: Busca KPIs completos (giro, RevPAR, ticket, ocupação, canal digital) para qualquer período. Use quando:
  - O usuário mencionar uma data/semana específica
  - For necessário comparar com um período de monitoramento
  - O usuário pedir análise de "como está indo" ou "o que aconteceu na semana X"
  - Os dados do contexto atual não cobrirem o período solicitado

- **buscar_dados_automo**: Consulta locações diretamente no ERP para giro e contagens por categoria. Use quando precisar de dados mais recentes do que a API de analytics disponibiliza, ou para confirmar métricas granulares.

- **gerar_heatmap**: Renderiza um mapa de calor visual (hora × dia da semana) diretamente no chat. Use quando o usuário pedir "mapa de calor", "heatmap", "calor por hora", "ocupação por hora/dia" ou variações. Passe sempre startDate e endDate no formato YYYY-MM-DD. Não descreva os dados em texto — use este tool para que o gráfico apareça visualmente.

**Regra de ouro**: Quando o usuário perguntar sobre dados de qualquer período, busque os dados antes de responder. Não diga "não tenho como saber" — use as ferramentas.

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
