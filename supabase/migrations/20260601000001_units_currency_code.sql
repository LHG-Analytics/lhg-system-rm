-- Adiciona código de moeda por unidade
-- DEFAULT 'BRL' garante compatibilidade retroativa com todas as unidades existentes

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'BRL';

-- LIV está em Quito (Equador) → USD
UPDATE units SET currency_code = 'USD' WHERE slug = 'liv';
