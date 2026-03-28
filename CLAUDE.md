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

### shadcn/ui
- Adicionar componentes: `npx shadcn@latest add [componente]`

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
| `channel_sync_log` | Log de sincronização com canais |
| `notifications` | Notificações para usuários |

**RLS:** funções `current_user_role()` e `current_user_unit_id()` como `SECURITY DEFINER` são a base de todas as policies.

## Issues Linear em progresso

- **LHG-9:** Auth Google SSO + email/senha
- **LHG-10:** DB Schema completo + migrations ✅ Done
- **LHG-11:** RLS Policies ✅ Done
- **LHG-14:** Layout base (sidebar + navegação)
