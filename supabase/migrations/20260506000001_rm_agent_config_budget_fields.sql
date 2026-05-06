-- Integração com planilha de orçamento via Google Sheets (service account)
-- budget_sheet_url: URL completa da planilha Google Sheets
-- budget_sheet_tab: nome da aba (padrão 'DRE')
-- budget_last_sync: timestamp do último sync bem-sucedido
ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS budget_sheet_url  TEXT,
  ADD COLUMN IF NOT EXISTS budget_sheet_tab  TEXT NOT NULL DEFAULT 'DRE',
  ADD COLUMN IF NOT EXISTS budget_last_sync  TIMESTAMPTZ;
