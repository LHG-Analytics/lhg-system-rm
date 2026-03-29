-- Histórico de conversas: adiciona updated_at e title
ALTER TABLE public.rm_conversations
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_rm_conversations_updated
  ON public.rm_conversations (unit_id, updated_at DESC);

-- Trigger para manter updated_at atualizado automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rm_conversations_set_updated_at ON public.rm_conversations;
CREATE TRIGGER rm_conversations_set_updated_at
  BEFORE UPDATE ON public.rm_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
