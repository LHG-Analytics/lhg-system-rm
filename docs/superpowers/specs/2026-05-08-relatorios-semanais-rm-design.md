# Relatórios Semanais do Agente RM — Design Spec
**Data:** 2026-05-08
**Status:** Aprovado para implementação

---

## Visão geral

Página `/dashboard/relatorios` que exibe relatórios semanais gerados automaticamente toda segunda-feira às 06h BRT para cada unidade. O relatório consolida tudo que o agente RM aprendeu na semana — KPIs, precificação, descontos, concorrentes, padrões de demanda, anomalias, elasticidade e sazonalidade — em um documento rico com gráficos, tabelas e análise narrativa gerada por IA.

**Caso de uso principal:** briefing para a reunião de RM de segunda-feira.

---

## Periodicidade e geração

- **Período:** segunda a domingo (semana operacional)
- **Geração automática:** dentro do cron diário existente (`run-reviews.ts`), ao detectar segunda-feira UTC, dispara `generateWeeklyReport` para cada unidade ativa em paralelo
- **Geração sob demanda:** botão na página com DateRangePicker — gera para qualquer período histórico
- **Sem slot de cron extra:** aproveitamento do slot 1 já existente (`0 10 * * *`), com condicional `getUTCDay() === 1`

---

## Banco de dados

### Tabela `rm_weekly_reports`

```sql
CREATE TABLE rm_weekly_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,  -- segunda-feira
  period_end      DATE NOT NULL,  -- domingo
  status          TEXT NOT NULL CHECK (status IN ('generating', 'done', 'failed')),
  generated_at    TIMESTAMPTZ,
  error_msg       TEXT,
  report_data     JSONB,          -- dados estruturados (veja interface abaixo)
  ai_summary      TEXT,           -- executive summary gerado por IA
  UNIQUE (unit_id, period_start)
);

-- RLS: usuários da unidade leem; super_admin lê tudo
ALTER TABLE rm_weekly_reports ENABLE ROW LEVEL SECURITY;
```

### Estrutura de `report_data` (TypeScript)

```typescript
interface WeeklyReportData {
  period: {
    start: string       // YYYY-MM-DD (segunda)
    end: string         // YYYY-MM-DD (domingo)
    unit: string        // nome da unidade
    unitSlug: string
    generatedAt: string // ISO timestamp
  }

  // Seção 1: Executive Summary (ai_summary separado na coluna)
  executiveSummary: {
    headline: string       // uma linha que captura o tom geral da semana
    keyPoints: string[]    // 3 bullets
    mainWin: string
    mainConcern: string
    priorityAction: string
    tone: 'positive' | 'neutral' | 'warning' // define cor do card
  }

  // Seção 2: Evolução vs semana anterior (calculado, sem IA)
  evolution: {
    hasPreviousReport: boolean
    previousPeriodStart: string | null
    kpiDeltas: {
      revpar: number; giro: number; ocupacao: number
      ticket: number; receita: number; tmo: number
    }
    guiaShareDelta: number        // pp
    metaGapDelta: number          // pp (quanto o gap meta reduziu/aumentou)
    lessonsVerdict: { acertos: number; neutros: number; falhas: number }
    anomaliesNewCount: number
    anomaliesResolvedCount: number
  }

  // Seção 3: Meta × Previsão × Realizado
  budgetTracking: {
    monthName: string
    monthDaysTotal: number
    monthDaysElapsed: number
    realizado: number            // receita até domingo
    projecao: number             // pace atual × dias restantes
    meta: number                 // do Google Sheets / unit_goals
    paceDiarioNecessario: number // para bater meta nos dias restantes
    paceDiarioAtual: number
    aiLeverageComment: string    // "Para fechar R$ X, as alavancas são..."
  }

  // Seção 4: KPIs da semana
  kpis: {
    current: KPISnapshot
    previousWeek: KPISnapshot
    sameWeekLastYear: KPISnapshot
  }

  // Seção 5: Desempenho da precificação
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
      categoria: string; periodo: string; diaTipo: string
      precoanterior: number; precoNovo: number; variacaoPct: number
      deltaRevpar: number; deltaGiro: number
      verdict: 'success' | 'neutral' | 'failure'
      checkpointDays: number
    }[]
    elasticityHighlights: {
      categoria: string; periodo: string; diaTipo: string
      elasticity: number; confidence: 'high' | 'medium' | 'low'
      interpretation: string  // "elástico: subida de preço reduz giro"
    }[]
  }

  // Seção 6: Descontos Guia de Motéis
  discounts: {
    activeDiscounts: {
      categoria: string; periodo: string; diaSemana: string
      faixaHoraria: string; tipoDesconto: string; valor: number
    }[]
    guiaSharePct: number
    guiaSharePrevWeek: number
    discountProposalsApprovedThisWeek: number
    topDiscountImpact: string  // computado: desconto com maior volume de reservas × valor base — ex: "desconto terça 30% representa R$ X em receita bruta"
  }

  // Seção 7: Padrões de demanda
  demand: {
    channelMix: { canal: string; label: string; reservas: number; receita: number; representatividade: number }[]
    periodMix: { periodo: string; locacoes: number; receita: number; ticket: number; pct: number }[]
    peakDow: string    // "sexta-feira"
    peakHourRange: string // "20h–22h"
    valleyDow: string
  }

  // Seção 8: Inteligência competitiva
  competitors: {
    gaps: {
      categoria: string; periodo: string; diaTipo: string
      precoNosso: number; medianaConc: number; gapPct: number
      position: 'underprice' | 'aligned' | 'overprice'
    }[]
    changesDetectedCount: number
    changesDirection: 'up' | 'down' | 'mixed' | 'none'
    dominantPosition: 'underprice' | 'aligned' | 'overprice'
  }

  // Seção 9: Outlook — próximas 2 semanas
  outlook: {
    seasonalFactors: {
      date: string; dowLabel: string
      factorRevpar: number; factorGiro: number
      level: 'hot' | 'normal' | 'cold'
    }[]
    upcomingEvents: {
      title: string; eventDate: string; eventType: string; impactDescription: string
    }[]
    revenueForecast: {
      month: string; projected: number; budgeted: number; gapPct: number
    }[]
  }

  // Seção 10: O que o agente aprendeu esta semana
  intelligence: {
    anomaliesDetected: { metric: string; direction: string; zScore: number; scope: string }[]
    anomaliesResolved: { metric: string; resolvedAt: string }[]
    newLessonsCount: number
    elasticityUpdatedCount: number
    seasonalityRecomputed: boolean
    weekHighlight: string  // computado (não IA): string montada a partir dos counts — "2 lições como acerto; elasticidade da Master 3h agora com alta confiança"
  }

  // Seção 11: Configuração ativa do agente
  agentConfig: {
    pricingStrategy: string
    focusMetric: string
    maxVariationPct: number
    guardrailsCount: number
    sharedContext: string | null
    suiteCapacity: {
      categoria: string; total: number; bloqueadas: number
      disponiveis: number; motivosBloqueio: string[]
    }[]
  }
}

interface KPISnapshot {
  revpar: number; trevpar: number; giro: number
  ocupacao: number; ticket: number; receita: number
  locacoes: number; tmo: number
}
```

---

## API Routes

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/agente/reports?unitSlug=` | Lista relatórios da unidade — retorna **apenas metadados** (`id, period_start, period_end, status, generated_at`), sem `report_data` |
| `GET` | `/api/agente/reports/[id]` | Retorna dados completos de um relatório (`report_data` + `ai_summary`) |
| `POST` | `/api/agente/reports/generate` | Geração sob demanda `{ unitSlug, dateFrom, dateTo }` |

**Geração sob demanda com `after()`:** A rota `POST` insere o registro com `status: 'generating'` e retorna `{ id }` imediatamente. A geração real é disparada via `after(generateWeeklyReport(...))` do Next.js — mesmo padrão já usado no projeto para weather insights e event cache refresh. Isso evita estourar o timeout de 60s do Hobby. A página faz polling via `GET /api/agente/reports/[id]` a cada 3s até `status === 'done' | 'failed'`.

---

## Pipeline de geração (`src/lib/reports/generate-weekly-report.ts`)

Executa as seguintes queries **em paralelo** (Promise.allSettled):

1. KPIs semana atual (`fetchCompanyKPIsFromAutomo`)
2. KPIs semana anterior
3. KPIs mesma semana LY
4. Mix de canal (`queryChannelKPIs`)
5. Mix de período (`queryPeriodMix`)
6. Tabela de preços ativa (`price_imports`)
7. Propostas aprovadas na semana (`price_proposals`)
8. Lições de precificação com checkpoints concluídos (`rm_pricing_lessons`)
9. Elasticidade por categoria (`rm_price_elasticity`)
10. Descontos ativos (`price_imports` com `import_type='discounts'`)
11. Propostas de desconto aprovadas (`discount_proposals`)
12. Gaps de concorrentes (`rm_competitor_price_gaps`)
13. Fatores sazonais próximos 14 dias (`unit_seasonality`)
14. Eventos cadastrados próximas 2 semanas (`unit_events`)
15. Anomalias da semana (`rm_anomalies`)
16. Configuração do agente (`rm_agent_config`)
17. Capacidade das suítes (`getSuiteAvailabilityByCategory`)
18. Budget/forecast (`budget_yearly` + `buildForecastBlock` data)
19. Relatório anterior (para calcular `evolution`)

Após coletar dados → chama `ANALYSIS_MODEL` para gerar `executiveSummary` + `budgetTracking.aiLeverageComment` (~500 tokens output).

Salva `report_data` + `ai_summary` → atualiza `status = 'done'`.

Falha graceful: se query individual falhar, a seção fica com dados parciais (`null`), não impede geração do resto.

---

## Componentes UI (`src/app/dashboard/relatorios/`)

```
relatorios/
├── page.tsx                          # Server component: auth + lista inicial
├── loading.tsx                       # Skeleton da página
└── _components/
    ├── relatorios-page-client.tsx     # Client: layout com painel + viewer
    ├── report-sidebar.tsx             # Lista de relatórios + botão gerar
    ├── report-viewer.tsx              # Orquestrador das seções
    ├── report-generate-button.tsx     # DateRangePicker + POST + polling
    ├── report-comparison-mode.tsx     # Modo lado a lado
    ├── sections/
    │   ├── executive-summary.tsx
    │   ├── evolution-banner.tsx       # Faixa compacta Δ vs semana anterior
    │   ├── budget-tracking.tsx        # Meta × Previsão × Realizado
    │   ├── kpis-section.tsx
    │   ├── pricing-section.tsx
    │   ├── discounts-section.tsx
    │   ├── demand-section.tsx
    │   ├── competitors-section.tsx
    │   ├── outlook-section.tsx
    │   ├── intelligence-section.tsx
    │   └── agent-config-section.tsx
    └── charts/
        ├── kpi-comparison-chart.tsx   # Barras agrupadas: atual × anterior × LY
        ├── channel-mix-chart.tsx      # Barras horizontais
        ├── period-mix-chart.tsx       # Barras horizontais
        ├── seasonal-outlook-chart.tsx # Área / linha próximos 14 dias
        └── guia-share-chart.tsx       # Linha simples share Guia semana × semana
```

**Biblioteca de gráficos:** `recharts` + `@/components/ui/chart` (wrapper shadcn/ui).

---

## Layout da página

```
┌────────────────────────────────────────────────────────────────────┐
│ Header: "Relatórios"  [Seletor de Unidade]                         │
├──────────────────┬─────────────────────────────────────────────────┤
│ Painel lateral   │ Área principal (scroll vertical)                 │
│ 240px            │                                                  │
│                  │  ┌─────────────────────────────────────────────┐ │
│ [Gerar relatório]│  │ ① Executive Summary (card colorido)         │ │
│                  │  │   tone: positive/neutral/warning             │ │
│ ─────────────    │  └─────────────────────────────────────────────┘ │
│ Sem 12–18/05 ✓   │  ┌─────────────────────────────────────────────┐ │
│ Sem 05–11/05 ✓   │  │ ② Evolução vs semana anterior (faixa)       │ │
│ Sem 28/04–04/05  │  │   ↑ RevPAR +8%  ↓ Ticket −2%  → Ocup =    │ │
│ Personalizado    │  └─────────────────────────────────────────────┘ │
│   [DatePicker]   │  ┌─────────────────────────────────────────────┐ │
│                  │  │ ③ Meta × Previsão × Realizado (destaque)    │ │
│                  │  │   Barra de progresso + tabela 3 cenários     │ │
│                  │  │   + comentário IA âmbar                     │ │
│                  │  └─────────────────────────────────────────────┘ │
│                  │  ┌─────────────────────────────────────────────┐ │
│                  │  │ ④–⑪ Seções colapsáveis (padrão aberto)     │ │
│                  │  └─────────────────────────────────────────────┘ │
│                  │                           [Comparar ↔] (header)  │
└──────────────────┴─────────────────────────────────────────────────┘
```

**Estados da área principal:**
- **Vazio (sem nenhum relatório):** card central com mensagem "Próximo relatório gerado segunda às 06h" + botão "Gerar agora" + sugestão de backfill: "Quer ver as últimas 4 semanas? [Gerar histórico]" — ao clicar, dispara 4 gerações sequenciais com as semanas anteriores
- **Gerando:** skeleton com steps animados ("Coletando KPIs... Analisando concorrentes... Escrevendo resumo...")
- **Pronto:** relatório completo
- **Comparação:** split 50/50 com scroll sincronizado, dropdown para selecionar relatório de referência no painel esquerdo

**Seções colapsáveis:** mesmo padrão de WeatherWidget / AnomaliesWidget — header clicável com chevron, estado persiste em `localStorage`.

**Modo comparação:**
- Botão "Comparar ↔" aparece no header quando há pelo menos 1 relatório anterior
- Split view com `overflow-y-auto` em cada painel (padrão comparison-modal.tsx existente)
- Deltas destacados: valores do relatório esquerdo aparecem em cinza/muted; valores do direito em cor normal com badge Δ ao lado
- Toggle "Scroll sincronizado" no header do split

---

## Integração com o cron existente (`run-reviews.ts`)

```typescript
// Adicionado no início do handler do cron
const today = new Date()
if (today.getUTCDay() === 1) {  // segunda-feira UTC
  const lastSunday = new Date(today)
  lastSunday.setUTCDate(today.getUTCDate() - 1)
  const lastMonday = new Date(lastSunday)
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6)

  const periodStart = lastMonday.toISOString().slice(0, 10)
  const periodEnd = lastSunday.toISOString().slice(0, 10)

  await Promise.allSettled(
    unitSlugs.map(slug => generateWeeklyReport(slug, periodStart, periodEnd))
  )
}
```

---

## Sidebar

```typescript
// app-sidebar.tsx: remover disabled: true
{ label: 'Relatórios', href: '/dashboard/relatorios', icon: BarChart3 }
```

---

## Migração Supabase

`supabase/migrations/20260508000001_rm_weekly_reports.sql`
- `CREATE TABLE rm_weekly_reports` com todos os campos
- RLS: SELECT para usuários da unidade, INSERT/UPDATE via service_role apenas
- `ALTER PUBLICATION supabase_realtime ADD TABLE rm_weekly_reports` (para polling de status)

---

## Dependências novas

- `recharts` — gráficos
- `@/components/ui/chart` — wrapper shadcn (instalar via `npx shadcn@latest add chart`)

---

## O que NÃO está no escopo desta entrega

- Exportação PDF (LHG-174 — backlog)
- Envio por email (LHG-169 — descartado pelo usuário)
- Edição manual do relatório
- Comentários/anotações nas seções
