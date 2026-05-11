-- ============================================================
-- Infra de configuração de unidades — automo_env_key, category_ids, period_type
-- Permite adicionar/remover unidades sem alterar código.
-- ============================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS automo_env_key     TEXT,
  ADD COLUMN IF NOT EXISTS automo_category_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS period_type         TEXT NOT NULL DEFAULT 'standard'
    CONSTRAINT units_period_type_check CHECK (period_type IN ('standard', 'altana')),
  ADD COLUMN IF NOT EXISTS logo_path           TEXT;

-- Seed das unidades existentes
UPDATE public.units SET
  automo_env_key      = 'IPIRANGA',
  automo_category_ids = '{10,11,12,15,16,17,18,19,24}',
  period_type         = 'standard'
WHERE slug = 'lush-ipiranga';

UPDATE public.units SET
  automo_env_key      = 'LAPA',
  automo_category_ids = '{7,8,9,10,11,12}',
  period_type         = 'standard'
WHERE slug = 'lush-lapa';

UPDATE public.units SET
  automo_env_key      = 'TOUT',
  automo_category_ids = '{6,7,8,9,10,12}',
  period_type         = 'standard'
WHERE slug = 'tout';

UPDATE public.units SET
  automo_env_key      = 'ANDAR_DE_CIMA',
  automo_category_ids = '{2,3,4,5,6,7,12}',
  period_type         = 'standard'
WHERE slug = 'andar-de-cima';

UPDATE public.units SET
  automo_env_key      = 'ALTANA',
  automo_category_ids = '{1,2,3,4,5,6,7,8,9,10,11,12}',
  period_type         = 'altana'
WHERE slug = 'altana';

-- Nova unidade: LIV (Quito, Equador)
-- A env var de conexão deve ser DATABASE_URL_LOCAL_LIV
INSERT INTO public.units (name, slug, city, state, automo_env_key, automo_category_ids, period_type, is_active)
VALUES ('LIV', 'liv', 'Quito', 'EC', 'LIV', '{1,2,3,4,5,7,8,9,10,11}', 'standard', true)
ON CONFLICT (slug) DO UPDATE SET
  automo_env_key      = EXCLUDED.automo_env_key,
  automo_category_ids = EXCLUDED.automo_category_ids,
  period_type         = EXCLUDED.period_type;
