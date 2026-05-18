-- Add price sheet URL and last sync timestamp to rm_agent_config
ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS price_sheet_url TEXT,
  ADD COLUMN IF NOT EXISTS price_sheet_last_sync TIMESTAMPTZ;
