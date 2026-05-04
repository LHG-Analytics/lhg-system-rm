-- HV3 (LHG-163): detecção diária de anomalias via z-score em KPIs.
-- Para cada (unit, metric, scope), calcula z-score dos últimos 7 dias vs
-- baseline de 90 dias. |z| > 2 vira row aqui — outlier que merece atenção.

CREATE TABLE public.rm_anomalies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  metric          TEXT NOT NULL CHECK (metric IN ('revpar', 'giro', 'ocupacao', 'ticket')),
  scope           JSONB NOT NULL,  -- { categoria?, periodo?, dia_semana?, scope_label }

  current_value   NUMERIC(12, 4),
  baseline_mean   NUMERIC(12, 4),
  baseline_stddev NUMERIC(12, 4),
  z_score         NUMERIC(6, 2) NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('positive_outlier', 'negative_outlier')),

  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  conv_id         UUID REFERENCES public.rm_conversations(id) ON DELETE SET NULL,
  notes           TEXT
);

CREATE INDEX idx_anomalies_unit_status ON public.rm_anomalies(unit_id, status, detected_at DESC);

ALTER TABLE public.rm_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_anomalies_select"
  ON public.rm_anomalies FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

CREATE POLICY "rm_anomalies_update"
  ON public.rm_anomalies FOR UPDATE
  USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

COMMENT ON TABLE public.rm_anomalies IS
  'Anomalias detectadas pelo cron diario via z-score (|z| > 2). Throttle: mesma anomalia (scope+metric) so reinserida se a anterior fechou ou tem >7d. Anomalia negativa abre rm_conversations automatica com diagnostico inicial. UI: widget no dashboard "Anomalias detectadas (ultimos 7 dias)".';
