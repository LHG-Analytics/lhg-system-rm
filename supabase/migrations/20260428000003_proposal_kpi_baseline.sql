-- KPI snapshot capturado no momento da aprovação para permitir
-- comparação justa antes/depois numa janela igual (lift measurement).
-- Sem isso, a "memória estratégica" do agente compara janelas
-- diferentes, com clima/eventos diferentes, e infere causalidade
-- que não existe.

ALTER TABLE public.price_proposals
  ADD COLUMN IF NOT EXISTS kpi_baseline JSONB,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_from DATE;

CREATE INDEX IF NOT EXISTS idx_price_proposals_approved_at
  ON public.price_proposals(approved_at DESC)
  WHERE approved_at IS NOT NULL;
