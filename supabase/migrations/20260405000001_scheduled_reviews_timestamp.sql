-- ============================================================
-- Migração: scheduled_at DATE → TIMESTAMPTZ + proposal_id FK
-- ============================================================

-- 1. Adiciona coluna timestamptz temporária
ALTER TABLE public.scheduled_reviews
  ADD COLUMN scheduled_at_ts timestamptz;

-- 2. Migra valores existentes: DATE → TIMESTAMPTZ às 13:00 UTC (10:00 BRT)
UPDATE public.scheduled_reviews
  SET scheduled_at_ts = (scheduled_at::text || 'T13:00:00Z')::timestamptz;

-- 3. Torna não nula com default = agora + 7 dias
ALTER TABLE public.scheduled_reviews
  ALTER COLUMN scheduled_at_ts SET NOT NULL,
  ALTER COLUMN scheduled_at_ts SET DEFAULT (now() + interval '7 days');

-- 4. Remove índice antigo e coluna DATE original
DROP INDEX IF EXISTS idx_scheduled_reviews_unit_date;
ALTER TABLE public.scheduled_reviews DROP COLUMN scheduled_at;

-- 5. Renomeia coluna
ALTER TABLE public.scheduled_reviews RENAME COLUMN scheduled_at_ts TO scheduled_at;

-- 6. Adiciona FK para price_proposals (nullable)
ALTER TABLE public.scheduled_reviews
  ADD COLUMN proposal_id uuid REFERENCES public.price_proposals(id) ON DELETE SET NULL;

-- 7. Recria índice
CREATE INDEX idx_scheduled_reviews_unit_status
  ON public.scheduled_reviews(unit_id, scheduled_at, status);
