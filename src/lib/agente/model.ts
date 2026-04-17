import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * Modelo único para todas as operações — chat, propostas, cron, import, concorrentes.
 * BYOK via chave OpenAI própria no OpenRouter — sem limite de quota gratuita.
 */
export const STRATEGY_MODEL = openrouter('openai/gpt-4.1-mini')
export const strategyOptions = {}

export const ANALYSIS_MODEL = openrouter('openai/gpt-4.1-mini')
export const analysisOptions = {}

// Aliases retrocompatíveis
export const PRIMARY_MODEL  = STRATEGY_MODEL
export const gatewayOptions = strategyOptions
