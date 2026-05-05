-- ST1: Tabela de elasticidade-preço calculada por categoria/período/dia_tipo
-- Armazena resultados de regressão log-log: log(giro) = a + b·log(preço) + ε
-- onde b é a elasticidade-preço (negativo: demanda cai quando preço sobe)
-- Atualizada mensalmente pelo cron via run-reviews.ts (1º dia do mês)

CREATE TABLE rm_price_elasticity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  -- Dimensões da combinação
  categoria TEXT NOT NULL,
  periodo   TEXT NOT NULL,
  dia_tipo  TEXT NOT NULL,

  -- Resultados da regressão
  elasticity              NUMERIC(6,3),  -- coeficiente b (esperado: negativo, -0.3 a -1.5)
  intercept               NUMERIC(8,3),  -- coeficiente a
  r_squared               NUMERIC(5,3),  -- qualidade do ajuste (0–1)
  n_observations          INTEGER NOT NULL DEFAULT 0,
  confidence_interval_low  NUMERIC(6,3), -- limite inferior do IC 95%
  confidence_interval_high NUMERIC(6,3), -- limite superior do IC 95%

  -- Metadados
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_window_start DATE,
  data_window_end   DATE,

  UNIQUE(unit_id, categoria, periodo, dia_tipo)
);

ALTER TABLE rm_price_elasticity ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado da unidade
CREATE POLICY "Leitura da elasticidade por unidade" ON rm_price_elasticity
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND (p.unit_id = rm_price_elasticity.unit_id OR p.unit_id IS NULL)
    )
  );

-- Escrita: apenas service_role (cron interno)
CREATE POLICY "Escrita apenas service_role" ON rm_price_elasticity
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
