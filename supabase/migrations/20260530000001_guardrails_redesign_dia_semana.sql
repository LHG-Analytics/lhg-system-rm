-- Redesign guardrails: troca dia_tipo por dia_semana (dia específico da semana)
-- e adiciona faixa horária opcional (hora_inicio, hora_fim).

-- 1. Adiciona novas colunas
ALTER TABLE agent_price_guardrails
  ADD COLUMN IF NOT EXISTS dia_semana TEXT,
  ADD COLUMN IF NOT EXISTS hora_inicio TEXT,
  ADD COLUMN IF NOT EXISTS hora_fim TEXT;

-- 2. Migra dados existentes: preserva valores legados como dia_semana
UPDATE agent_price_guardrails
SET dia_semana = COALESCE(dia_tipo, 'todos')
WHERE dia_semana IS NULL;

-- 3. NOT NULL + default
UPDATE agent_price_guardrails SET dia_semana = 'todos' WHERE dia_semana IS NULL;
ALTER TABLE agent_price_guardrails ALTER COLUMN dia_semana SET NOT NULL;
ALTER TABLE agent_price_guardrails ALTER COLUMN dia_semana SET DEFAULT 'todos';

-- 4. Remove constraint antiga
ALTER TABLE agent_price_guardrails
  DROP CONSTRAINT IF EXISTS agent_price_guardrails_unit_id_categoria_periodo_dia_tipo_key;

-- 5. Remove coluna legada
ALTER TABLE agent_price_guardrails DROP COLUMN IF EXISTS dia_tipo;

-- 6. Nova constraint: um guardrail por (unidade, categoria, período, dia_semana)
ALTER TABLE agent_price_guardrails
  ADD CONSTRAINT agent_price_guardrails_unit_id_categoria_periodo_dia_semana_key
  UNIQUE (unit_id, categoria, periodo, dia_semana);
