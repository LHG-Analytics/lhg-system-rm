-- Adiciona contexto estratégico compartilhado e regras de ajuste dinâmico à configuração do agente RM

ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS shared_context    TEXT,
  ADD COLUMN IF NOT EXISTS pricing_thresholds JSONB;

-- shared_context: texto livre com decisões estratégicas, contexto histórico e notas da unidade
--   Injetado no system prompt de TODAS as conversas do agente nessa unidade
--   Permite que conhecimento institucional (ex: "em carnaval sempre lotamos") persista entre sessões

-- pricing_thresholds: regras de ajuste dinâmico por faixa de giro/ocupação
--   Estrutura esperada: { giro_high, giro_low, ocupacao_high, ocupacao_low, adjustment_pct }
--   Exemplo: { "giro_high": 3.5, "giro_low": 2.0, "ocupacao_high": 80, "ocupacao_low": 40, "adjustment_pct": 10 }
