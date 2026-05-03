-- REVERT da migração 20260503000002_drop_unused_tables.
-- Decisão anterior foi precipitada — as tabelas representam features
-- planejadas no schema original, alinhadas com o roadmap pós-MVP.
-- Recriadas com schema idêntico ao initial_schema + COMMENT ON TABLE
-- ligando cada uma à issue futura que vai populá-las.

-- ─── rm_price_decisions: audit trail de decisões autônomas (pós-MVP) ────────
CREATE TABLE IF NOT EXISTS public.rm_price_decisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  period_id             uuid NOT NULL REFERENCES public.suite_periods(id) ON DELETE CASCADE,
  channel_id            uuid REFERENCES public.sales_channels(id) ON DELETE SET NULL,
  price_before          numeric(10, 2) NOT NULL,
  price_after           numeric(10, 2) NOT NULL,
  trigger               text,
  rationale             text,
  weather_snapshot      jsonb,
  occupancy_at_decision numeric(5, 2),
  competitor_prices     jsonb,
  was_reverted          boolean NOT NULL DEFAULT false,
  reverted_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rm_price_decisions IS
  'Audit trail das decisoes autonomas do agente RM quando ele operar sem aprovacao humana (pos-MVP). Substitui price_proposals no modo autonomo. Campos: weather_snapshot, competitor_prices, occupancy_at_decision e was_reverted permitem reconstruir contexto de cada decisao. Issue futura: pos-MVP autonomo.';

ALTER TABLE public.rm_price_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_price_decisions_select"
  ON public.rm_price_decisions FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

-- ─── rm_agent_overrides: cancelamentos/reversoes das decisoes autonomas ─────
CREATE TABLE IF NOT EXISTS public.rm_agent_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  decision_id    uuid NOT NULL REFERENCES public.rm_price_decisions(id) ON DELETE CASCADE,
  override_type  public.override_type NOT NULL,
  overridden_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rm_agent_overrides IS
  'Reversoes humanas das decisoes autonomas em rm_price_decisions. Sinal de feedback critico que alimenta aprendizado do agente sobre quando suas decisoes nao foram aceitas. Issue futura: pos-MVP autonomo.';

ALTER TABLE public.rm_agent_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_agent_overrides_select"
  ON public.rm_agent_overrides FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

-- ─── rm_weather_demand_patterns: padroes aprendidos clima x demanda ─────────
CREATE TABLE IF NOT EXISTS public.rm_weather_demand_patterns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id              uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id          uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  weather_condition    text NOT NULL,
  day_of_week          integer CHECK (day_of_week BETWEEN 0 AND 6),
  avg_demand_delta_pct numeric(7, 2) NOT NULL DEFAULT 0,
  sample_count         integer NOT NULL DEFAULT 0,
  last_updated         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, category_id, weather_condition, day_of_week)
);

COMMENT ON TABLE public.rm_weather_demand_patterns IS
  'Padroes aprendidos clima x demanda agregados por (unit, categoria, condicao, dia_semana). Cumulativo: cada nova observacao em rm_weather_observations atualiza avg_demand_delta_pct e incrementa sample_count. Diferente de rm_weather_observations (log diario bruto), aqui e o conhecimento agregado pronto para o prompt do agente. Issue futura: LHG-165 (sazonalidade aprendida HV5).';

ALTER TABLE public.rm_weather_demand_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_weather_demand_patterns_select"
  ON public.rm_weather_demand_patterns FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

-- ─── kpi_snapshots: cache historico granular de KPIs ────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id        uuid REFERENCES public.suite_categories(id) ON DELETE SET NULL,
  date               date NOT NULL,
  hour               integer CHECK (hour BETWEEN 0 AND 23),
  day_of_week        integer CHECK (day_of_week BETWEEN 0 AND 6),
  occupancy_rate     numeric(5, 2),
  revpar             numeric(10, 2),
  trevpar            numeric(10, 2),
  tmo                interval,
  giro               numeric(10, 4),
  revenue            numeric(12, 2),
  avg_ticket         numeric(10, 2),
  reservations_count integer,
  period_label       text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kpi_snapshots IS
  'Cache historico granular de KPIs por (unit, categoria, data, hora, dia_semana). Diferente do unstable_cache do Next.js (efemero), este e audit/baseline permanente para analise temporal sem hit no Automo. Issue futura: LHG-163 (anomaly detection HV3 — baseline 90 dias para z-score).';

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_unit_date ON public.kpi_snapshots(unit_id, date);

ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_snapshots_select"
  ON public.kpi_snapshots FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );
