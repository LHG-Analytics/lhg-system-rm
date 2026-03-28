-- Adiciona período de vigência à tabela de preços importadas
ALTER TABLE price_imports
  ADD COLUMN IF NOT EXISTS valid_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE;

COMMENT ON COLUMN price_imports.valid_from  IS 'Data a partir da qual essa tabela de preços está vigente';
COMMENT ON COLUMN price_imports.valid_until IS 'Data até quando essa tabela está vigente (NULL = atualmente ativa)';
