import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * Modelo estratégico — usado em chat, geração de propostas e revisões agendadas.
 * Foco: raciocínio, texto de estratégia de preços e recomendações de RM.
 * Fallback: nvidia/nemotron-3-super-120b-a12b:free
 */
export const STRATEGY_MODEL = openrouter('openai/gpt-oss-120b')
export const strategyOptions = {
  openrouter: { models: ['nvidia/nemotron-3-super-120b-a12b:free'] },
}

/**
 * Modelo analítico — usado em importação de planilhas, análise de concorrentes.
 * Foco: parsing de CSV/JSON, cálculos de KPIs, comparação direta de valores.
 * Fallback: google/gemma-4-31b-it:free
 */
export const ANALYSIS_MODEL = openrouter('google/gemma-4-31b-it:free')
export const analysisOptions = {
  openrouter: { models: ['google/gemma-4-31b-it:free'] },
}

// Alias retrocompatível — aponta para o modelo estratégico
export const PRIMARY_MODEL = STRATEGY_MODEL

// Mantido para compatibilidade de assinatura em rotas não migradas
export const gatewayOptions = strategyOptions
