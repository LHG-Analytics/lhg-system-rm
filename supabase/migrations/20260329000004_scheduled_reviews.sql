-- ============================================================
-- scheduled_reviews — revisões periódicas agendadas pelo agente RM
-- ============================================================

CREATE TABLE public.scheduled_reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid        NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_at date        NOT NULL,                          -- data (sem hora) em que o cron deve executar
  note         text,                                          -- obs do agente ao agendar (ex: "Monitorar impacto da tabela nova")
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'running', 'done', 'failed')),
  conv_id      uuid        REFERENCES public.rm_conversations(id) ON DELETE SET NULL,  -- conversa gerada
  created_at   timestamptz NOT NULL DEFAULT now(),
  executed_at  timestamptz
);

CREATE INDEX idx_scheduled_reviews_unit_date ON public.scheduled_reviews(unit_id, scheduled_at, status);

ALTER TABLE public.scheduled_reviews ENABLE ROW LEVEL SECURITY;

-- Usuários veem/gerenciam revisões da sua própria unidade
CREATE POLICY "scheduled_reviews: acesso por unidade"
  ON public.scheduled_reviews
  FOR ALL
  USING (
    public.current_user_role() = 'super_admin'
    OR unit_id = public.current_user_unit_id()
  );
