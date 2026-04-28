-- ─── unit_capacity: estrutura física por categoria ──────────────────────────
-- Capacidade instalada (n_suítes) e custo variável médio por locação
-- por categoria de suíte. Usado pelo agente RM para cálculos de margem
-- e para evitar que pergunte n_suítes ao usuário a cada conversa.

CREATE TABLE public.unit_capacity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  n_suites INTEGER NOT NULL CHECK (n_suites > 0),
  custo_variavel_locacao NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (custo_variavel_locacao >= 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_id, categoria)
);

CREATE INDEX idx_unit_capacity_unit_id ON public.unit_capacity(unit_id);

ALTER TABLE public.unit_capacity ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro autenticado da unidade (ou super_admin com unit_id=null)
CREATE POLICY "unit_capacity_select"
  ON public.unit_capacity FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

-- Escrita: apenas admin/super_admin
CREATE POLICY "unit_capacity_insert"
  ON public.unit_capacity FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

CREATE POLICY "unit_capacity_update"
  ON public.unit_capacity FOR UPDATE
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

CREATE POLICY "unit_capacity_delete"
  ON public.unit_capacity FOR DELETE
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );


-- ─── unit_channel_costs: comissão por canal de venda ────────────────────────
-- Comissão (%) e taxa fixa por canal de reserva. Usado pelo agente para
-- calcular receita líquida por canal e otimizar por margem.

CREATE TABLE public.unit_channel_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('balcao_site','site_programada','guia_moteis','booking','expedia','outros')),
  comissao_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (comissao_pct >= 0 AND comissao_pct <= 100),
  taxa_fixa NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (taxa_fixa >= 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_id, canal)
);

CREATE INDEX idx_unit_channel_costs_unit_id ON public.unit_channel_costs(unit_id);

ALTER TABLE public.unit_channel_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_channel_costs_select"
  ON public.unit_channel_costs FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR public.current_user_unit_id() = unit_id
    OR public.current_user_unit_id() IS NULL
  );

CREATE POLICY "unit_channel_costs_insert"
  ON public.unit_channel_costs FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

CREATE POLICY "unit_channel_costs_update"
  ON public.unit_channel_costs FOR UPDATE
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );

CREATE POLICY "unit_channel_costs_delete"
  ON public.unit_channel_costs FOR DELETE
  USING (
    public.current_user_role() IN ('super_admin', 'admin')
    AND (
      public.current_user_role() = 'super_admin'
      OR public.current_user_unit_id() = unit_id
      OR public.current_user_unit_id() IS NULL
    )
  );


-- ─── Trigger updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_unit_capacity_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER unit_capacity_touch_updated_at
  BEFORE UPDATE ON public.unit_capacity
  FOR EACH ROW EXECUTE FUNCTION public.touch_unit_capacity_updated_at();

CREATE TRIGGER unit_channel_costs_touch_updated_at
  BEFORE UPDATE ON public.unit_channel_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_unit_capacity_updated_at();
