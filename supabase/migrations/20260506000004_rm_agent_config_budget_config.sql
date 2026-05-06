-- Substitui budget_sheet_tab + budget_prod_serv_tab por um JSONB configurável
-- que inclui nomes de abas E números de linha para cada métrica.
-- As colunas antigas são mantidas para retrocompat mas não são mais editadas.

ALTER TABLE rm_agent_config
  ADD COLUMN IF NOT EXISTS budget_config JSONB DEFAULT '{
    "locacoes_tab": "Locações-Comp",
    "locacoes_receita_row": 18,
    "locacoes_giro_row": 60,
    "locacoes_revpar_row": 74,
    "prod_serv_tab": "Produtos e Serviços-Com",
    "prod_serv_produtos_row": 18,
    "prod_serv_servicos_row": 26
  }'::jsonb;
