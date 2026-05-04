-- HV1: revisão multi-checkpoint (+7d, +14d, +28d) por proposta aprovada,
-- cada uma comparando contra kpi_baseline com janela igual.

ALTER TABLE public.scheduled_reviews
  ADD COLUMN IF NOT EXISTS checkpoint_days INTEGER NOT NULL DEFAULT 7
    CHECK (checkpoint_days IN (7, 14, 28));

-- Índice para evitar duplicatas (proposal_id, checkpoint_days)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_reviews_proposal_checkpoint
  ON public.scheduled_reviews(proposal_id, checkpoint_days)
  WHERE proposal_id IS NOT NULL;
