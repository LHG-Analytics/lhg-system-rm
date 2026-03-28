# LHG Revenue Manager — Guia para o Claude

## Stack

- **Next.js 16.2.1** — App Router, TypeScript, React Compiler ativo
- **Tailwind v4** + **shadcn/ui** (preset Nova, Radix UI)
- **Supabase** — PostgreSQL + Auth + Realtime + Edge Functions
  - Local: `http://127.0.0.1:54321` (Docker via Scoop CLI v2.84.2)
  - Remoto: `https://pvlcktqbjianrbzpqrbd.supabase.co`
- **Upstash Redis** — cache (a configurar)
- **Anthropic Claude API** — Agente de Revenue Management
- **Deploy:** Vercel + Supabase hosted

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

## LHG Analytics API

Base URL por unidade: `https://analytics.lhgmoteis.com.br/{unit_slug}/{unit_name}/api`

| Unidade | api_base_url |
|---------|-------------|
| Lush Ipiranga | `https://analytics.lhgmoteis.com.br/lush_ipiranga/ipiranga/api` |
| Lush Lapa | `https://analytics.lhgmoteis.com.br/lush_lapa/lapa/api` |
| Altana | `https://analytics.lhgmoteis.com.br/altana/altana/api` |
| Andar de Cima | `https://analytics.lhgmoteis.com.br/andar_de_cima/andar_de_cima/api` |
| Tout | `https://analytics.lhgmoteis.com.br/tout/tout/api` |

**Auth:** `POST https://analytics.lhgmoteis.com.br/auth/api/login` com `{email, password}`. Resposta define `Set-Cookie: access_token=JWT` (HttpOnly, 1h). Ler com `res.headers.get('set-cookie')` no server-side. Reenviar como `Cookie: access_token=VALUE`. Tokens armazenados em `lhg_analytics_tokens` no Supabase.

**Endpoints de dados** (autenticação via Cookie):
- `GET /Company/kpis/date-range?startDate=DD%2FMM%2YYYY&endDate=DD%2FMM%2YYYY`
- `GET /Restaurants/restaurants/date-range?startDate=...&endDate=...`
- `GET /Bookings/bookings/date-range?startDate=...&endDate=...`

**Formatos importantes:**
- Datas: `DD/MM/YYYY` (URL-encoded: `%2F` para `/`)
- `totalAverageOccupationTime`: string `"HH:MM:SS"`, não número
- `DataTableSuiteCategory`: `Array<{ [categoryName: string]: SuiteCategoryKPI }>` (objeto com chave dinâmica, não array plano)
- Campos da suíte: `totalRentalsApartments`, `totalValue`, `totalTicketAverage` (não `rentals`, `revenue`, `ticketAverage`)

**Período padrão:** "últimos 12 meses" via `trailingYear()` — mesma data do ano passado até ontem operacional (06:00 cutoff). Ex: hoje 28/03/2026 → 28/03/2025 a 27/03/2026. Evita sazonalidade (YTD seria incompleto no início do ano).

## Contexto de negócio

Sistema para gestão de preços e disponibilidade de suítes de motéis da LHG.

- **Múltiplas unidades** (2–5 motéis) com controle centralizado
- **Precificação por:** categoria × período (3h/6h/12h/pernoite) × canal de venda × faixa horária × dia da semana
- **ERP:** Automo — acesso read-only ao banco PostgreSQL (nova API em desenvolvimento)
- **Canais MVP:** ERP + Site Próprio + Guia de Motéis
- **Agente RM:** MVP gera proposta para aprovação humana; pós-MVP flutua preços autonomamente

## Arquitetura do banco (schema v1 — 2026-03-27)

17 tabelas + 5 ENUMs + RLS em todas as tabelas:

| Tabela | Descrição |
|--------|-----------|
| `units` | Unidades/motéis (com `api_base_url` para LHG Analytics) |
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
| `lhg_analytics_tokens` | Tokens de auth da LHG Analytics API por unidade |
| `channel_sync_log` | Log de sincronização com canais |
| `notifications` | Notificações para usuários |

**RLS:** funções `current_user_role()` e `current_user_unit_id()` como `SECURITY DEFINER` são a base de todas as policies.

## Issues Linear (status atual — 2026-03-28)

### ✅ Concluídos
- **LHG-8:** Setup Next.js + Supabase + Tailwind + shadcn/ui
- **LHG-9:** Auth Google SSO + email/senha
- **LHG-10:** DB Schema completo + migrations
- **LHG-11:** RLS Policies
- **LHG-14:** Sidebar + Navegação + Layout base (incl. hover expand/collapse, unit switcher com Suspense)
- **LHG-21:** Integração LHG Analytics API — KPIs em tempo real (trailing 12 meses, fallback unidade para super_admin)
- **LHG-5:** SPIKE — Mapear banco Automo
- **LHG-64:** Supabase local + vínculo remoto
- **LHG-65:** Google OAuth configurado
- **LHG-66:** Logo LHG na tela de login
- **LHG-67:** Fix cursor pointer
- **LHG-68:** Toggle dark/light mode (custom ThemeProvider — sem next-themes)
- **LHG-70:** Cadastro de unidades reais no banco

### 🔲 Backlog MVP (por prioridade)

#### 🤖 Agente RM — núcleo do produto
1. ~~**LHG-35:** Edge Function: Endpoint seguro para Claude API~~ ✅
2. **LHG-36:** Agente RM: Interface de chat com streaming
3. **LHG-37:** Agente RM: Injeção automática de KPIs no contexto do agente
4. **LHG-40:** Agente RM: Prompt engineering e estratégia de precificação
5. **LHG-41:** Agente RM: Interface de aprovação (humano sempre aprova no MVP)

#### 🚀 Deploy e CI/CD
6. **LHG-49:** CI/CD GitHub Actions → Vercel + Supabase migrations
7. **LHG-50:** Deploy produção + onboarding unidades piloto

#### 📊 Dashboard — enriquecimento
8. **LHG-30:** Dashboard: Heatmap ocupação × hora × dia da semana
9. **LHG-31:** Dashboard: Visão de canais

#### 🔔 Notificações
10. **LHG-32:** Notificações push + email (Resend)

#### ✨ Polish
11. **LHG-72:** Ajustes de layout e polish geral
12. **LHG-71:** Logo de cada unidade no seletor da sidebar

### 📅 Pós-MVP (Backlog)
LHG-51 a LHG-63: guardrails, clima, eventos, trânsito, aprendizado autônomo, dynamic pricing loop.
