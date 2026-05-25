ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS competitor_category_map JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN rm_agent_config.competitor_category_map IS
  'Mapeamento manual de categorias: [{competitor_name, competitor_cat, nossa_cat}]. Tem prioridade sobre heurísticas automáticas em computeAndPersistGaps.';
