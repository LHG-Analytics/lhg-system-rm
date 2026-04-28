-- n_suites vem dinamicamente do Automo (apartamento − bloqueadoapartamento ativos),
-- não precisa ser cadastrado manualmente. Mantemos apenas os campos que NÃO
-- estão no Automo: custo_variavel_locacao e notes.

ALTER TABLE public.unit_capacity DROP COLUMN IF EXISTS n_suites;
