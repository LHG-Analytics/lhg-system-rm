# LHG Revenue Manager — Guia para o Claude

## Stack

- **Next.js 16.2.1** — App Router, TypeScript, React Compiler ativo
- **Tailwind v4** + **shadcn/ui** (preset Nova, Radix UI)
- **Supabase** — PostgreSQL + Auth + Realtime + Edge Functions
  - Local: `http://127.0.0.1:54321` (Docker via Scoop CLI v2.84.2)
  - Remoto: `https://pvlcktqbjianrbzpqrbd.supabase.co`
- **Upstash Redis** — cache (a configurar)
- **OpenRouter** — roteamento de IA
  - Provider: `@openrouter/ai-sdk-provider` v2.5.1
  - Auth: `OPENROUTER_API_KEY`
  - `STRATEGY_MODEL` (chat, propostas, cron): `nvidia/nemotron-3-super-120b-a12b:free` | Fallback: `minimax/minimax-m2.5:free` — **≤ 2500 tokens**
  - `ANALYSIS_MODEL` (import, análise de concorrentes): `openai/gpt-4.1-mini` (BYOK — chave OpenAI própria via OpenRouter) | Fallback: `nvidia/nemotron-3-super-120b-a12b:free` — **≤ 8000 tokens**
  - Modelos gratuitos disponíveis (STRATEGY): `nvidia/nemotron-3-super-120b-a12b:free`, `minimax/minimax-m2.5:free`, `google/gemma-4-31b-it:free`
  - **Regra obrigatória para STRATEGY_MODEL:** sempre sufixo `:free`; nunca exceder 2500 tokens
  - **ANALYSIS_MODEL usa BYOK** — não precisa de sufixo `:free`; limite 8000 tokens
  - Config centralizada em `src/lib/agente/model.ts`
- **Deploy:** Vercel + Supabase hosted
  - Projeto linkado: `danilo-dinizs-projects/lhg-system-rm`

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

### OpenRouter
- Usar `createOpenRouter` de `@openrouter/ai-sdk-provider` — não usar Vercel AI Gateway
- Usar modelos com sufixo `:free` — sem custo de créditos OpenRouter
- `PRIMARY_MODEL = openrouter('google/gemma-4-26b-a4b-it:free')`
- `FALLBACK_MODEL = openrouter('nvidia/nemotron-3-super-120b-a12b:free')`
- `gatewayOptions` exportado como `{}` — mantido para compatibilidade de assinatura nas rotas
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
| `price_import_jobs` | Fila de importação em background (unit_id, file_name, csv_content, valid_from, valid_until, status: pending/processing/done/failed, error_msg, result_id) |
| `competitor_snapshots` | Snapshots de preços de concorrentes — inclui `apify_run_id` e `status` (processing/done) para análise Playwright em background |

**Campos de vigência em `price_imports`** (adicionados em 2026-03-29):
- `valid_from DATE NOT NULL DEFAULT CURRENT_DATE` — início da vigência da tabela
- `valid_until DATE` (nullable) — fim da vigência; NULL = atualmente ativa
- `discount_data JSONB` (nullable) — política de descontos do Guia de Motéis (array de `ParsedDiscountRow`)

**RLS:** funções `current_user_role()` e `current_user_unit_id()` como `SECURITY DEFINER` são a base de todas as policies.

## Issues Linear (status atual — 2026-04-27)

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
  - Extrai também política de descontos do Guia de Motéis (PARTE 2 do prompt) → salvo em `discount_data JSONB`
  - Encoding automático: detecta Windows-1252 via contagem de `\uFFFD` (fallback para Latin-1)
  - Limite do CSV aumentado de 8k → 24k chars; tokens máximos: 16k
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
- **LHG-82:** Agente RM: ID de proposta visível + navegação Agenda→Proposta + revisão inteligente no header
  - ID curto (8 chars, font-mono, opaco) exibido no header de cada card de proposta
  - Aba Agenda: link "Proposta de DD/MM/YYYY (c41fe383)" clicável — navega para aba Propostas, scrolla e destaca o card com ring
  - GET `/api/agente/scheduled-reviews` faz join com `price_proposals` para trazer `proposal_created_at`
  - Botão "Agendar revisão" no header da proposta aprovada mais recente (sem precisar expandir)
  - Propostas aprovadas anteriores (supersedidas) não mostram o botão
  - Se já existe revisão pendente: badge azul "DD/MM · Reagendar" com Calendar popover para alterar data inline
  - POST `/api/agente/scheduled-reviews` para criar agendamento manualmente (propostas aprovadas antes do automático)
  - `loadPendingReviews()` recarrega após approve e após criar/reagendar

- **LHG-83:** Auth: Sistema invite-only + página de gerenciamento de usuários
  - Supabase "Allow new users to sign up" deve estar desabilitado em Authentication → Providers → Email
  - `auth/callback`: após OAuth Google, verifica se user tem `profile` — se não, faz sign out e redireciona com `?error=unauthorized`
  - `login/page.tsx`: exibe "Acesso não autorizado. Solicite um convite." quando `error=unauthorized`
  - `POST /api/admin/invite`: convida por email via `supabase.auth.admin.inviteUserByEmail` + cria `profile` imediatamente; só `super_admin` pode usar
  - `GET /api/admin/invite`: lista usuários (join `auth.users` para email, `invited_at`, `last_sign_in_at`)
  - `DELETE /api/admin/invite?userId=`: remove `profile` + deleta `auth.users` (não permite remover a si mesmo)
  - `/dashboard/admin`: página só para `super_admin` com formulário de convite (email + perfil + unidade) e lista de usuários com status "Aguardando aceite" ou "Último acesso"
- **LHG-84:** Fix: Agente RM usava unidade errada ao trocar via sidebar
  - Bug: `AgenteChat` não remontava ao trocar unidade — transport continuava com `unitSlug` antigo
  - Fix: `useRef` detecta mudança de `unitId` no `useEffect` e incrementa `chatKey`, forçando remontagem com novo contexto
- **LHG-85:** Fix: Dashboard — RevPAR comparativo real + header sem data duplicada + scrollbar oculta
  - `totalAllRevparPreviousData` e `totalAllRevparPrevMonth` adicionados aos tipos e populados via `prevRevOcc.totalRevpar` / `prevMonRevOcc.totalRevpar` (mesmo cálculo do período atual: `valorliquidolocacao / suites / daysDiff`)
  - `kpi-cards.tsx`: revPAR anterior usa o campo direto, sem aproximação via proporção de faturamento
  - Header do dashboard: preset `custom` exibe só `dateRange.label` (sem duplicar datas)
  - `date-range-picker.tsx`: scrollbar horizontal oculta via `[scrollbar-width:none]` (scroll funcional mas invisível)

- **LHG-86:** Agente RM: Memória estratégica — histórico de propostas aprovadas injetado no prompt de geração
  - `buildStrategicMemoryBlock`: busca últimas 3 propostas aprovadas em paralelo com KPIs (sem latência extra)
  - Monta tabela com cada alteração de preço (Δ%) por item; só aparece quando há itens com variação ≥1%
  - Critério condicional no prompt: "se KPIs melhoraram → intensifique direção; se pioraram → recue"
  - Agente cruza com comparativo período atual × anterior para avaliar se decisões passadas funcionaram
- **LHG-87:** Agente RM: Contexto por categoria de suíte no prompt (chat + geração de propostas)
  - `DataTableSuiteCategory` era calculada mas exibida como texto corrido sem RevPAR/TRevPAR
  - Substituído por tabela markdown: `Categoria | Locações | RevPAR | TRevPAR | Ocupação | Giro | Ticket | TMO`
  - Afeta tanto o chat do agente (buildKPIContext em system-prompt.ts) quanto o prompt de geração de propostas

- **LHG-88:** Agente RM: Guardrails de preço configuráveis por categoria/período
  - Migration: tabela `agent_price_guardrails` (unit_id, categoria, periodo, preco_minimo, preco_maximo) com UNIQUE + RLS
  - API `/api/admin/guardrails`: GET (lista), POST (upsert por unit+categoria+periodo), DELETE por id
  - POST `/api/agente/proposals`: busca guardrails da unidade, injeta limites no prompt (tabela markdown) e faz clamp server-side após parse do JSON (safety net)
  - UI na aba "Guardrails do Agente" em `/dashboard/admin` (Tabs: Usuários | Guardrails do Agente)
  - Categoria = nome exato do ERP (texto livre); Período = select: 3h/6h/12h/pernoite
- **LHG-89:** Notificações in-app com realtime
  - `NotificationsBell`: sino no header com badge de contagem de não-lidas
  - Supabase Realtime (`postgres_changes` INSERT) — badge atualiza sem polling
  - Popover com `ScrollArea`: lista até 20 notificações, timestamps relativos
  - Marcar como lida ao clicar; "Marcar todas como lidas" no header do popover
  - Instalado `scroll-area.tsx` do shadcn/ui
- **LHG-90:** Admin: redesign UI + edição inline de perfil e unidade de usuários
  - `UserRow` sub-componente com estado local de edição (ícone ✏️ → selects inline → salvar/cancelar)
  - `PATCH /api/admin/invite`: atualiza `role` e/ou `unit_id` de usuário existente (só `super_admin`, não pode editar a si mesmo)
  - Formulário de convite redesenhado: header com ícone + descrição, email full-width, perfil+unidade em grid 2-col
  - Badges de perfil com cores por papel: `super_admin` roxo, `admin` azul, `manager` verde, `viewer` muted
  - Tabs na página admin: Usuários | Guardrails do Agente
  - `GuardrailsManager` recebe `categorias` e `periodos` extraídos dinamicamente do último `price_import` da unidade ativa
  - **Armadilha Radix UI Select:** `value=""` causa comportamento indefinido — sempre usar sentinel não-vazio (ex: `"all"`)
- **LHG-71:** UI: Logo de cada unidade no seletor da sidebar
  - Logos por slug em `app-sidebar.tsx` via imports estáticos (lush, altana, andar-de-cima, tout)
  - Componente `UnitLogo` com fallback para inicial do nome
  - Suporte a `darkBg` para logos que precisam de fundo escuro (Altana)
- **LHG-91:** Agente RM: Feedback loop explícito na memória estratégica + seletor de unidade nos guardrails
  - `buildStrategicMemoryBlock` agora recebe `kpiAfter` e `kpiBefore` (já buscados em paralelo) e exibe tabela explícita "Resultado observado após última mudança de tabela" com Δ de RevPAR, TRevPAR, Giro, Ocupação e Ticket Médio — zero latência extra
  - `GuardrailsManager`: seletor de unidade (`Building2` + `Select`) navega via `router.push(?unit=slug)`, aparece apenas quando há 2+ unidades
  - `admin/page.tsx`: passa `units[]` (id, name, slug) para `GuardrailsManager`

- **LHG-92:** Proposals: filtro de status + simulação de impacto no ticket médio
  - Filtros por status (Todas/Pendentes/Aprovadas/Rejeitadas) com contador, pill buttons acima da lista
  - `calcImpact()`: conta aumentos/reduções/sem mudança e calcula Δ% do ticket médio (volume constante)
  - Mini resumo no header colapsado: ↑X aumentos · ↓Y reduções · ticket médio +Z% (volume constante)
  - Painel de simulação no rodapé expandido: ticket atual → projetado → Δ% por locação
  - Hipótese "volume constante" explícita em todos os lugares
- **LHG-93:** Admin: configuração do agente RM por unidade (estratégia, variação máxima, foco)
  - Migration: `pricing_strategy` (conservador/moderado/agressivo), `max_variation_pct` (5–30%), `focus_metric` (revpar/ocupacao/ticket) em `rm_agent_config`
  - `GET/PATCH /api/admin/agent-config`: lê e atualiza config por unidade; cria config padrão se não existir
  - `AgentConfigManager`: UI com seletor de estratégia (cards coloridos), slider de variação, radio de foco + resumo + seletor de unidade
  - Nova aba "Agente RM" (Settings2) em `/dashboard/admin`
  - Prompt de geração injeta `agentConfigBlock` com instruções específicas de estratégia/foco; `max_variation_pct` substitui o hardcoded 30%

- **LHG-94:** Agente RM: Análise de preços de concorrentes via Apify + Claude
  - **Modo Cheerio** (estático): `website-content-crawler` síncrono, timeout 50s, max 3 páginas
  - **Modo Playwright** (interativo): `playwright-scraper` **assíncrono** — POST inicia run Apify e retorna `{ status: 'processing', runId }` imediatamente; GET `?runId=...` faz polling do status e extrai preços quando SUCCEEDED (evita timeout Vercel 60s)
  - `buildPlaywrightPageFunction`: captura preços do dia atual + tenta navegar calendário para próxima sexta (semana × FDS); dois passes com advance de mês
  - Polling no frontend (`startPolling`): a cada 4s por até 120s, mostra "Playwright…" no botão
  - GET `/api/agente/competitor-analysis`: sem `runId` = lista snapshots; com `runId` = polling de run assíncrono
  - `rm_agent_config.competitor_urls: [{name, urls: [{url, label}], mode: 'cheerio'|'playwright'}]` — múltiplas URLs por concorrente
  - **Compatibilidade retroativa:** `normalizeCompetitor()` converte formato antigo `{url: string}` → `{urls: [{url}]}`
  - **Campo `url` deprecated** em `CompetitorUrl` — usar `urls[]`; `normalizeCompetitor()` no frontend lida com ambos
  - **Análise em background**: snapshot salvo com `status: 'processing'` antes da análise Apify; atualizado para `done` ao concluir; componente retoma polling automaticamente ao remontar
  - **8 métricas de foco**: balanceado, agressivo, revpar, giro, ocupacao, ticket, trevpar, tmo
  - DB: constraint `rm_agent_config_focus_metric_check` atualizada via migration Supabase MCP
  - `AgentConfigManager`: toggle Estático/Interativo no formulário; múltiplas URLs por concorrente na UI; tabela de preços expansível por concorrente (categoria, período, dia, preço, nossa categ.); `initialConfig=null` faz auto-fetch via GET
  - **Gear icon (Settings2) no header do Agente RM**: abre Sheet lateral com `AgentConfigManager` completo; visível para `super_admin` e `admin`; `agente/page.tsx` passa `userRole` e `units[]` para `AgenteChatPage`
  - POST `/api/agente/proposals`: injeta snapshots dos últimos 7 dias no prompt como referência de mercado
  - `APIFY_API_TOKEN` configurado em `.env.local` e na Vercel

- **LHG-95:** Fix: Propostas aprovadas não podiam ser excluídas
  - Root cause: Next.js retorna 405 quando não existe handler `DELETE`; o frontend não verificava o status HTTP
  - Fix: adicionado handler `DELETE` correto em `/api/agente/proposals/route.ts` usando admin client
- **LHG-96:** Fix: Erro de JSON ao importar planilha do Lush Ipiranga (encoding Windows-1252)
  - Root cause: `FileReader.readAsText(file, 'utf-8')` em CSV Windows-1252 produz `\uFFFD` — modelo recebia CSV corrompido
  - Fix: detecta contagem de `\uFFFD > 3` e re-lê com `windows-1252`; limite CSV 8k→24k; tokens 8k→16k
- **LHG-97:** UX: Lazy loading / skeleton entre transições de páginas
  - `loading.tsx` em `src/app/dashboard/`, `src/app/dashboard/agente/` e `src/app/dashboard/precos/`
  - Next.js App Router usa esses arquivos como Suspense fallback automático durante render do Server Component
  - Skeleton com `animate-pulse` que imita o layout de cada página
- **LHG-98:** Infra: Migrar de Vercel AI Gateway para OpenRouter
  - Substituído `gateway()` de `'ai'` por `createOpenRouter` de `@openrouter/ai-sdk-provider`
  - `OPENROUTER_API_KEY` — nova variável de ambiente (`.env.local` + Vercel)
  - IDs de modelo com hífen: `anthropic/claude-sonnet-4-5`, `google/gemini-2.0-flash`
  - `gatewayOptions` exportado como `{}` para manter assinatura compatível com todas as rotas
- **LHG-99:** Agente RM: Análise de concorrentes — múltiplas URLs + análise em background
  - Modelo de dados: `CompetitorUrl.urls: CompetitorUrlEntry[]` (era `url: string`) com retrocompat via `normalizeCompetitor()`
  - Background: snapshot `status: 'processing'` salvo antes da análise; `status: 'done'` ao concluir
  - Frontend retoma polling automaticamente para runs `processing` ao remontar (sobrevive navegação)
- **LHG-100:** Preços: Política de descontos do Guia de Motéis na importação de planilhas
  - Prompt expandido com PARTE 2: extrai regras de desconto (`canal, categoria, periodo, dia_tipo, tipo_desconto, valor, condicao`)
  - `ParsedDiscountRow` type em `import-prices/route.ts`; coluna `discount_data JSONB` em `price_imports`
  - Preview de descontos na UI com ícone `Tag` antes de confirmar importação
  - Propostas injetam bloco de descontos no prompt quando disponível
- **LHG-101:** Preços: Fila de importação em background com múltiplas planilhas e notificações
  - Tabela `price_import_jobs` (status: pending/processing/done/failed, apify-style queue)
  - `PriceImportQueue` substitui `PriceImport`: seleção múltipla, vigência por arquivo, polling a cada 8s
  - PATCH `/api/agente/import-queue` processa próximo job pendente — chamado pelo frontend via polling
  - Notificação in-app ao concluir (`type: 'success'`) ou falhar (`type: 'error'`)
  - Histórico de jobs com ícones de status (pending/processing/done/failed) e timestamp de conclusão
- **LHG-102:** Fix: OpenRouter — enforce modelos gratuitos + reduzir maxOutputTokens
  - Root causes: modelo sem `:free` cobrava créditos; `maxOutputTokens` excedia limites do tier
  - `STRATEGY_MODEL = openrouter('nvidia/nemotron-3-super-120b-a12b:free')` | `ANALYSIS_MODEL = openrouter('openai/gpt-oss-120b:free')`
  - Regra: STRATEGY_MODEL ≤ 2500 tokens; ANALYSIS_MODEL ≤ 8000 tokens; sempre sufixo `:free`
  - Modelos gratuitos disponíveis atualizados: `nvidia/nemotron-3-super-120b-a12b:free`, `openai/gpt-oss-120b:free`, `minimax/minimax-m2.5:free`, `google/gemma-4-31b-it:free`
- **LHG-103:** Fix: Responsividade da UI de configuração do agente RM
  - Cards de estratégia: `grid-cols-3` → lista vertical com radio-dot + label + descrição
  - Formulário de concorrentes: inputs empilhados verticalmente, toggle em `flex-col`
  - Prop `compact?: boolean` em `AgentConfigManager` oculta header interno (usado no Sheet do agente)
- **LHG-104:** Agente RM: UX do chat — steps animados na geração, quick replies e agendamento pós-aprovação
  - `ProposalGeneratingSteps`: 4 etapas animadas (1.4s cada) no lugar do chip genérico da tool `salvar_proposta`
  - Tool `agendar_revisao` removida do chat; agendamento somente via aba Propostas
  - Agendamento com `Calendar` + `Input type="time"` em Popover — abre automaticamente após aprovação
  - System prompt atualizado: aprovação e agendamento fora do chat; `sugerir_respostas` atualizado
- **LHG-105:** Fix + Feat: Supabase Realtime completo + fix delete de tabela importada
  - Realtime adicionado: `price_proposals` e `scheduled_reviews` com filtro `unit_id`; `agente-page-client.tsx` passa `unitId` para ambos os componentes
  - Bug fix FK: `price_import_jobs.result_id → price_imports.id` era `NO ACTION` → migração `fix_price_import_jobs_result_id_fk_set_null` altera para `ON DELETE SET NULL`
  - `price-list.tsx handleDelete`: verifica `res.ok` antes de chamar `onDeleted()` — evitava remoção visual com erro HTTP
- **LHG-106:** Preços: Fluxos separados de importação (preços vs descontos) + botão excluir histórico
  - Coluna `import_type TEXT DEFAULT 'prices' CHECK (IN ('prices','discounts'))` em `price_imports` e `price_import_jobs`
  - `precos-tabs.tsx`: duas seções independentes — "Tabelas de Preços" e "Tabelas de Descontos", cada uma com `PriceImportQueue(importType)` + Tabs (tabelas | histórico)
  - `ImportJobHistory`: botão Trash2 por linha + `AlertDialog` de confirmação; oculto para jobs `processing`
  - DELETE `/api/agente/import-queue?id=` com guard de status e verificação de unidade
- **LHG-107:** Preços: Confirmação de importação antes de salvar (status needs_review)
  - Novo status `needs_review` + coluna `parsed_preview JSONB` em `price_import_jobs` (migration)
  - Fluxo: `pending → processing → needs_review → done/failed`
  - PATCH com `action: 'confirm' | 'reject'` salva em `price_imports` ou descarta
  - Polling pausa automaticamente enquanto há jobs `needs_review` (evita loop)
  - UI: card âmbar com tabela expandível de preços/descontos extraídos + botões Confirmar/Rejeitar
  - Notificação `info` ao chegar em `needs_review`; `success` ao confirmar
  - GET do import-queue inclui `parsed_preview` no SELECT
  - Fallback servidor: se modelo pôs descontos em `rows` → move para `discount_rows`
- **LHG-108:** Descontos: rota dedicada `/dashboard/descontos` na sidebar
  - Nova página `src/app/dashboard/descontos/page.tsx` com loading skeleton próprio
  - Sidebar: item "Descontos" com ícone `Percent` entre Preços e Disponibilidade
  - `precos-tabs.tsx` simplificado: remove seção de descontos e `Separator`
  - `proposals/route.ts`: `activeImport` filtra apenas imports com `parsed_data > 0`; `activeDiscounts` coleta de TODOS os imports ativos (campo `discount_data` antigo + imports `import_type='discounts'`)
- **LHG-109:** Fix: Prompt de extração de descontos — terça-feira e mesclagem de faixas horárias
  - Modelo pulava dias com valores iguais (ex: terça = segunda) e não mesclava faixas horárias iguais
  - Prompt: regra explícita "NUNCA omitir dia mesmo que valores sejam idênticos"; exemplo JSON mostra segunda E terca com valor=30
  - Mesclagem: `00:00-17:59` + `18:00-23:59` mesmo valor → `00:00-23:59`; valores diferentes → 2 linhas
  - Fallback: `discount_rows` vazio mas `rows` preenchido → move automaticamente
  - Log do texto bruto nos erros de parse para facilitar diagnóstico
  - **Armadilha:** prompts em inglês quebram extração nesses modelos gratuitos — manter em português
- **LHG-110:** Notificações: link de navegação para rota de origem + fix realtime
  - Migration: coluna `link TEXT` em `notifications` + `ALTER PUBLICATION supabase_realtime ADD TABLE notifications`
  - `import-queue`: link `/dashboard/precos?unit=` ou `/dashboard/descontos?unit=` nos 3 inserts (sucesso, needs_review, erro)
  - `cron/revisoes`: link `/dashboard/agente?unit=&conv=` com ID da conversa gerada
  - `notifications-bell`: `useRouter` + `router.push(n.link)` fecha popover e navega ao clicar
  - Fix realtime: tabela não estava na publication `supabase_realtime`; filtro `user_id=eq.{uid}` garante entrega apenas para o usuário correto
- **LHG-111:** Fix: Parser de descontos — novo formato de planilha + formato compacto para evitar truncamento
  - Root cause 1: células mescladas no Excel → CSV vazio → terça ausente, categorias ausentes, Casa Lush com desconto indevido
  - Solução: novo formato de planilha onde cada célula tem valor explícito (`"10% - PERIODO: 3H, 6H E 12H"` ou `"-"`) — sem ambiguidade
  - Root cause 2: ~162 linhas flat excediam `maxOutputTokens`
  - Formato compacto `{"grupos":[{"categorias":[],"dia_semana":"","faixa_horaria":"","descontos":{}}]}` → ~14 grupos (~10x menos tokens)
  - `expandCompactDiscounts()` expande grupos → `ParsedDiscountRow[]` server-side
  - `extractDiscountJSON()`: suporta formato compacto + recovery de JSON truncado (fecha no último item completo)
  - Remove `preprocessDiscountCSV()` — não necessário com novo formato
- **LHG-112:** Agente RM: seletor de período único com Calendar range + resolução automática de tabelas
  - UI: substitui "Tabela A / Tabela B" por um único `DateRangePicker` (`Calendar mode="range" numberOfMonths={2}`)
  - Backend (`/api/agente/chat`): recebe `dateFrom`/`dateTo` (YYYY-MM-DD) e resolve qual import de preços estava vigente em cada extremo via query bi-temporal (`valid_from <= date AND valid_until IS NULL OR >= date`)
  - Tabela única no range: KPIs para o período completo, contexto simples
  - Duas tabelas no range: KPIs divididos na fronteira de vigência; gera `vigenciaInfo` com duração de cada período
  - Assimetria detectada (`|diasA - diasB| > 7`): agente obrigado a usar `sugerir_respostas` para perguntar estratégia de comparação antes de analisar
  - Desconto do Guia resolvido automaticamente (`import_type='discounts'`) e injetado no contexto
  - Modo legado (`startDate`/`endDate` DD/MM/YYYY) mantido para retrocompat com cron
  - `VigenciaInfo` exportado de `system-prompt.ts`
- **LHG-113:** Fix + UX: Agente RM — envio duplicado, thinking bubble, frase duplicada, propostas
  - Fix `isSubmittingRef`: bloqueia `submit()` durante await de criação de conversa (evita race condition Enter duplo)
  - `ThinkingBubble`: dots bounce 3px + frase contextual rotativa (3.5s, sem reticências escritas) substitui spinner genérico
  - Mensagem em branco eliminada: ignora mensagens assistant sem parts visíveis (step intermediário do AI SDK)
  - Frase "A proposta foi salva" não duplica mais: system prompt instrui a não repetir no texto
  - `handleProposalSaved` troca automaticamente para aba Propostas ao salvar
  - Botão "Ir para aba Propostas" nos quick replies navega via `onNavigateToProposals` (texto `__propostas`)
  - `ProposalsList` carrega na montagem independente de `refreshKey`
- **LHG-114:** Agente RM: regra de consistência estrutural nas propostas — modelo de 2 tabelas fixas
  - Regra 9 no system prompt: proposta deve sempre seguir estrutura da tabela ativa (`semana` e `fds_feriado`)
  - Definição explícita: semana = dom 06:00→sex 05:59 / fds_feriado = sex 06:00→dom 05:59
  - Nunca por hora específica nem dia individual; só altera modelo se usuário pedir explicitamente
  - Seção "Modelo de precificação atual" com 4 regras operacionais para geração de propostas
- **LHG-116:** fix(agente): background streaming via onFinish server-side — sem duplicação de propostas
  - Root cause: BackgroundStreamer client-side causava propostas duplicadas (re-enviava a mesma mensagem ao servidor)
  - `DefaultChatTransport.body` como **função**: `resolve(body)` é chamado a cada request → `convId` incluído dinamicamente sem recriar o hook
  - `streamText.onFinish` no route: dispara mesmo com cliente desconectado (Vercel); se `req.signal.aborted && convId`, salva resposta + cria notificação in-app
  - `BackgroundStreamer` removido; `AgentStreamingProvider` virou passthrough
  - **Falso positivo:** hook de validação marca `"YYYY-MM-DD"` em schemas Zod como "model slug com hífens" — ignorar
- **LHG-115:** fix + feat(agente): background streaming, scroll manual, conv vazia, heatmap default Todas
  - **Heatmap:** filtro Data interno (`heatmap.tsx`) abre em "Todas" por padrão — `urlDateType` fallback `'all'`
  - **Dashboard:** filtro Data do `date-range-picker.tsx` mantém "Entrada" como padrão — são controles distintos
  - **Armadilha:** heatmap tem filtro interno próprio (independente da URL); `date-range-picker` controla o dashboard; nunca confundir os dois
  - **Scroll:** `userScrolledUpRef` — auto-scroll para quando usuário scrolla manualmente; retoma ao enviar nova mensagem
  - **Bug conv vazia:** `rm_conversations` agora criada com a mensagem do usuário já salva (não `messages: []`), evitando histórico vazio ao navegar durante streaming
  - **Background streaming:** `streamText.onFinish` no route server-side; `BackgroundStreamer` removido (causava propostas duplicadas)
    - Ao concluir com cliente desconectado: salva mensagens no DB + cria notificação in-app com `link: /dashboard/agente?conv={convId}`
    - **Armadilha:** `UIMessage` do AI SDK não tem campo `content` — usar apenas `id`, `role` e `parts`
- **LHG-117:** fix(agente+dashboard): proposta não redireciona para aba + defaults corretos de filtro Data
  - **Bug:** `handleProposalSaved` chamava `setActiveTab('propostas')` — jogava usuário para fora do chat após salvar proposta
  - **Fix:** removido o redirect automático; aba Propostas atualiza em background; agente pode sugerir navegar via quick reply
  - **Armadilha:** `handleProposalSaved` deve apenas atualizar dados, nunca mudar aba automaticamente
- **LHG-119:** feat(agente): raciocínio explícito + período sob medida + descontos obrigatórios no prompt
  - Regra 10: agente explica em 2–4 frases quais dados usa, por que a abordagem é adequada e hipótese central — antes de qualquer análise
  - Framework: novo passo 1 (Raciocínio) e passo 5 (Impacto dos descontos)
  - vigenciaBlock: SEMPRE pergunta como comparar tabelas (não só assimétrico) — 3 opções com explicação do que cada uma revela
  - Regra 8 fortalecida: preço efetivo = base − desconto obrigatório nas justificativas do canal `guia_moteis`
- **LHG-118:** feat(agente): recovery de conversa via Realtime + período automático sem date picker
  - Removido seletor de período do chat — backend auto-detecta as 2 tabelas mais recentes e monta KPIs por vigência
  - Se 1 tabela: KPIs desde `valid_from` até hoje; se 2 tabelas: KPIs divididos na fronteira com `vigenciaInfo`
  - Modo legado `startDate/endDate` DD/MM/YYYY mantido para cron/revisões
  - Realtime subscription em `rm_conversations` quando conversa ativa aguarda resposta (última msg é do usuário)
  - Ao receber `UPDATE` do banco (onFinish do servidor), remonta o chat automaticamente
  - Indicador de 3 dots na sidebar para conversas aguardando; `AwaitingBubble` com input desabilitado no chat
  - `handledConvParam` ref evita loop ao receber `?conv=` repetidamente
  - **Armadilha:** Realtime só subscreve quando `isAwaitingResponse(msgs)` — não subscrever desnecessariamente
- **LHG-39:** fix(agente): scraping de concorrentes via calendário com clique em coluna de dia
  - Reescrita de `buildPlaywrightPageFunction` — site moteisprime usa textbox DD/MM/YYYY e calendário JS (não `input[type="date"]`)
  - Estratégia: clica no ícone `img[alt="Escolha a Data"]`, navega por índice de coluna da tabela (Dom=0…Sab=6)
  - Captura terça (semana, col 2) e sábado (FDS, col 6) com fallback para outros dias
  - Remove `nextFridayDate()` e toda lógica antiga baseada em `input[type="date"]`
- **LHG-55:** feat(agente): contexto climático via OpenWeatherMap
  - `src/lib/agente/weather.ts`: clima atual + previsão 3 dias; retorna null se `OPENWEATHERMAP_API_KEY` ausente
  - `buildSystemPrompt` aceita `weatherContext` (5º param); injeta bloco `## Clima` no system prompt
  - `chat/route.ts`: busca `city` da `rm_agent_config` + clima antes de montar o prompt
  - `rm_agent_config.city TEXT DEFAULT 'Campinas,BR'` — migration + campo na UI do `AgentConfigManager`
  - Cidades configuradas no banco: andar-de-cima/lush-ipiranga/lush-lapa → `Sao Paulo,BR`; altana → `Brasilia,BR`; tout → `Campinas,BR`
  - **Variável necessária:** `OPENWEATHERMAP_API_KEY`
- **LHG-58:** feat(agente): eventos locais via Ticketmaster/Sympla
  - `src/lib/agente/events.ts`: Ticketmaster (primário, `TICKETMASTER_API_KEY`) e Sympla (fallback, `SYMPLA_TOKEN`)
  - Busca por `city` (nome da cidade configurado em `rm_agent_config.city`) — busca por CEP foi descartada (cobertura insuficiente no Brasil)
  - Busca eventos próximos 14 dias; retorna null se nenhuma key configurada — não quebra o agente
  - `buildSystemPrompt` aceita `eventsContext` (6º param); clima + eventos buscados em paralelo
  - **Variáveis opcionais:** `TICKETMASTER_API_KEY` e/ou `SYMPLA_TOKEN`
  - `EventsWidget` no dashboard com 4 estados: `unconfigured` (silencioso), `error` (XCircle + msg), `empty` ("Nenhum evento via {source}"), `ok` (lista agrupada por data, FDS destacado em âmbar)
  - `fetchEventsResult` retorna discriminated union `EventsResult` — sem exceção silenciosa
- **LHG-120:** feat: Página de Concorrentes dedicada na sidebar
  - Análise de concorrentes extraída do `AgentConfigManager` (que ficou só com config do agente)
  - Nova rota `/dashboard/concorrentes` — segue padrão das páginas Preços/Descontos
  - `src/components/concorrentes/competitor-analysis-manager.tsx`: CRUD completo de URLs, polling Playwright, tabela de snapshots por concorrente
  - `src/app/dashboard/concorrentes/page.tsx` + `loading.tsx`: server component com auth check (manager+)
  - Sidebar: item "Concorrentes" com ícone `Globe` entre Descontos e Disponibilidade
  - `AgentConfigManager`: campo `city` com descrição clara dos 3 usos (clima, previsão, eventos); campo `postal_code` removido
- **fix(ci):** GitHub Actions — workflow migrations.yml
  - Pinado CLI Supabase v2.84.2 (igual ao local) — `version: latest` causava breaking changes
  - Adicionado `SUPABASE_ACCESS_TOKEN` como env var
  - **Fix IPv6:** runners do GitHub não têm IPv6 — `--db-url` (TCP/5432) falhava com `connect: no route to host`
  - Substituído `supabase db push --db-url "$SUPABASE_DB_URL"` por `supabase link --project-ref pvlcktqbjianrbzpqrbd && supabase db push` (usa HTTPS/443)
- **LHG-121:** fix(agente): recovery de resposta em background — race condition de Realtime
  - Root cause: `onFinish` salvava UPDATE no banco enquanto usuário ainda não havia clicado na conversa → evento Realtime disparava antes da subscription existir → UPDATE perdido → `AwaitingBubble` permanente
  - Fix 1 — fresh fetch após criar subscription: logo após criar o canal Realtime, consulta o banco diretamente; se já há resposta, aplica sem depender do evento
  - Fix 2 — `visibilitychange` listener: ao voltar para a aba, recarrega conversas — captura respostas já salvas em background
  - Fix 3 — `loadConversations` detecta conversa selecionada que estava aguardando e agora está resolvida → atualiza `selectedMessages` + incrementa `chatKey` (remonta o chat)
  - **Armadilha:** subscription deve ser criada ANTES do fresh fetch para não perder evento durante a janela de transição
- **LHG-122:** fix(model): ANALYSIS_MODEL → openai/gpt-4.1-mini via BYOK OpenRouter
  - Root cause: `openai/gpt-oss-120b:free` atingia limite diário de `free-models-per-day` do OpenRouter
  - Usuário adicionou chave OpenAI própria como BYOK no OpenRouter → sem limite de quota gratuita
  - `ANALYSIS_MODEL = openrouter('openai/gpt-4.1-mini')` — sem sufixo `:free`; faturado pela chave BYOK do usuário
  - Fallback mantido em `nvidia/nemotron-3-super-120b-a12b:free` para degradação segura
- **LHG-123:** fix(eventos): substituir Ticketmaster/Sympla por Apify scraping + filtro de relevância
  - Root causes: Ticketmaster sem cobertura no Brasil (0 eventos); Sympla `s_token` é API de organização — retorna apenas eventos próprios, não descoberta pública
  - `events.ts` reescrito: usa Apify `website-content-crawler` em modo Playwright na busca pública do Sympla (`sympla.com.br/pesquisar?d={city}`)
  - `parseEventsWithAI`: usa `ANALYSIS_MODEL` com filtro de relevância — só shows, concerts, esportes, festivais, eventos culturais >500 pessoas (exclui workshops, cursos, meetups)
  - Cache em `rm_agent_config.events_cache JSONB` com TTL 4h; refresh em background via `after()` do Next.js
  - `POST /api/agente/events-refresh`: endpoint on-demand para o botão "Atualizar" no widget
  - `events-widget.tsx`: prop `unitId?`, botão "Atualizar" com spinner nos 3 estados (error/empty/ok)
  - `cron/revisoes`: fix timing — `lte(endOfToday)` evita perder revisões agendadas mais tarde no dia; refresh de eventos para todas as unidades ao final do cron
  - **Desabilitado temporariamente** (Apify atingiu limite mensal 2026-04-17) — eventos removidos do dashboard e do system prompt do agente; código dormante em `events.ts` para reativação futura
- **LHG-124:** feat(concorrentes): modo Guia GM — API estruturada + comodidades automáticas
  - Novo modo `'guia'` em `competitor-analysis/route.ts`: detecta `var suiteid = \d+` no HTML da página, chama `guiasites.guiademoteis.com.br/api/suites/Periodos/{id}` diretamente
  - Sem IA, sem Apify — gratuito e instantâneo; retorna periodos (3h/6h/12h) + pernoites com valor e descrição
  - API retorna dados para ~20 dias futuros (não só a data solicitada) — usar `dataExibicao` para classificar dia da semana; mediana por grupo período×dia_tipo elimina duplicatas
  - `tempoToPeriod`: usa valor literal da API (`${h}h`) — não faz bucketing; FDS = apenas sex(5)+sáb(6); dom(0) = semana
  - `nameFromSlug`: regex `suites?-` (singular E plural) para extrair nome do slug — sem depender do `<title>` ou `<h2>`
  - `isSuitePage`: `/suites?-/i.test(pathname)` — detecta páginas de suíte em ambos os formatos
  - Regex de href para descoberta de suítes: `suites?-[a-z0-9-]+` + `new URL(href, base)` para resolver URLs relativas
  - Amenities regex: `/[Ee]ssa\s+su[ií]te\s+tem|[Aa]\s+su[ií]te\s+possui/i` — compatível com Drops Campinas e Moteisprime
  - `amenitiesBySuite: Record<string, string[]>` salvo no `raw_text` JSON do snapshot
  - **Armadilha:** `<title>` e `<h2>` em páginas de motel retornam o nome do motel, não da suíte — slug é a única fonte confiável
  - **Armadilha:** API do Guia retorna múltiplos dias, não apenas a data solicitada — somar tudo gera duplicatas
  - Chama API duas vezes (próxima terça + próximo sábado com `?data=DD-MM-YYYY`); se preços divergem → semana/fds_feriado; se iguais → todos
  - `CompetitorSnapshot.amenities?: string[]` populado no GET handler via parse do `raw_text`
  - Frontend: toggle de 3 botões (Padrão/Guia GM/Interativo), auto-detecção de URLs moteisprime/guiademoteis, blocos por suíte com pills de comodidades + tabela pivotada (Período × Dom–Qui | Sex–Sáb)
  - Prompt de propostas E prompt de chat: incluem comodidades e instrução de comparação equivalente (hidro vs hidro, piscina vs piscina)
  - `CompetitorUrl.mode` atualizado para `'cheerio' | 'playwright' | 'guia'` em `agent-config/route.ts`
  - `chat/route.ts`: snapshots dos últimos 7 dias buscados em paralelo com clima; `competitorBlock` markdown appended ao system prompt

- **LHG-125:** feat(admin+agente): comodidades das suítes por categoria
  - `suite_amenities JSONB DEFAULT '{}'` em `rm_agent_config` — estrutura `{ "CATEGORIA": ["Comodidade 1", ...] }`
  - UI: seção "Comodidades das suítes" no `AgentConfigManager` — textarea por categoria (uma comodidade por linha), save dedicado
  - Chat + propostas: bloco `## Comodidades das nossas suítes` injetado no system prompt em paralelo com clima e concorrentes
  - Regras 11 e 12 no system prompt: agente só compara comodidades quando o bloco estiver presente; nunca inventa
- **LHG-126:** feat(configurações): página de configurações do sistema
  - Migração: `display_name TEXT` + `notification_preferences JSONB` em `profiles`; `timezone TEXT DEFAULT 'America/Sao_Paulo'` em `rm_agent_config`
  - `GET /api/admin/integrations`: status de 10 integrações (ERP, OpenRouter, Apify, OpenWeather, Ticketmaster, Sympla, Guia, E-Commerce, Booking, Expedia) — verifica presença de env vars server-side
  - `PATCH /api/admin/profile`: atualiza `display_name`
  - `PATCH /api/admin/notification-preferences`: salva preferências por tipo de notificação
  - `/dashboard/configuracoes` com 4 abas: Perfil (todos), Notificações (todos), Unidade (admin+), Integrações (super_admin)
  - Auto-save nos toggles de notificação via Switch shadcn
  - Unidade: fuso horário (9 fusos BR) + cidade para clima/eventos por unidade
  - Integrações futuras ("Em breve"): Guia de Motéis, Site E-Commerce, Booking.com, Expedia
  - Sidebar: item Configurações habilitado (era opaco/não clicável)

- **LHG-126:** feat(dashboard): widget de clima com previsão 6 dias, colapso e insight de IA
  - `fetchWeatherData()` em `weather.ts` retorna `WeatherResult` estruturado (ok/error/unconfigured); previsão `cnt=56` → 6 dias
  - `WeatherWidget`: temperatura atual, descrição, umidade, vento + cards de previsão 6 dias (hoje + 6 = 1 semana)
  - Fins de semana (Sex/Sáb/Dom) destacados em âmbar — relevante para precificação dinâmica
  - Header clicável para colapsar — estado persiste em `localStorage['weather-collapsed']`; inline temp/descrição quando colapsado
  - Prop `insight?: string | null` — footer dinâmico com ícone Sparkles; null mostra "Gerando análise…" em itálico
  - Fetched em paralelo com KPIs no server component via `Promise.all`; oculto se `OPENWEATHERMAP_API_KEY` ausente
  - Posicionado entre os filtros de data e os cards de KPI no dashboard
  - `src/lib/agente/weather-insight.ts`: `getWeatherInsight` verifica cache 4h em `rm_agent_config.weather_insight_cache`; se vencido dispara `after()` background com `generateAndSave`; `buildCorrelationContext` lê `rm_weather_observations` (≥7 dias) e calcula médias reais por condição para enriquecer o prompt da IA
  - `rm_weather_observations`: tabela com RLS — registra diariamente clima + KPIs de ontem via cron (`recordWeatherObservation`); `categorizeWeather()` classifica descrição PT em 6 buckets
  - `run-reviews.ts`: após refresh de eventos, registra observação por unidade com KPIs do dia anterior
  - KPI cards drag-and-drop: `@dnd-kit/core` + `@dnd-kit/sortable` com `rectSortingStrategy`; ordem persiste em `localStorage['kpi-cards-order']`
  - Agente RM: tela inicial personalizada com saudação dinâmica (Bom dia/tarde/noite + primeiro nome) baseada no fuso horário da unidade
  - Propostas: `manager` só pode visualizar e agendar/reagendar revisão; `admin`/`super_admin` têm acesso completo (gerar, aprovar, rejeitar, editar, excluir)

- **LHG-126:** fix(kpis): alinhar cálculo de previsão e filtro de status com o Analytics
  - Boundary do mês-a-mês corrigido: `monIsoStart` usa corte operacional `06:00` (era meia-noite); `monIsoEnd = hoje 06:00:00` (era `ontem+1 meia-noite`) — alinha com Analytics
  - `queryDataTableSuiteCategory`: `FINALIZADA` hardcoded no WHERE principal substituído por `${statusFilter}` dinâmico

- **LHG-50:** Deploy produção + onboarding unidades piloto ✅
  - App em produção na Vercel; acesso controlado via sistema invite-only (LHG-83)
  - Onboarding operacional: convites enviados via `/dashboard/admin` pelo super_admin

- **LHG-127 (Linear: LHG-125):** Dashboard: UX polish — seletor de período, filtros imediatos e tabelas interativas
  - **Seletor de período redesenhado:** presets fixos (Últ. 7 dias / Este mês / Último mês fechado) como botões com variant `default` quando ativo; botão Personalizado exibe `DD/MM → DD/MM` quando ativo; separador visual entre fixos e personalizado
  - **Filtros imediatos:** botão "Aplicar" removido — clicar em qualquer preset, alterar horário, status ou tipo de data navega imediatamente; `useTransition` + `pendingFilter` controlam estado de loading
  - **Loading inline:** `Loader2` (spin) aparece apenas no botão/controle clicado; container fica `opacity-60 pointer-events-none` durante transição; `isPending && setPendingFilter(null)` limpa ao concluir
  - **Fix presets:** `7d` e `this-month` usam `today` como upper bound (alinhado ao LHG Analytics); antes usava `yesterday`, causando 13+ locações / ~R$ 13k de diferença
  - **Sort + drag-and-drop nas 3 tabelas de categorias** (`charts.tsx` → `'use client'`): headers clicáveis (1° desc, 2° asc, 3° reset), `GripVertical` ao hover reordena via `@dnd-kit`; sort e drag são mutuamente exclusivos; ordens persistem em `localStorage` (`suite-cat-order`, `giro-week-order`, `revpar-week-order`)
  - **fix(weather):** `forecast` filtra com `date > cutoff` (era `>= cutoff`); garante que "hoje" entra como 1° card mesmo que a API já tenha dados parciais — previsão 6 dias reais (hoje + 5 dias futuros)

- **LHG-128:** fix(kpis): alinhar corte operacional 06:00 em todas as queries + valortotal na categoria
  - **Corte operacional 06:00 em helpers:** `ddmmyyyyToIso`, `addDays`, `shiftMonths` — todos retornam `YYYY-MM-DD 06:00:00` em vez de meia-noite; alinha com Analytics
  - **Período aberto vs fechado:** `isoEnd` usa `today 06:00` quando `endDate = hoje BRT` (este-mês, 7d) — inclui apenas dias operacionais completos; usa `(endDate+1) 06:00` para períodos fechados (último mês, custom passado)
  - **"Últimos 7 dias":** `start = today - 7` (era `-6`) → 7 dias completos; upper bound `today 06:00` (era `addDays(today,1)` = amanhã 06:00)
  - **Previsão de fechamento:** `monIsoStart = dia 1 06:00`; `monIsoEnd = hoje 06:00` (eram meia-noite); alinha com Analytics
  - **`queryDataTableSuiteCategory` — Faturamento:** substituído `la.valorliquidolocacao` por `la.valortotal` (locação + consumo - desconto, pré-calculado no ERP); CTE `receita_consumo` e LEFT JOIN removidos; `rental_revenue = valorliquidolocacao` mantido como coluna separada para base do RevPAR
  - **Armadilha:** `la.valortotal` já inclui consumo (`vendalocacao`) e exclui vendas diretas (`vendadireta`); nunca usar fórmula manual com joins de consumo
  - **Total da tabela de categorias:** linha "Total" de Faturamento/Locações/Ticket Médio agora soma as linhas das categorias (`rawRows`) em vez de usar `TotalResult.totalAllValue` (que incluía venda direta); Giro/RevPAR/Ocupação/TMO continuam usando `TotalResult`

- **LHG-129 (Linear: LHG-128):** feat(dashboard): modo de comparação lado a lado entre dois períodos
  - Botão "Comparar períodos" no header do dashboard abre overlay full-screen (`fixed inset-0 z-50`)
  - Dois painéis independentes (Período A e B) com divisor arrastável (min 25% / max 75%)
  - Cada painel contém filtros próprios + KPI cards + tabelas de categoria + heatmap
  - Painel B inicia com mês anterior como default; ESC fecha; scroll do body bloqueado enquanto aberto
  - `src/app/api/dashboard/kpis/route.ts`: nova rota com autenticação por sessão (diferente de `/api/kpis/[unitSlug]` que usa admin client)
  - `comparison-modal.tsx`: split via `style={{ width: \`${split}%\` }}` explícito — `flex-1` não distribui corretamente com Radix internals
  - `kpi-cards.tsx`: prop `compact` força `grid-cols-2` nos painéis — `lg:grid-cols-4` dispara por viewport, não por container
  - `heatmap.tsx`: props `statusOverride` e `dateTypeOverride` para controle independente da URL
  - Painéis usam `div` nativo com `overflow-y-auto` (não Radix ScrollArea) — evita clipping de conteúdo horizontal
  - Scrollbars estilizados via `.scrollbar-thin` e `.scrollbar-none` em `globals.css` (cross-browser, substitui classes Tailwind arbitrárias)

- **LHG-130:** feat(agente): contexto de desempenho por canal no agente RM
  - `src/lib/automo/channel-kpis.ts`: `queryChannelKPIs()` — classifica reservas da tabela `reserva` do Automo em INTERNAL / GUIA_GO / GUIA_SCHEDULED / WEBSITE_IMMEDIATE / WEBSITE_SCHEDULED / BOOKING / EXPEDIA
  - `ChannelKPIRow` adicionado em `types.ts`: `canal`, `label`, `reservas`, `receita`, `ticket`, `representatividade`
  - `buildKPIContext` recebe `channelKPIs?` (5º parâmetro) e renderiza tabela "Desempenho por canal de reserva"
  - `KPIPeriod` inclui `channelKPIs?: ChannelKPIRow[]`; `buildSystemPrompt` passa automaticamente ao `buildKPIContext`
  - `chat/route.ts`: todos os 4 modos (legado, trailing year, 1 tabela, 2 tabelas) buscam channel KPIs em paralelo sem latência extra
  - `proposals/route.ts`: `queryChannelKPIs` adicionado ao `Promise.all` do POST; injetado apenas no período ativo
  - Framework do agente — passo 4 atualizado: "Canal e desconto" — analisa representatividade de GUIA_GO/INTERNAL e sugere ajuste de desconto em texto quando justificado
  - **Armadilha:** `reserva.dataatendimento` usa faixa 00:00–23:59 (diferente das queries de locação que usam 06:00 como corte operacional)
  - **Armadilha:** channel KPIs não filtram por `catIds` (categoria de suíte) — são globais por unidade, pois a tabela `reserva` não tem essa granularidade

- **LHG-131:** feat(dashboard): widgets de mix por canal e período de locação
  - `queryChannelKPIs` chamado em paralelo no server component do dashboard — sem latência extra
  - `ChannelMixTable`: Canal | Reservas | Receita | Ticket Médio | % Receita (sort por coluna, ordem fixa padrão por CANAL_ORDER)
  - `PeriodMixTable`: 3h/6h/12h/Pernoite | Receita | % do Total (usa `BillingRentalType` já presente em `CompanyKPIResponse`)
  - `channelKPIs` prop opcional em `DashboardCharts` — `comparison-panel.tsx` não quebra
  - Ambas as tabelas ocultadas automaticamente quando não há dados (sem tabela vazia)

- **LHG-133 (Linear: LHG-129):** feat(dashboard): tabelas de mix — locações, ticket, drag-and-drop e filtros alinhados
  - **Novas colunas em `PeriodMixTable`:** Locações e Ticket Médio; `BillingRentalTypeItem` agora inclui `locacoes: number` e `ticket: number`; tfoot exibe soma de locações, ticket médio e faturamento
  - **`UNIT_VALID_PERIODS` em `channel-kpis.ts`:** Lush/Tout/Andar de Cima → 3h/6h/12h/Day Use/Diária/Pernoite; Altana → 1h/2h/4h/12h; períodos fora da lista são filtrados
  - **Fix classificação por horário de check-in:** Day Use = h_in BETWEEN 12 AND 14 + dur 5–8h; Pernoite = h_in BETWEEN 19 AND 21 + dur 14–20h; 12 horas = dur 8–14h (catch); implementado via CTE com `dur` e `h_in` pré-calculados — corrigia bug onde 12 horas nunca aparecia
  - **Filtros alinhados com o dashboard:** `queryPeriodMix` e `queryChannelKPIs` respeitam `rentalStatus`, `startHour/endHour`, `dateType` e `isoEnd` BRT-aware — mesma lógica de `fetchCompanyKPIsFromAutomo`
  - **Helpers exportados de `company-kpis.ts`:** `ddmmyyyyToIso`, `addDays`, `buildDateRangeFilter`, `buildStatusFilter`, `buildTimeFilter` — importados em `channel-kpis.ts`
  - **Drag-and-drop de tabelas inteiras:** `SortableTableWrapper` com `useSortable` (@dnd-kit) reordena tabelas entre si; handle `GripHorizontal` inline no header ao hover; ordem persiste em `localStorage['dashboard-tables-order']`; render prop pattern: `children: (handle: ReactNode) => ReactNode`
  - **Armadilha:** `ELSE '12 horas'` no CASE era inalcançável quando Day Use/Pernoite cobriam todos os horários — solução: classificar primeiro por h_in slot, depois por duração

- **LHG-134 (Linear: LHG-130):** fix(kpis): classificação de período unit-aware — totais do Mix por Período alinhados com tabela de categorias
  - Root cause: SQL genérico classificava `dur < 1.5h → '1 hora'` e `dur < 2.5h → '2 horas'` para qualquer unidade; filtro TypeScript `UNIT_VALID_PERIODS` descartava silenciosamente ~917 locações para Lush/Tout/Andar (que não vendem esses pacotes) → totais divergiam: 1.318 vs 2.235 locações
  - **Fix:** `buildPeriodCaseSQL(unitSlug)` gera CASE SQL unit-aware — `LUSH_TYPE_UNITS` colapsa `dur < 5.0 → '3 horas'`; Altana mantém 1h/2h/4h/12h
  - Filtro TypeScript agora só reordena (sem descartar), pois SQL já só emite labels válidos por unidade
  - **Armadilha:** FINALIZADA locações sempre têm `datafinaldaocupacao` preenchido — remover `IS NOT NULL` não era o root cause

- **LHG-132:** feat(descontos): fluxo completo de propostas de desconto com aprovação
  - Migration `discount_proposals` (unit_id, status pending/approved/rejected, context, rows JSONB, conv_id, RLS, Realtime)
  - Tipos regenerados em `database.types.ts` com nova tabela
  - `GET /api/agente/discount-proposals?unitSlug=` — lista propostas por unidade
  - `POST /api/agente/discount-proposals` — gera proposta via IA com contexto canal + preços base + guardrails; clamp server-side garante preco_efetivo >= guardrail_minimo; usa ANALYSIS_MODEL
  - `PATCH /api/agente/discount-proposals` — aprova/rejeita (admin+) ou edita rows (pendente)
  - `DELETE /api/agente/discount-proposals?id=` — exclui proposta (admin+)
  - Tool `salvar_proposta_desconto` no chat: agente salva proposta de desconto quando share do Guia < 15% ou > 40%
  - `DiscountProposalsList`: filtro por status, expand/collapse, tabela com Δ p.p., aprovar/rejeitar/excluir, Realtime
  - Página Descontos: nova aba "Propostas de desconto" como default; importação/histórico em abas secundárias
  - system-prompt: instrução de quando usar `salvar_proposta_desconto` + regra de guardrail
  - **Armadilha:** `supabase gen types typescript --linked` inclui texto do CLI na 1ª e última linha — sempre limpar manualmente
  - **Mudança nesta sessão:** `DiscountProposalsList` movido da página `/dashboard/descontos` para a aba "Propostas" do Agente RM como sub-aba "Descontos Guia de Motéis" (inner Tabs)

- **LHG-135:** fix(proposals): cascade delete de agendas vinculadas ao excluir proposta
  - Root cause: FK `scheduled_reviews.proposal_id` bloqueava delete da proposta com `NO ACTION`
  - Fix: `DELETE /api/agente/proposals` executa `admin.from('scheduled_reviews').delete().eq('proposal_id', id)` antes de deletar a proposta

- **LHG-136:** fix(proposals+discount-proposals): prompt lista períodos válidos — impede modelo de usar 'Todos'
  - Root cause: modelo gerava `periodo: "Todos"` quando não havia lista explícita de valores válidos
  - Fix: injeta `[...new Set(activeRows.map((r) => r.periodo))].join(' | ')` no prompt de propostas de preço e desconto
  - Instrução: "Valores válidos para periodo (copie EXATAMENTE): 3 horas | 6 horas | 12 horas | Diária"

- **LHG-137:** feat(agente): sub-tabs Precificação / Descontos Guia de Motéis na aba Propostas
  - `agente-page-client.tsx`: inner `<Tabs>` dentro de `TabsContent value="propostas"` com duas sub-abas
  - `DiscountProposalsList` movido da página `/dashboard/descontos` para sub-aba "Descontos Guia de Motéis"
  - Página `/dashboard/descontos` simplificada: remove aba de propostas, `defaultValue="tabelas"`

- **LHG-138:** feat(sidebar): loading spinner no seletor de unidade durante troca
  - `app-sidebar.tsx`: `useTransition` + `startTransition` envolve `router.push` no `handleUnitChange`
  - Ícone condicional: `isPending ? <Loader2 animate-spin> : <ChevronsUpDown>`

- **LHG-139:** fix(dashboard): Mix por Canal — receita via novo_lancamento (Site) + representatividade sobre valortotal total
  - Root cause 1: `valorcontratado` não reflete valor cobrado final para canal Site (id=4) — prorrogações/alterações atualizam `novo_lancamento` mas não `valorcontratado`
  - Fix: CTE `valores_website` usa `novo_lancamento` (`versao=0`, `tipolancamento='RESERVA'`, `dataexclusao IS NULL`) como valor oficial para id_tipoorigemreserva=4; demais canais mantêm `valorcontratado`/`valortotalpermanencia`
  - Root cause 2: representatividade era calculada sobre soma dos canais (sempre 100%); corrigido para usar `SUM(la2.valortotal)` de `locacaoapartamento` via `apartamentostate.datainicio` — mesmo denominador do Analytics
  - Date params: `startDate = ddmmyyyyToIso(start).slice(0, 10)`, `endDate = addDays(end, 1).slice(0, 10)` — sem corte 06:00 (Analytics usa BETWEEN por dia)
  - `ChannelMixTable`: linha Total de `% Receita` agora soma as linhas em vez de hardcoded `'100%'`
  - **Armadilha:** `reserva.dataatendimento` usa faixa 00:00–23:59 (sem corte 06:00); `novo_lancamento.id_originado` é o id da `reserva`

- **LHG-140:** perf(dashboard): unstable_cache nas queries Automo + React.memo nas tabelas + cache client-side no heatmap
  - `src/lib/automo/cached-kpis.ts`: novo arquivo com `unstable_cache` (5 min TTL) para `fetchCompanyKPIsFromAutomo`, `queryChannelKPIs` e `queryPeriodMix` — cache key inclui todos os args automaticamente
  - `dashboard/page.tsx`: usa `cachedCompanyKPIs`, `cachedChannelKPIs`, `cachedPeriodMix` — mesmos params, zero mudança de comportamento
  - `charts.tsx`: 5 componentes de tabela pesados (`SuiteCategoryTable`, `GiroWeekTable`, `RevparWeekTable`, `ChannelMixTable`, `PeriodMixTable`) envolvidos com `React.memo` — evita re-render ao reordenar tabelas no drag-and-drop
  - `heatmap.tsx`: `useRef(new Map<string, HeatmapCell[]>())` como cache client-side — evita refetch ao alternar métricas (giro/ocupação/revpar/trevpar) no mesmo período; cache reseta na remontagem (nova unidade/data)

- **LHG-141:** fix(weather): ícones via código OWM + fuso BRT no cutoff da previsão
  - `weather.ts`: coleta `icon` (OWM code ex: "01d") em `WeatherDay` e `WeatherCurrent`; cutoff usa `todayBRT` (BRT) em vez de `yesterday` (UTC)
  - `weather-widget.tsx`: `OWM_ICON_EMOJIS` mapeia primeiros 2 dígitos do icon code (`'01'→☀️`, `'10'→🌦️` etc.) — elimina string matching frágil em PT

- **LHG-142:** fix(weather): "Hoje" via getTodayBRT() client-side + descrição nos mini cards
  - Root cause: OWM `dt_txt` é UTC — à noite BRT a API não retorna mais o dia atual → `idx === 0` marcava errado
  - Fix: `getTodayBRT()` compara `day.date` com a data BRT do cliente
  - Adicionado `day.description` nos mini cards (`text-[10px]`, `line-clamp-2`)

- **LHG-143:** feat(proposals): alinhar layout da aba Precificação com aba Descontos Guia de Motéis
  - `proposals-list.tsx`: filtros de status sempre visíveis (pills `rounded-full border`), formato `Label (N)`
  - Header removido; padrão consistente com `DiscountProposalsList`

- **LHG-144:** fix(proposals): cobertura completa de períodos + maxOutputTokens 6000
  - Root cause 1: `maxOutputTokens: 2500` cortava o JSON antes de cobrir todos os períodos (5 cat × 4 per × 2 canais × 2 dia_tipos facilmente excede 2500 tokens)
  - Root cause 2: `"Omita itens sem dados suficientes"` era ambíguo — modelo pulava períodos sem justificar
  - Root cause 3: nenhuma instrução exigia cobertura dos demais períodos ao alterar uma categoria
  - Fix: `maxOutputTokens` 2500→6000; instrução **COBERTURA OBRIGATÓRIA** no prompt: ao alterar qualquer período de uma categoria, incluir todos os outros com justificativa de manutenção; "Omita" restrito a categorias sem dados no período
  - `proposals-list.tsx`: header mostra "X alteradas / Y linhas"; linhas com `variacao_pct ≈ 0` ficam com `opacity-40`

- **LHG-145:** feat(proposals+agenda): agendamento em propostas de desconto + excluir histórico
  - `discount-proposals/route.ts`: PATCH ao aprovar cria `scheduled_review` automaticamente (+7 dias, 13:00 UTC) com note de descontos — igual às propostas de preço
  - `discount-proposals-list.tsx`: botão "Agendar revisão" com Popover (Calendar + Input time) em propostas aprovadas; header colapsado com "X alteradas / Y linhas"; linhas mantidas (`variacao_pts ≈ 0`) com `opacity-40`
  - `scheduled-reviews-list.tsx`: botão Trash2 para excluir revisões do histórico (done/failed), igual às pendentes

- **LHG-146:** fix(agente): coluna Período nas propostas exibia dia_tipo + pedido de objetivo antes de analisar
  - Root cause: formato da tabela de chat tinha apenas 6 colunas sem "Dia" → modelo encaixava `semana`/`fds_feriado` na coluna Período
  - Fix: tabela obrigatória agora tem 7 colunas (Categoria | Período | Dia | ...) com exemplo e aviso explícito: "Período = 3h/6h/12h/Pernoite; Dia = Semana/FDS/Feriado — nunca trocar"
  - Regra 4 atualizada com a distinção crítica entre as duas colunas
  - Nova regra 13: para pedidos genéricos sem objetivo definido, usar `sugerir_respostas` com 6 opções (Aumentar RevPAR, volume, TRevPAR, reequilibrar FDS/semana, ocupação, outro) ANTES de iniciar o framework
  - `sugerir_respostas` após proposta de preços inclui obrigatoriamente "Gerar proposta de descontos para o Guia"

- **LHG-147:** fix(proposals): períodos dinâmicos por unidade + cobertura total obrigatória
  - Root cause: COBERTURA OBRIGATÓRIA só cobria categorias alteradas; períodos hardcoded "3h/6h/12h/pernoite" confundiam Altana (1h/2h/4h/12h) e Lush (3h/6h/12h/Day Use/Pernoite)
  - `proposals/route.ts`: COBERTURA TOTAL — proposta deve incluir TODAS as combinações cat×periodo×dia_tipo do mapa de preços, com justificativa obrigatória para itens mantidos (nunca omitir)
  - `maxOutputTokens` 6000 → 10000 para suportar propostas completas (~72 linhas no Lush)
  - `system-prompt.ts`: 4 ocorrências de "3h/6h/12h/pernoite" substituídas por referências dinâmicas à tabela vigente
  - **Armadilha:** períodos válidos já eram dinâmicos no prompt de geração via `activeRows.map(r => r.periodo)` — o problema era a cobertura e os hardcodes no chat

- **LHG-148:** fix(discount-proposals): estrutura por dia_semana+faixa_horaria + cobertura total
  - Root cause: `discountMap` keya por `dia_tipo` mas tabela de descontos usa `dia_semana` (domingo/segunda...) + `faixa_horaria` → lookup nunca batia
  - `DiscountProposalRow`: campo `dia_semana?: string` (domingo/segunda...) como campo principal; `dia_tipo?: string` mantido como legado
  - `discountMap` agora keya por `categoria|periodo|dia_semana|faixa_horaria` — alinha com estrutura real da planilha
  - `normPeriodo()`: normaliza "3h" → "3 HORAS" para cruzar com tabela de preços
  - `getPrecoBase()`: lookup com fallback guia_moteis → balcao_site → todos
  - `discountCtx`: mostra TODAS as linhas com dia_semana, faixa_horaria e preco_efetivo calculado
  - COBERTURA TOTAL: proposta inclui todas as combinações categoria×periodo×dia_semana×faixa_horaria com justificativa
  - `maxOutputTokens`: 4000 → 8000
  - `discount-proposals-list.tsx`: coluna Dia exibe `dia_semana` com fallback para `dia_tipo` legado; nova coluna Faixa Horária
  - **Armadilha:** tabela de descontos usa dias específicos (domingo/segunda/terça...) não dia_tipo (semana/fds_feriado) — nunca confundir os dois
  - **Armadilha:** nomes de período no CSV de desconto usam abreviação ("3h") enquanto tabela de preços usa forma completa ("3 HORAS") — normPeriodo() é obrigatório no cruzamento

- **LHG-149:** feat(guardrails+agente): dia_tipo nos guardrails + agente autônomo na vigência + OptionCards inline
  - Migration `20260427000001_guardrails_add_dia_tipo.sql`: coluna `dia_tipo TEXT NOT NULL DEFAULT 'todos'` + novo UNIQUE `(unit_id, categoria, periodo, dia_tipo)` (antigo era sem dia_tipo)
  - `database.types.ts`: `dia_tipo: string` em Row; `dia_tipo?: string` em Insert/Update de `agent_price_guardrails`
  - `guardrails/route.ts`: GET/POST/DELETE incluem `dia_tipo`; upsert usa chave composta com dia_tipo
  - `guardrails-manager.tsx`: select DIA_TIPO_OPTIONS (semana / fds_feriado / todos) por guardrail
  - `proposals/route.ts`: clamp server-side aplica guardrail filtrando por `dia_tipo` (`todos` bate qualquer dia)
  - Regra 13 do system prompt: se `focus_metric ≠ 'Balanceado'`, usa o foco configurado diretamente sem perguntar ao usuário
  - `vigenciaBlock` reescrito: decide autonomamente (janela igual para assimétrico, vigência completa para simétrico); oferece alternativas pós-análise via `sugerir_respostas` — sem gate antes da análise
  - `chat/route.ts`: `agentConfigBlock` construído a partir de `focus_metric`, `pricing_strategy`, `max_variation_pct` e appendado ao systemPrompt
  - `agente-page-client.tsx`: OptionCards renderizadas inline como cards compactos com `descricao`

- **LHG-150:** fix(agente): texto duplicado + OptionCards lentos + Enter criava 2 conversas
  - Root cause 1 (texto duplicado): AI SDK multi-step — após tool `sugerir_respostas`, SDK acumula 2ª text-part com mesmo conteúdo; fix: `firstSugerirIdx` slice — exibe apenas parts antes do primeiro `sugerir_respostas`
  - Root cause 2 (OptionCards lentos): condição `!isStreaming` impedia render durante streaming; removida — cards aparecem imediatamente ao chegar a tool call
  - Root cause 3 (Enter duplo): `isSubmittingRef.current = false` era resetado antes do React re-renderizar com `isStreaming=true`; fix: reset movido para `useEffect` que observa `status === 'ready' | 'error'`

- **LHG-151:** fix(propostas+descontos): sub-tabs instantâneas + dia_semana correto nas propostas de desconto
  - Root cause sub-tabs lentas: Radix Tabs desmonta conteúdo inativo por padrão — `ProposalsList` e `DiscountProposalsList` re-fetchavam a cada troca de aba
  - Fix: `forceMount` + `data-[state=inactive]:hidden` nas duas sub-tabs de propostas — componentes ficam montados; troca é puramente CSS
  - Root cause dia_semana errado: `priceCtx` injetava terminologia "Semana"/"FDS/Feriado" (dia_tipo) no mesmo prompt que `discountCtx` usava "segunda"/"domingo" (dia_semana) → modelo usava vocabulário errado
  - Fix `discount-proposals/route.ts`: `priceCtx` removido; regra crítica explícita: usar SEMPRE `dia_semana` com nome exato do dia (ex: "segunda", "domingo") — nunca `dia_tipo`
  - `discount-proposals-list.tsx`: coluna Dia exibe `dia_semana` com fallback para `dia_tipo` legado; nova coluna Faixa Horária

- **LHG-152:** feat(agente+admin): ajuste dinâmico por giro/ocupação, contexto compartilhado, mix de períodos e calendário de eventualidades
  - **Fix Mix por Período:** `buildPeriodCaseSQL` — novos thresholds: ≤3.25h → 3h; ≤6.25h → 6h; ≤13.5h → 12h; Day Use (h_in 12–14, dur ≤9h) verificado ANTES do threshold de 6h
  - **Mix de canal e período no agente:** `queryPeriodMix` injetado em todos os 4 modos do chat; `buildKPIContext` renderiza tabela markdown com Locações, Receita, Ticket Médio e %
  - **Ajuste dinâmico por giro/ocupação:** `PricingThresholds` em `rm_agent_config` (`giro_high`, `giro_low`, `ocupacao_high`, `ocupacao_low`, `adjustment_pct`); `buildPricingThresholdsBlock` gera regras de linguagem natural para o agente
  - **Contexto estratégico compartilhado:** `shared_context TEXT` em `rm_agent_config`; injetado no system prompt de TODAS as conversas da unidade
  - **Calendário de Eventualidades:** tabela `unit_events` (title, event_date, event_end_date, event_type: positivo/negativo/neutro, impact_description) com RLS (manager+ para criar/editar, admin+ para deletar)
  - API `/api/admin/unit-events` (GET/POST/PATCH/DELETE); `EventsManager` component na aba "Eventos" de `/dashboard/admin`
  - `database.types.ts`: `unit_events` adicionada; `shared_context` e `pricing_thresholds` adicionados a `rm_agent_config`
  - Migrations: `20260427000002` (shared_context + pricing_thresholds) e `20260427000003` (unit_events com RLS + Realtime)
  - **Armadilha:** Day Use deve ser classificado ANTES do `dur <= 6.25` no CASE SQL — SQL avalia condições em ordem

- **LHG-153:** feat(agente): modo de contexto por conversa — org vs personal
  - Toggle no ecrã inicial do chat (antes do primeiro envio) entre dois modos:
    - **"Contexto da organização"** (default `org`): inclui `shared_context`, calendário de eventualidades e regras de threshold de giro/ocupação
    - **"Contexto interno"** (`personal`): somente KPIs, tabela de preços, clima, concorrentes e comodidades — sem memória coletiva
  - `ContextMode = 'org' | 'personal'` exportado de `agente-chat.tsx`
  - `contextModeRef` em `AgenteChatInner` — bloqueado após primeiro envio (imutável por conversa)
  - `context_mode TEXT NOT NULL DEFAULT 'org'` em `rm_conversations` (migration `20260428000001`)
  - Body da requisição inclui `contextMode` via `getBody` ref function
  - `chat/route.ts`: lê `contextMode` do body; `contextMode === 'personal'` omite `eventsContext`, `pricingRulesBlock` e `sharedContextBlock` do system prompt
  - `agente-page-client.tsx`: estado `contextMode` sincroniza ao selecionar conversa existente (lê `context_mode` do banco); reset para `'org'` ao criar nova conversa
  - `ConversationSummary` inclui `context_mode?: ContextMode`
  - **Armadilha:** toggle só é visível antes do primeiro envio — após iniciar conversa o modo fica fixo

### 🔲 Backlog

#### 📊 Dashboard — enriquecimento
1. **LHG-31:** Dashboard: Visão de canais (parcialmente feito via LHG-131)


### 📅 Pós-MVP (Backlog)
LHG-51 a LHG-63: clima (✅ feito), eventos (✅ feito), trânsito (cancelado), aprendizado autônomo, dynamic pricing loop, integração com canais (Guia, Site Próprio).
