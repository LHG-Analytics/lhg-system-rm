-- Tabela de importações de tabela de preços
-- Armazena o CSV bruto e os dados parseados pelo agente RM
-- MVP considera apenas: balcao_site, site_programada, guia_moteis

CREATE TABLE public.price_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  imported_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_content  text NOT NULL,
  parsed_data  jsonb NOT NULL DEFAULT '[]'::jsonb,
  canals       text[] NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  imported_at  timestamptz NOT NULL DEFAULT now()
);

-- Só um import ativo por unidade por vez
CREATE INDEX idx_price_imports_unit_active
  ON public.price_imports(unit_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_price_imports_unit ON public.price_imports(unit_id);

-- Desativa imports anteriores quando um novo é confirmado (via trigger)
CREATE OR REPLACE FUNCTION public.deactivate_previous_price_imports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.price_imports
    SET is_active = false
    WHERE unit_id = NEW.unit_id
      AND id <> NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deactivate_price_imports
  AFTER INSERT OR UPDATE OF is_active ON public.price_imports
  FOR EACH ROW EXECUTE FUNCTION public.deactivate_previous_price_imports();

-- RLS
ALTER TABLE public.price_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários veem imports da própria unidade ou super_admin vê tudo"
  ON public.price_imports FOR SELECT
  USING (
    public.current_user_role() = 'super_admin'
    OR unit_id = public.current_user_unit_id()
  );

CREATE POLICY "Admin e acima podem importar"
  ON public.price_imports FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "Admin e acima podem atualizar"
  ON public.price_imports FOR UPDATE
  USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
    AND (
      public.current_user_role() = 'super_admin'
      OR unit_id = public.current_user_unit_id()
    )
  );
