-- Adiciona coluna dia_tipo à tabela agent_price_guardrails
-- e recria o UNIQUE constraint para incluir dia_tipo como chave de upsert

ALTER TABLE agent_price_guardrails
  ADD COLUMN IF NOT EXISTS dia_tipo TEXT NOT NULL DEFAULT 'todos';

-- Remove constraint antiga (unit_id, categoria, periodo) se existir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_price_guardrails_unit_id_categoria_periodo_key'
  ) THEN
    ALTER TABLE agent_price_guardrails
      DROP CONSTRAINT agent_price_guardrails_unit_id_categoria_periodo_key;
  END IF;
END $$;

-- Cria novo UNIQUE incluindo dia_tipo
ALTER TABLE agent_price_guardrails
  ADD CONSTRAINT agent_price_guardrails_unit_id_categoria_periodo_dia_tipo_key
  UNIQUE (unit_id, categoria, periodo, dia_tipo);
