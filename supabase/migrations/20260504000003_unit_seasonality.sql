-- HV5 (LHG-165): sazonalidade aprendida do histórico Automo.
-- Para cada dia do calendário (MM-DD), calcula fator multiplicador esperado
-- vs media anual: factor = revpar(D) / median(revpar(±15d)). Permite ao agente
-- saber, sem ML, "amanhã (12/06) historicamente tem RevPAR 47% acima da média".

CREATE TABLE public.unit_seasonality (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  date_key        TEXT NOT NULL,  -- 'MM-DD' (annual) ou 'YYYY-MM-DD' (specific)
  date_key_type   TEXT NOT NULL CHECK (date_key_type IN ('annual_recurring', 'specific')),

  revpar_factor   NUMERIC(6, 3),
  giro_factor     NUMERIC(6, 3),
  ocupacao_factor NUMERIC(6, 3),
  ticket_factor   NUMERIC(6, 3),

  n_observations  INTEGER NOT NULL DEFAULT 0,
  stddev_revpar   NUMERIC(6, 3),

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (unit_id, date_key, date_key_type)
);

CREATE INDEX idx_seasonality_unit_date ON public.unit_seasonality(unit_id, date_key);

ALTER TABLE public.unit_seasonality ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_seasonality_select"
  ON public.unit_seasonality FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

COMMENT ON TABLE public.unit_seasonality IS
  'Fatores sazonais aprendidos do trailing year: revpar(D) / median(revpar de ±15d). Computado semanalmente pelo cron de revisoes (run-reviews.ts) — uma vez por semana e quando ha menos de 7 dias de cache fica stale, recomputa lazy. Usado por: agente RM (bloco "Sazonalidade esperada"), decomposicao de lift (HV1), futuramente solver de otimizacao (ST4).';
