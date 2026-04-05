# LHG Revenue Manager — Guia para o Claude

## Stack

- **Next.js 16.2.1** — App Router, TypeScript, React Compiler ativo
- **Tailwind v4** + **shadcn/ui** (preset Nova, Radix UI)
- **Supabase** — PostgreSQL + Auth + Realtime + Edge Functions
  - Local: `http://127.0.0.1:54321` (Docker via Scoop CLI v2.84.2)
  - Remoto: `https://pvlcktqbjianrbzpqrbd.supabase.co`
- **Upstash Redis** — cache (a configurar)
- **Vercel AI Gateway** — roteamento de IA (Claude primário + Gemini Flash fallback automático)
  - Auth: `VERCEL_OIDC_TOKEN` (via `vercel env pull`) + `AI_GATEWAY_API_KEY`
  - Modelo primário: `anthropic/claude-sonnet-4.6` | Fallback: `google/gemini-2.0-flash`
  - Config centralizada em `src/lib/agente/model.ts`
- **Deploy:** Vercel + Supabase hosted
  - Projeto linkado: `danilo-dinizs-projects/lhg-system-rm`
  - AI Gateway habilitado no dashboard Vercel

## Convenções obrigatórias

### Next.js 16
- `proxy.ts` em `src/proxy.ts` (não `middleware.ts` — renomeado no Next.js 16)
- `cookies()` é **async** — sempre `await cookies()`
- **Server Components por padrão** — só `'use client'` para interatividade/hooks
- App Router only — não usar Pages Router
- **`useSearchParams()`** em Client Components exige `<Suspense>` boundary no Next.js App Router (React 19). Envolver o componente com `<Suspense fallback={null}>` no layout pai.
- **Layouts não recebem `searchParams`** — apenas `page.tsx` recebe. Para unit switcher, usar `useSearchParams` no client + Suspense.

### Supabase
- Clientes: `src/lib/supabase/client.ts` (browser) e `src/lib/supabase/server.ts` (server)
- **Nunca usar `service_role` no cliente** — apenas em Edge Functions/Server Actions
- **Sempre usar RLS** — toda tabela tem políticas ativas
- Migrations versionadas em `supabase/migrations/` — nunca alterar o banco diretamente
- Após alterar schema: `supabase gen types typescript --local > src/types/database.types.ts`
- Supabase CLI local: `/c/Users/danil/scoop/shims/supabase.exe`

### Segurança
- Nunca expor API keys no cliente — chamadas externas via Server Actions ou Edge Functions

### Verificação obrigatória antes de commitar
Sempre executar os dois passos abaixo antes de qualquer commit:
1. `npx tsc --noEmit` — garante que não há erros de tipo
2. `npm run build` — garante que o Next.js compila sem erros de SSR/SSG

Só commitar se ambos passarem sem erros.

### Git
- **Sempre fazer `git push` após cada commit** — nunca deixar commits locais pendentes.
- **Nunca avançar para a próxima issue sem commitar e fazer push da anterior** — uma issue por vez, sempre finalizada antes de iniciar a próxima.

### shadcn/ui
- Adicionar componentes: `npx shadcn@latest add [componente]`
- **`next-themes` substituído** — não usar. O projeto usa implementação própria em `src/components/theme-provider.tsx` com `useEffect` + `localStorage` + `classList.toggle('dark')`. O `next-themes` injeta `<script>` inline que React 19 não executa no cliente.

### React 19 / Compatibilidade
- `<script>` inline dentro de componentes React não é executado no cliente no React 19 — usar `useEffect` para lógica de inicialização.
- `useSearchParams()` sem `<Suspense>` causa "Can't perform a React state update on a component that hasn't mounted yet" no React 19 concurrent mode.

### Vercel AI Gateway
- Usar `gateway('provider/model')` de `'ai'` — não usar providers diretos nas rotas do agente
- Versões com ponto: `anthropic/claude-sonnet-4.6` (não hífen: `claude-sonnet-4-6`)
- Fallback via `providerOptions: { gateway: { models: ['google/gemini-2.0-flash'] } }`
- `VERCEL_OIDC_TOKEN` expira em ~24h em dev — reexecutar `vercel env pull` se expirar
- `NODE_OPTIONS="--max-old-space-size=4096" npm run build` para build local (evita OOM)

### Next.js 16 — armadilhas conhecidas
- **Nunca chamar `router.refresh()` imediatamente após `router.push()`** — causa "Router action dispatched before initialization". O `push()` já faz fresh render do servidor; o `refresh()` é desnecessário.
- **`next/image` com CSS de tamanho**: sempre incluir `style={{ height: 'auto' }}` ou `style={{ width: 'auto' }}` para manter o aspect ratio quando só uma dimensão é definida no CSS.
- **`SidebarProvider` do shadcn/ui** deve envolver com `<TooltipProvider delayDuration={0}>` internamente — a versão gerada pelo CLI não inclui, causando erro de SSR "Tooltip must be used within TooltipProvider".

## KPIs operacionais (Automo)

Dashboard, agente RM e cron usam **`fetchCompanyKPIsFromAutomo()`** (`src/lib/automo/company-kpis.ts`) — SQL read-only no PostgreSQL do ERP. Tipos compartilhados em `src/lib/kpis/types.ts`. Períodos em `DD/MM/YYYY`; janela padrão de contexto histórico: **`trailingYear()`** em `src/lib/kpis/period.ts` (mesma data do ano passado até ontem operacional, corte 06:00).

## Contexto de negócio

Sistema para gestão de preços e disponibilidade de suítes de motéis da LHG.

- **Múltiplas unidades** (2–5 motéis) com controle centralizado
- **Precificação por:** categoria × período (3h/6h/12h/pernoite) × canal de venda × faixa horária × dia da semana
- **ERP:** Automo — acesso read-only ao banco PostgreSQL (nova API em desenvolvimento)
- **Canais MVP:** ERP + Site Próprio + Guia de Motéis
- **Agente RM:** MVP gera proposta para aprovação humana; pós-MVP flutua preços autonomamente

## Automo PostgreSQL (ERP — read-only)

Conexão direta ao banco do ERP Automo para dados de locações/reservas em tempo real.

**Variáveis de ambiente necessárias:**
- `AUTOMO_DB_HOST` — host do servidor PostgreSQL
- `AUTOMO_DB_PORT` — porta (normalmente 5432)
- `AUTOMO_DB_NAME` — nome do banco
- `AUTOMO_DB_USER` — usuário read-only
- `AUTOMO_DB_PASSWORD` — senha

**Regras:**
- Acesso exclusivamente server-side (Route Handlers / Server Actions)
- Nunca expor credenciais ou dados brutos ao cliente
- Queries apenas SELECT — nunca INSERT/UPDATE/DELETE
- Usar `pg` ou `@neondatabase/serverless` como driver se necessário

## Arquitetura do banco (schema v2 — 2026-03-29)

19 tabelas + 5 ENUMs + RLS em todas as tabelas:

| Tabela | Descrição |
|--------|-----------|
| `units` | Unidades/motéis |
| `profiles` | Usuários com roles (super_admin/admin/manager/viewer) |
| `suite_categories` | Categorias de suíte por unidade |
| `suite_periods` | Períodos (3h/6h/12h/pernoite) com preço base |
| `sales_channels` | Canais de venda por unidade |
| `channel_inventory` | Alocação de inventário por canal |
| `price_rules` | Regras de precificação manual |
| `rm_agent_config` | Configuração do agente RM |
| `rm_conversations` | Histórico de chat com o agente |
| `rm_generated_prices` | Propostas de preço do agente (pending/approved/rejected) |
| `rm_price_decisions` | Decisões autônomas pós-MVP |
| `rm_price_guardrails` | Limites de variação para o agente autônomo |
| `rm_agent_overrides` | Cancelamentos e reversões de decisões |
| `rm_weather_demand_patterns` | Padrões aprendidos clima × demanda |
| `kpi_snapshots` | Cache de KPIs do ERP |
| `lhg_analytics_tokens` | Legado (não usado pelo app atual; pode ser removido em migração futura) |
| `channel_sync_log` | Log de sincronização com canais |
| `notifications` | Notificações para usuários |
| `price_proposals` | Propostas de preço do agente (JSONB rows, pending/approved/rejected) — sem FK para tabelas de categorias/períodos/canais |
| `scheduled_reviews` | Revisões automáticas agendadas (unit_id, scheduled_at, note, status, conv_id) — executadas via Vercel Cron |

**Campos de vigência em `price_imports`** (adicionados em 2026-03-29):
- `valid_from DATE NOT NULL DEFAULT CURRENT_DATE` — início da vigência da tabela
- `valid_until DATE` (nullable) — fim da vigência; NULL = atualmente ativa

**RLS:** funções `current_user_role()` e `current_user_unit_id()` como `SECURITY DEFINER` são a base de todas as policies.

## Issues Linear (status atual — 2026-04-05)

### ✅ Concluídos
- **LHG-8:** Setup Next.js + Supabase + Tailwind + shadcn/ui
- **LHG-9:** Auth Google SSO + email/senha
- **LHG-10:** DB Schema completo + migrations
- **LHG-11:** RLS Policies
- **LHG-14:** Sidebar + Navegação + Layout base (incl. hover expand/collapse, unit switcher com Suspense)
- **LHG-21:** KPIs em tempo real via Automo (substitui integração Analytics legada)
- **LHG-5:** SPIKE — Mapear banco Automo
- **LHG-49:** CI/CD GitHub Actions → Vercel + Supabase migrations automáticas
- **LHG-64:** Supabase local + vínculo remoto
- **LHG-65:** Google OAuth configurado
- **LHG-66:** Logo LHG na tela de login
- **LHG-67:** Fix cursor pointer
- **LHG-68:** Toggle dark/light mode (custom ThemeProvider — sem next-themes)
- **LHG-70:** Cadastro de unidades reais no banco
- **LHG-35:** Edge Function: Endpoint seguro para Claude API (via Vercel AI Gateway)
- **LHG-36:** Agente RM: Interface de chat com streaming
- **LHG-37:** Agente RM: Injeção automática de KPIs no contexto do agente
- **LHG-38:** Agente RM: Import de tabela de preços via CSV (Claude/Gemini parseia, preview, confirmação)
  - Campos de vigência: `valid_from` (obrigatório, padrão hoje) + `valid_until` (nullable = atualmente ativa)
  - UI exibe campos "De / Até" logo após selecionar o arquivo (antes de analisar)
  - GET `/api/agente/import-prices?unitSlug=` lista todos os imports por `valid_from DESC`
  - Agente RM: dropdown de seleção de tabela (aparece quando há 2+ imports); datas de análise preenchidas automaticamente pela vigência; editável pelo usuário
  - System prompt inclui período de vigência no cabeçalho da tabela de preços
  - **Armadilha:** migração precisa ser aplicada no banco **remoto** via MCP (`mcp__supabase__apply_migration`), não apenas `supabase db push --local`
- **LHG-40:** Agente RM: Prompt engineering e estratégia de precificação (framework Diagnóstico→Proposta, KPIs + tabela de preços injetados)
- **LHG-41:** Agente RM: Interface de aprovação de propostas (humano sempre aprova no MVP)
  - Tabela `price_proposals` com JSONB rows (sem FK — independente de suite_categories/periods/channels)
  - API `/api/agente/proposals` (GET/POST/PATCH) — gera, lista e aprova/rejeita propostas
  - `ProposalsListcomponent` com expand/collapse, aprovação inline, badge de pendentes
  - Agente com seletor de período customizável (não fixo em 12 meses)
  - Tabelas semanais injetadas no contexto: DataTableRevparByWeek/GiroByWeek
  - BigNumbers com comparativo 3 colunas: período atual | mesmo período ano anterior | previsão fechamento
  - Regra: agente pergunta ao usuário quando precisar de info não disponível (ex: total de suítes)
- **LHG-73:** Integração Automo PostgreSQL (read-only) — conexão direta ao banco do ERP Automo
  - Pool de conexões por unidade via variáveis de ambiente (`AUTOMO_DB_*`)
  - `UNIT_CATEGORY_IDS` mapeia slug → IDs de categoria Automo
  - `ssl: false` para servidores internos sem suporte a SSL
- **LHG-29:** Dashboard: KPIs RevPAR, TRevPAR, Giro, TMO, Faturamento, Ticket Médio, Locações e Taxa de Ocupação
  - 8 cards com valor atual, delta % colorido (Badge + ícone TrendingUp/Down) e valor anterior absoluto
  - Calculados via `fetchCompanyKPIsFromAutomo()` com 10 queries paralelas
- **LHG-30:** Dashboard: Heatmap ocupação × hora × dia da semana
  - Mapa de calor com giro, taxa de ocupação, RevPAR e TRevPAR por hora × dia da semana
  - Filtros: categoria de suíte, tipo de data (entrada/saída/todas), KPI (giro/ocupação/revpar/trevpar)
  - Seletor de período global no dashboard (Últimos 7 dias / Este mês / Último mês fechado / Personalizada)
  - Cálculo de giro: `SUM(rentals/suites) / n_ocorrências_do_dia` (média correta por dia da semana)
  - Cálculo de ocupação: `generate_series` distribui cada locação pelos slots de 1h que ela ocupa
  - Favicon substituído pelo logo LHG (`src/app/icon.png`)
- **LHG-72:** Ajustes de layout e polish — página do Agente RM
  - Sidebar de histórico extraída do `TabsContent` para o nível da página (alinha com o topo do card)
  - Header "Agente RM / Analisando..." + TabsList (Chat|Propostas) consolidados dentro do card principal
  - Arquitetura: `agente-page-client.tsx` (client component com estado de conversas + layout), `agente-chat.tsx` (só renderiza conteúdo do chat, sem card wrapper nem estado de conversas), `page.tsx` (server, só fetch + render do `AgenteChatPage`)
- **LHG-74:** Agente RM: Revisões automáticas agendadas (Vercel Cron)
  - Tabela `scheduled_reviews` com RLS por unidade
  - Tool `agendar_revisao` persiste no banco — agente nunca mais só "promete" agendar
  - Rota `/api/cron/revisoes` (auth `CRON_SECRET`): executa revisões do dia, gera análise via AI Gateway, salva em `rm_conversations` com título `"Revisão agendada — DD/MM/YYYY · Nome da Unidade"`, cria notificação in-app
  - `vercel.json` com cron `0 10 * * *` (10:00 UTC = 7h BRT) — 1 dos 2 slots gratuitos do Hobby
  - **Variável necessária em produção:** `CRON_SECRET` (adicionar via `vercel env add CRON_SECRET production`)
- **LHG-75:** Dashboard: Filtros avançados — hora, status de locação e tipo de data
  - Filtro de hora: `HH:00:00 → HH:59:59`; default `06:00:00 → 05:59:59` (dia operacional completo)
  - Filtro de status: Finalizadas / Transferidas / Canceladas / Em aberto / Todas (`fimocupacaotipo`)
  - Filtro de tipo de data: Entrada / Saída / Todas (troca coluna entre `datainicialdaocupacao` e `datafinaldaocupacao`)
  - Helpers: `buildTimeFilter()`, `buildStatusFilter()`, `buildDateRangeFilter()` em `company-kpis.ts`
  - Todos os filtros persistem na URL como search params e afetam KPIs + heatmap
- **LHG-76:** Dashboard: BigNumbers com comparativo a/a e m/m + previsão de fechamento
  - Toggle a/a ↔ m/m global para todos os 8 cards
  - Valor anterior absoluto em cada card (não só percentual)
  - Previsão de fechamento do mês para todos os KPIs incluindo Taxa de Ocupação e RevPAR
  - 10 queries paralelas: currentBN, prevBN (a/a), prevMonBN (m/m), monthBN, revOcc, prevRevOcc, prevMonRevOcc, monthRevOcc, suiteCatTable, weekTables
  - Novos campos em tipos: `prevMonthDate`, `totalAllOccupancyRate*` em todos os períodos, `totalAllRevparForecast`
- **LHG-77:** UI: Redesign dashboard com componentes shadcn — KPI cards e filtros
  - KPI cards: `Card/CardHeader/CardContent`, `Badge` com ícone TrendingUp/Down, `Separator`, `ToggleGroup`
  - DateRangePicker: `Select`, `ToggleGroup` segmentado, `Button`, `Input`, `Label`, `Separator` vertical
  - Novos componentes instalados: `toggle.tsx`, `toggle-group.tsx`
- **LHG-78:** Preços: listagem realtime de tabelas com edição, exclusão e status de vigência
  - `PriceList` component com Supabase Realtime (`postgres_changes`) — atualiza ao INSERT/UPDATE/DELETE
  - Badge "Em uso" / "Inativa" baseado em datas (`valid_from ≤ hoje AND valid_until IS NULL OR ≥ hoje`)
  - Expansão inline dos preços (ChevronDown), edição de vigência inline, exclusão com `AlertDialog`
  - API: `PATCH /api/agente/import-prices` (atualiza vigência) e `DELETE /api/agente/import-prices?id=`
  - Instalado componente `alert-dialog.tsx` do shadcn
- **LHG-79:** Preços: aprovação de proposta cria snapshot versionado da tabela de preços
  - Ao aprovar proposta no Agente RM: clona a tabela ativa atual (snapshot completo)
  - Aplica upsert dos `preco_proposto` sobre o clone (por chave `canal|categoria|periodo|dia_tipo`)
  - Itens sem proposta preservados intactos; itens novos na proposta adicionados ao clone
  - Encerra a vigência da tabela anterior (`valid_until = ontem`) e insere o novo snapshot como ativo
  - Se não há tabela ativa, cria do zero apenas com os preços propostos
  - **Armadilha:** `is_active` no banco pode estar inconsistente — status "em uso" usa apenas datas
- **LHG-80:** Agente RM: Geração rápida de proposta com análise comparativa, edição inline e exclusão
  - POST `/api/agente/proposals`: identifica tabela ativa e anterior, calcula KPIs para o período de vigência de cada uma (janela deslizante, mín. 14 dias), injeta contexto comparativo no prompt
  - Injeta mapa explícito `canal|categoria|periodo|dia_tipo = R$ X` para o modelo não inferir `preco_atual`
  - Prompt focado com `buildKPIContext` (não usa `buildSystemPrompt` do chat — evita contexto de tools que impedia JSON puro)
  - `maxOutputTokens` 8000 (propostas com 35+ linhas eram truncadas em 4000)
  - PATCH com `{ id, rows }` edita linhas de proposta pendente sem alterar status; `variacao_pct` recalculada ao vivo
  - DELETE `/api/agente/proposals?id=` remove proposta; AlertDialog de confirmação na UI
  - "Ler mais / Ler menos" no contexto do card (160 chars) e justificativa de cada linha (80 chars)
  - Página de Preços: componente de importação movido para o topo, histórico abaixo
- **LHG-81:** Dashboard: Range calendar picker e filtros fixos sem quebra de linha
  - `Input type="date"` (x2) substituídos por Popover com `Calendar mode="range"` (shadcn) — fecha ao selecionar range completo, label `DD/MM/YYYY → DD/MM/YYYY`, locale pt-BR
  - Filtros: `flex-wrap` removido, `shrink-0` em cada seção, `overflow-x-auto` no container — nunca quebra linha ao aplicar
  - Header do dashboard em `flex-col` (título + filtros empilhados) — elimina layout shift

### 🔲 Backlog MVP (por prioridade)

#### ✨ Polish e UX
1. **LHG-71:** Logo de cada unidade no seletor da sidebar

#### 🚀 Deploy e CI/CD
2. **LHG-50:** Deploy produção + onboarding unidades piloto

#### 📊 Dashboard — enriquecimento
3. **LHG-31:** Dashboard: Visão de canais

#### 🔔 Notificações
4. **LHG-32:** Notificações push + email (Resend)

### 📅 Pós-MVP (Backlog)
LHG-51 a LHG-63: guardrails, clima, eventos, trânsito, aprendizado autônomo, dynamic pricing loop.
