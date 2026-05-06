-- Armazena orçamento anual completo (todos os meses) da aba Locações-Comp
-- Estrutura: { "2026": { "1": { receita, ticket, giro, revpar }, ..., "12": {...} } }
ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS budget_yearly JSONB NOT NULL DEFAULT '{}';
