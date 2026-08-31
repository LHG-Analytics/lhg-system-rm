-- ============================================================
-- scheduled_reviews.conv_id tinha FK pra rm_conversations, mas desde que as
-- revisões passaram a gerar relatórios completos (não mais conversas de chat),
-- run-reviews.ts tentava salvar ali o id de rm_weekly_reports — violando a FK
-- em TODA execução bem-sucedida. O UPDATE falhava silenciosamente (código não
-- checava erro) e a revisão ficava travada em 'running' para sempre, mesmo já
-- tendo concluído (notificação criada, relatório gerado).
--
-- Fix: nova coluna report_id, com FK correta pra rm_weekly_reports. conv_id
-- permanece intocado (sempre null nesse fluxo daqui pra frente).
-- ============================================================

ALTER TABLE public.scheduled_reviews
  ADD COLUMN report_id uuid REFERENCES public.rm_weekly_reports(id) ON DELETE SET NULL;
