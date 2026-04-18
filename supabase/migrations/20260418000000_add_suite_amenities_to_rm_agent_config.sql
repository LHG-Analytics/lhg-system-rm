-- Adiciona coluna suite_amenities à rm_agent_config
-- Estrutura: { "CATEGORIA": ["Comodidade 1", "Comodidade 2", ...] }
ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS suite_amenities JSONB NOT NULL DEFAULT '{}';
