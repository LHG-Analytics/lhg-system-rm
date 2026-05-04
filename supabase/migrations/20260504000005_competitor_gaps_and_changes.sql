-- HV4 (LHG-164): detecção de mudança de preço de concorrentes + price gap.
-- price_changes: detectado após cada novo snapshot, comparado com anterior.
-- rm_competitor_price_gaps: cruza snapshot atual com nossa tabela vigente.

ALTER TABLE public.competitor_snapshots
  ADD COLUMN IF NOT EXISTS price_changes JSONB;
  -- Estrutura: [{ categoria_concorrente, periodo, dia_tipo, preco_anterior, preco_novo, delta_pct }]

CREATE TABLE public.rm_competitor_price_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  snapshot_id     UUID REFERENCES public.competitor_snapshots(id) ON DELETE CASCADE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  competitor_name TEXT NOT NULL,
  categoria_nossa TEXT NOT NULL,
  categoria_competitor TEXT,
  periodo         TEXT NOT NULL,
  dia_tipo        TEXT NOT NULL,

  preco_nosso              NUMERIC(10, 2) NOT NULL,
  preco_concorrente_mediana NUMERIC(10, 2) NOT NULL,
  preco_concorrente_min    NUMERIC(10, 2),
  preco_concorrente_max    NUMERIC(10, 2),

  gap_pct  NUMERIC(6, 2) NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('underprice', 'aligned', 'overprice'))
);

CREATE INDEX idx_competitor_gaps_unit_computed ON public.rm_competitor_price_gaps(unit_id, computed_at DESC);
CREATE INDEX idx_competitor_gaps_scope         ON public.rm_competitor_price_gaps(unit_id, categoria_nossa, periodo, dia_tipo);

ALTER TABLE public.rm_competitor_price_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rm_competitor_price_gaps_select"
  ON public.rm_competitor_price_gaps FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

COMMENT ON TABLE public.rm_competitor_price_gaps IS
  'Posicao competitiva: nosso preco vigente vs mediana de concorrentes equivalentes em comodidades. Recalculado a cada novo snapshot. Bloco "Posicao competitiva" no prompt do agente RM mostra underprice/aligned/overprice por (categoria, periodo, dia_tipo). gap_pct positivo = nosso preco acima do mercado.';
