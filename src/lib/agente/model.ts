import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * Modelo estratégico — usado em chat, geração de propostas e revisões agendadas.
 * Foco: raciocínio, texto de estratégia de preços e recomendações de RM.
 * Fallback: minimax/minimax-m2.5:free
 */
export const STRATEGY_MODEL = openrouter('nvidia/nemotron-3-super-120b-a12b:free')
export const strategyOptions = {
  openrouter: { models: ['minimax/minimax-m2.5:free'] },
}

/**
 * Modelo analítico — usado em importação de planilhas, análise de concorrentes.
 * Foco: parsing de CSV/JSON, cálculos de KPIs, comparação direta de valores.
 * BYOK (OpenAI key via OpenRouter) — sem limite de free-models-per-day.
 * Fallback: nvidia/nemotron-3-super-120b-a12b:free
 */
export const ANALYSIS_MODEL = openrouter('openai/gpt-4.1-mini')
export const analysisOptions = {
  openrouter: { models: ['nvidia/nemotron-3-super-120b-a12b:free'] },
}

// Alias retrocompatível — aponta para o modelo estratégico
export const PRIMARY_MODEL = STRATEGY_MODEL

// Mantido para compatibilidade de assinatura em rotas não migradas
export const gatewayOptions = strategyOptions
