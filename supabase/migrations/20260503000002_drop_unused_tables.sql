-- Higiene técnica: remove tabelas orphan que nunca foram populadas e
-- são dívida técnica no schema. Validado via SELECT COUNT(*) que estão
-- vazias antes deste drop.
--
-- Mantemos `lhg_analytics_tokens` (tem 5 rows do sistema legado) — será
-- avaliada em migração futura específica.
-- Mantemos `weather_insight_cache` em rm_agent_config (em uso ativo
-- por src/lib/agente/weather-insight.ts → src/app/dashboard/page.tsx).

DROP TABLE IF EXISTS public.rm_weather_demand_patterns CASCADE;
DROP TABLE IF EXISTS public.rm_price_decisions CASCADE;
DROP TABLE IF EXISTS public.rm_agent_overrides CASCADE;
DROP TABLE IF EXISTS public.kpi_snapshots CASCADE;

-- Campo nunca atualizado em rm_agent_config — sem leitor nem escritor no código.
ALTER TABLE public.rm_agent_config DROP COLUMN IF EXISTS last_context_update;
