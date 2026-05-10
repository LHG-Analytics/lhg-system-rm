import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * STRATEGY_MODEL — chat do agente, cron de revisões.
 * BYOK via chave OpenAI no OpenRouter; alterar modelo aqui atualiza os limites automaticamente.
 */
export const STRATEGY_MODEL = openrouter('openai/gpt-4.1-mini')
export const strategyOptions = {}
/** Tokens de saída para respostas do chat (análise completa + tabelas + sugerir_respostas). */
export const STRATEGY_MAX_OUTPUT_TOKENS = 8000
/** Máximo de iterações de tool calls por turno do chat. */
export const STRATEGY_MAX_STEPS = 5

/**
 * ANALYSIS_MODEL — geração de propostas, import CSV, análise de concorrentes, relatórios.
 * Requer mais tokens de saída para cobrir cobertura total de linhas (cat × período × dia_tipo).
 */
export const ANALYSIS_MODEL = openrouter('openai/gpt-4.1-mini')
export const analysisOptions = {}
/** Tokens de saída para geração de propostas completas (~72 linhas com justificativas). */
export const ANALYSIS_MAX_OUTPUT_TOKENS = 10000

// Aliases retrocompatíveis
export const PRIMARY_MODEL  = STRATEGY_MODEL
export const gatewayOptions = strategyOptions
