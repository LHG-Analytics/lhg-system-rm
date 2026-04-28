-- Modo de contexto por conversa: 'org' inclui contexto compartilhado da unidade,
-- 'personal' usa apenas dados operacionais (KPIs, preços, clima) sem memória coletiva.

ALTER TABLE rm_conversations
  ADD COLUMN IF NOT EXISTS context_mode TEXT NOT NULL DEFAULT 'org'
    CHECK (context_mode IN ('org', 'personal'));
