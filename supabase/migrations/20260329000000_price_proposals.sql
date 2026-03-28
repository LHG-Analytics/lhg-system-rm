-- Propostas de ajuste de preço geradas pelo Agente RM
-- Armazena propostas estruturadas pendentes de aprovação humana
-- MVP: aprovação/rejeição do lote inteiro; pós-MVP: aprovação por linha

CREATE TABLE public.price_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  context      text,                                         -- análise/racional do agente
  rows         jsonb NOT NULL DEFAULT '[]'::jsonb,           -- array de ProposedPriceRow
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  uuid REFERENCES auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_proposals_unit   ON public.price_proposals(unit_id);
CREATE INDEX idx_price_proposals_status ON public.price_proposals(unit_id, status);

ALTER TABLE public.price_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários veem propostas da própria unidade ou super_admin vê tudo"
  ON public.price_proposals FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR unit_id = public.current_user_unit_id()
  );

CREATE POLICY "Admin e acima podem criar propostas"
  ON public.price_proposals FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "Admin e acima podem atualizar propostas"
  ON public.price_proposals FOR UPDATE
  USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR unit_id = public.current_user_unit_id()
    )
  );
