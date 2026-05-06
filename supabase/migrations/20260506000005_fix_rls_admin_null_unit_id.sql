-- Fix: admin com unit_id = null deve ter acesso global a todas as unidades.
-- O padrao `unit_id = current_user_unit_id()` avalia UNKNOWN quando a funcao retorna NULL,
-- bloqueando silenciosamente admins globais. Adiciona OR current_user_unit_id() IS NULL
-- em todas as policies de admin que usam esse padrao.

-- 1. units (critico - sem isso o dashboard nao carrega nenhuma unidade)
DROP POLICY IF EXISTS "units: demais roles veem sua unit" ON units;
CREATE POLICY "units: demais roles veem sua unit" ON units
  FOR SELECT USING (
    current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'viewer'::user_role])
    AND (
      id = current_user_unit_id()
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

-- 2. rm_agent_config (admin)
DROP POLICY IF EXISTS "rm_agent_config: admin acesso total na sua unit" ON rm_agent_config;
CREATE POLICY "rm_agent_config: admin acesso total na sua unit" ON rm_agent_config
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 3. price_proposals (select)
DROP POLICY IF EXISTS "Usuarios veem propostas da propria unidade ou super_admin ve" ON price_proposals;
CREATE POLICY "Usuarios veem propostas da propria unidade ou super_admin ve" ON price_proposals
  FOR SELECT USING (
    current_user_role() = 'super_admin'::user_role
    OR unit_id = current_user_unit_id()
    OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
  );

-- 4. price_proposals (update)
DROP POLICY IF EXISTS "Admin e acima podem atualizar propostas" ON price_proposals;
CREATE POLICY "Admin e acima podem atualizar propostas" ON price_proposals
  FOR UPDATE USING (
    current_user_role() = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'manager'::user_role])
    AND (
      current_user_role() = 'super_admin'::user_role
      OR unit_id = current_user_unit_id()
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

-- 5. price_imports (select)
DROP POLICY IF EXISTS "Usuarios veem imports da propria unidade ou super_admin ve t" ON price_imports;
CREATE POLICY "Usuarios veem imports da propria unidade ou super_admin ve t" ON price_imports
  FOR SELECT USING (
    current_user_role() = 'super_admin'::user_role
    OR unit_id = current_user_unit_id()
    OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
  );

-- 6. price_imports (update)
DROP POLICY IF EXISTS "Admin e acima podem atualizar" ON price_imports;
CREATE POLICY "Admin e acima podem atualizar" ON price_imports
  FOR UPDATE USING (
    current_user_role() = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'manager'::user_role])
    AND (
      current_user_role() = 'super_admin'::user_role
      OR unit_id = current_user_unit_id()
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

-- 7. scheduled_reviews
DROP POLICY IF EXISTS "scheduled_reviews: acesso por unidade" ON scheduled_reviews;
CREATE POLICY "scheduled_reviews: acesso por unidade" ON scheduled_reviews
  FOR ALL USING (
    current_user_role() = 'super_admin'::user_role
    OR unit_id = current_user_unit_id()
    OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
  );

-- 8. profiles (admin)
DROP POLICY IF EXISTS "profiles: admin ve profiles da sua unit" ON profiles;
CREATE POLICY "profiles: admin ve profiles da sua unit" ON profiles
  FOR SELECT USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 9. agent_price_guardrails
DROP POLICY IF EXISTS "guardrails_select" ON agent_price_guardrails;
CREATE POLICY "guardrails_select" ON agent_price_guardrails
  FOR SELECT USING (
    current_user_role() = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'manager'::user_role, 'viewer'::user_role])
    AND (
      current_user_role() = 'super_admin'::user_role
      OR current_user_unit_id() = unit_id
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

DROP POLICY IF EXISTS "guardrails_update" ON agent_price_guardrails;
CREATE POLICY "guardrails_update" ON agent_price_guardrails
  FOR UPDATE USING (
    current_user_role() = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])
    AND (
      current_user_role() = 'super_admin'::user_role
      OR current_user_unit_id() = unit_id
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

DROP POLICY IF EXISTS "guardrails_delete" ON agent_price_guardrails;
CREATE POLICY "guardrails_delete" ON agent_price_guardrails
  FOR DELETE USING (
    current_user_role() = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])
    AND (
      current_user_role() = 'super_admin'::user_role
      OR current_user_unit_id() = unit_id
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

-- 10. unit_events
DROP POLICY IF EXISTS "unit_events: leitura por usuarios da unidade" ON unit_events;
CREATE POLICY "unit_events: leitura por usuarios da unidade" ON unit_events
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      current_user_role() = 'super_admin'::user_role
      OR unit_id = current_user_unit_id()
      OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
    )
  );

-- 11. suite_categories (admin)
DROP POLICY IF EXISTS "suite_categories: admin acesso total na sua unit" ON suite_categories;
CREATE POLICY "suite_categories: admin acesso total na sua unit" ON suite_categories
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 12. rm_weather_observations
DROP POLICY IF EXISTS "weather_obs_read" ON rm_weather_observations;
CREATE POLICY "weather_obs_read" ON rm_weather_observations
  FOR SELECT USING (
    current_user_role() = 'super_admin'::user_role
    OR unit_id = current_user_unit_id()
    OR (current_user_role() = 'admin'::user_role AND current_user_unit_id() IS NULL)
  );

-- 13. sales_channels (admin)
DROP POLICY IF EXISTS "sales_channels: admin acesso total na sua unit" ON sales_channels;
CREATE POLICY "sales_channels: admin acesso total na sua unit" ON sales_channels
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 14. rm_generated_prices (admin)
DROP POLICY IF EXISTS "rm_generated_prices: admin acesso total na sua unit" ON rm_generated_prices;
CREATE POLICY "rm_generated_prices: admin acesso total na sua unit" ON rm_generated_prices
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 15. rm_price_guardrails (admin)
DROP POLICY IF EXISTS "rm_price_guardrails: admin acesso total na sua unit" ON rm_price_guardrails;
CREATE POLICY "rm_price_guardrails: admin acesso total na sua unit" ON rm_price_guardrails
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );

-- 16. channel_sync_log (admin)
DROP POLICY IF EXISTS "channel_sync_log: admin acesso total na sua unit" ON channel_sync_log;
CREATE POLICY "channel_sync_log: admin acesso total na sua unit" ON channel_sync_log
  FOR ALL USING (
    current_user_role() = 'admin'::user_role
    AND (unit_id = current_user_unit_id() OR current_user_unit_id() IS NULL)
  );
