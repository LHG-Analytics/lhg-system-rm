-- Migration: rm_weekly_reports
-- Tabela para relatórios semanais do agente RM

CREATE TABLE IF NOT EXISTS rm_weekly_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('generating', 'done', 'failed')),
  generated_at    TIMESTAMPTZ,
  error_msg       TEXT,
  report_data     JSONB,
  ai_summary      TEXT,
  UNIQUE (unit_id, period_start)
);

-- RLS
ALTER TABLE rm_weekly_reports ENABLE ROW LEVEL SECURITY;

-- Usuários leem apenas relatórios da sua unidade
CREATE POLICY "users_read_own_unit_reports"
  ON rm_weekly_reports FOR SELECT
  USING (
    unit_id = current_user_unit_id()
    OR current_user_unit_id() IS NULL
    OR current_user_role() = 'super_admin'
  );

-- Somente service_role pode inserir/atualizar
CREATE POLICY "service_role_write_reports"
  ON rm_weekly_reports FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Publicar para Realtime (polling de status)
ALTER PUBLICATION supabase_realtime ADD TABLE rm_weekly_reports;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_rm_weekly_reports_unit_period
  ON rm_weekly_reports (unit_id, period_start DESC);
