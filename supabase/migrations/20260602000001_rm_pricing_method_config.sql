-- Método de precificação configurável por unidade (LHG: incorporar o método do chefe da LIV)
-- 'agent_judgment' (atual): o LLM raciocina livremente.
-- 'giro_uplift' (método do chefe): preço = atual × (1 + clamp(giro_dia/giro_médio − 1, 0, teto)),
--   + prêmio na faixa de pico, nunca reduz. Gerador determinístico replica a planilha.

ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS pricing_method     TEXT    NOT NULL DEFAULT 'agent_judgment'
    CHECK (pricing_method IN ('agent_judgment', 'giro_uplift')),
  ADD COLUMN IF NOT EXISTS giro_uplift_cap    NUMERIC NOT NULL DEFAULT 0.05,   -- teto de reajuste de giro (ex: 0.05 = 5%)
  ADD COLUMN IF NOT EXISTS peak_premium       NUMERIC NOT NULL DEFAULT 0.05,   -- prêmio adicional na faixa de pico
  ADD COLUMN IF NOT EXISTS peak_start         INTEGER NOT NULL DEFAULT 15,     -- início da faixa de pico (hora 0-23)
  ADD COLUMN IF NOT EXISTS peak_end           INTEGER NOT NULL DEFAULT 21,     -- fim da faixa de pico (hora 0-23)
  ADD COLUMN IF NOT EXISTS never_reduce       BOOLEAN NOT NULL DEFAULT false,  -- true = só sobe ou mantém, nunca reduz
  ADD COLUMN IF NOT EXISTS default_elasticity NUMERIC NOT NULL DEFAULT -0.5;   -- elasticidade preço→giro fallback

COMMENT ON COLUMN rm_agent_config.pricing_method IS
  'agent_judgment = LLM livre; giro_uplift = método determinístico do chefe (uplift por giro, nunca reduz).';
COMMENT ON COLUMN rm_agent_config.giro_uplift_cap IS
  'Teto do reajuste por giro no método giro_uplift (fração, ex: 0.05 = 5%).';
COMMENT ON COLUMN rm_agent_config.peak_premium IS
  'Prêmio adicional aplicado na faixa de pico (fração).';
COMMENT ON COLUMN rm_agent_config.never_reduce IS
  'Se true, propostas/gerador nunca propõem preço abaixo do atual (dias fracos = manter).';
COMMENT ON COLUMN rm_agent_config.default_elasticity IS
  'Elasticidade preço→giro usada como fallback quando não há elasticidade aprendida.';

-- LIV usa o método do chefe por padrão
UPDATE rm_agent_config
SET pricing_method = 'giro_uplift', never_reduce = true
WHERE unit_id IN (SELECT id FROM units WHERE slug = 'liv');
