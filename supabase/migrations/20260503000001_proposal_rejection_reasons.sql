-- Captura motivo estruturado de rejeição em propostas de preço e desconto.
-- Sem isso, perdemos sinal precioso de feedback humano: o agente nunca aprende
-- por que uma proposta foi rejeitada, então repete os mesmos erros.

ALTER TABLE public.price_proposals
  ADD COLUMN IF NOT EXISTS rejection_reason_type TEXT
    CHECK (rejection_reason_type IS NULL OR rejection_reason_type IN (
      'precos_muito_altos',
      'precos_muito_baixos',
      'estrategia_inadequada',
      'item_especifico_errado',
      'momento_inadequado',
      'concorrencia_nao_considerada',
      'margem_insuficiente',
      'outro'
    )),
  ADD COLUMN IF NOT EXISTS rejection_reason_text TEXT,
  ADD COLUMN IF NOT EXISTS rejected_items JSONB;

ALTER TABLE public.discount_proposals
  ADD COLUMN IF NOT EXISTS rejection_reason_type TEXT
    CHECK (rejection_reason_type IS NULL OR rejection_reason_type IN (
      'desconto_alto_demais',
      'desconto_baixo_demais',
      'condicao_inadequada',
      'momento_inadequado',
      'outro'
    )),
  ADD COLUMN IF NOT EXISTS rejection_reason_text TEXT,
  ADD COLUMN IF NOT EXISTS rejected_items JSONB;
