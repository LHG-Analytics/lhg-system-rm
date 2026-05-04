-- Lições estruturadas geradas após cada revisão de proposta. Cada row é uma
-- (categoria, período, dia, canal) com a mudança de preço aplicada e o
-- resultado observado em janela igual após N dias (checkpoint_days).
--
-- Substitui o filtro "últimas 3 propostas aprovadas" da memória estratégica
-- por filtro de relevância contextual (similaridade ao cenário atual + decay
-- por idade). HV1 (LHG-162) é quem insere; HV2 (LHG-171) define schema e
-- consumo no prompt.

CREATE TABLE public.rm_pricing_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES public.price_proposals(id) ON DELETE SET NULL,
  checkpoint_days INTEGER NOT NULL CHECK (checkpoint_days IN (7, 14, 28)),

  -- Contexto da decisão (granularidade da linha da proposta)
  categoria TEXT NOT NULL,
  periodo   TEXT NOT NULL,
  dia_tipo  TEXT NOT NULL,
  canal     TEXT,

  -- Mudança aplicada
  preco_anterior NUMERIC(10, 2) NOT NULL,
  preco_novo     NUMERIC(10, 2) NOT NULL,
  variacao_pct   NUMERIC(6, 2)  NOT NULL,

  -- Resultado medido (em janela igual à do baseline)
  delta_revpar_pct   NUMERIC(6, 2),
  delta_giro_pct     NUMERIC(6, 2),
  delta_ocupacao_pp  NUMERIC(6, 2),  -- pontos percentuais (não %)
  delta_ticket_pct   NUMERIC(6, 2),

  -- Decomposição (HV1 vai popular)
  attributed_pricing_pct NUMERIC(6, 2),  -- contribuição estimada da mudança
  implied_elasticity     NUMERIC(6, 3),  -- δgiro_pct / δprice_pct

  -- Condições contextuais para matching futuro
  conditions JSONB,  -- { weather_condition, weather_avg_temp, events, season_label, dominant_dow }

  -- Veredito agregado
  verdict TEXT NOT NULL CHECK (verdict IN ('success', 'neutral', 'failure')),

  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lessons_unit_scope        ON public.rm_pricing_lessons(unit_id, categoria, periodo, dia_tipo);
CREATE INDEX idx_lessons_unit_observed_at  ON public.rm_pricing_lessons(unit_id, observed_at DESC);

ALTER TABLE public.rm_pricing_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_pricing_lessons_select"
  ON public.rm_pricing_lessons FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

CREATE POLICY "rm_pricing_lessons_insert"
  ON public.rm_pricing_lessons FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

COMMENT ON TABLE public.rm_pricing_lessons IS
  'Licoes estruturadas derivadas da revisao +7d/+14d/+28d de cada proposta aprovada. Cada row liga uma decisao (categoria, periodo, dia, canal, variacao_pct) ao resultado observado em janela igual (delta_revpar_pct, delta_giro_pct etc) e a um veredito (success/neutral/failure). Filtro de relevancia em getRelevantLessons() seleciona top 5 por similaridade ao cenario atual + decay por idade.';
