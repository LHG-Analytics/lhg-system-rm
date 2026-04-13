ALTER TABLE rm_agent_config ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Popula CEPs por unidade (join via units.slug)
UPDATE rm_agent_config
SET postal_code = u.cep
FROM (VALUES
  ('lush-ipiranga', '01516-100'),
  ('lush-lapa',     '05095-035'),
  ('tout',          '13097-104'),
  ('andar-de-cima', '01220-020'),
  ('altana',        '73053-010')
) AS u(slug, cep)
JOIN units ON units.slug = u.slug
WHERE rm_agent_config.unit_id = units.id;
