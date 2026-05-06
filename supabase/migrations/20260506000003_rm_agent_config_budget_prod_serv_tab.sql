-- Adiciona coluna configurável para a aba de Produtos e Serviços no Google Sheets
-- Permite que cada unidade aponte para o nome correto da aba (padrão: 'Produtos e Serviços-Com')

ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS budget_prod_serv_tab TEXT DEFAULT 'Produtos e Serviços-Com';
