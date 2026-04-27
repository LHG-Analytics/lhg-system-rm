-- Calendário de eventualidades: registro de eventos que afetaram o desempenho da unidade
-- O agente RM injeta esses eventos no contexto ao analisar períodos sobrepostos

CREATE TABLE IF NOT EXISTS unit_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  event_date         DATE NOT NULL,
  event_end_date     DATE,
  event_type         TEXT NOT NULL DEFAULT 'neutro'
                       CHECK (event_type IN ('positivo', 'negativo', 'neutro')),
  impact_description TEXT,
  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para buscas por data (principal acesso pattern)
CREATE INDEX IF NOT EXISTS unit_events_unit_date
  ON unit_events (unit_id, event_date DESC);

-- RLS
ALTER TABLE unit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_events: leitura por usuários da unidade"
  ON unit_events FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      current_user_role() = 'super_admin'
      OR unit_id = current_user_unit_id()
    )
  );

CREATE POLICY "unit_events: inserção por manager+"
  ON unit_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    current_user_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "unit_events: atualização por manager+"
  ON unit_events FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND
    current_user_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "unit_events: exclusão por admin+"
  ON unit_events FOR DELETE
  USING (
    auth.uid() IS NOT NULL AND
    current_user_role() IN ('super_admin', 'admin')
  );

-- Realtime para atualização live na UI de admin
ALTER PUBLICATION supabase_realtime ADD TABLE unit_events;
