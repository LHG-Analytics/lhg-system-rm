-- Tabela de propostas de desconto do agente RM
-- Estrutura análoga a price_proposals, mas específica para descontos do Guia

CREATE TABLE IF NOT EXISTS discount_proposals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  context     TEXT,                   -- resumo do raciocínio do agente
  rows        JSONB NOT NULL DEFAULT '[]',
  -- cada row: { canal, categoria, periodo, dia_tipo, desconto_atual_pct, desconto_proposto_pct, preco_base, justificativa }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  conv_id     UUID REFERENCES rm_conversations(id) ON DELETE SET NULL
);

ALTER TABLE discount_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discount_proposals_select" ON discount_proposals
  FOR SELECT USING (
    unit_id = current_user_unit_id()
    OR current_user_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "discount_proposals_insert" ON discount_proposals
  FOR INSERT WITH CHECK (
    unit_id = current_user_unit_id()
    OR current_user_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "discount_proposals_update" ON discount_proposals
  FOR UPDATE USING (
    unit_id = current_user_unit_id()
    OR current_user_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "discount_proposals_delete" ON discount_proposals
  FOR DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE discount_proposals;
