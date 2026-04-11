import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/**
 * Modelo estratégico — usado em chat, geração de propostas e revisões agendadas.
 * Foco: raciocínio, texto de estratégia de preços e recomendações de RM.
 */
export const STRATEGY_MODEL = openrouter('openai/gpt-oss-120b')

/**
 * Modelo analítico — usado em importação de planilhas, análise de concorrentes.
 * Foco: parsing de CSV/JSON, cálculos de KPIs, comparação direta de valores.
 */
export const ANALYSIS_MODEL = openrouter('qwen/qwen3-next-80b')

// Alias retrocompatível — aponta para o modelo estratégico
export const PRIMARY_MODEL = STRATEGY_MODEL

// Mantido para compatibilidade de assinatura nas rotas
export const gatewayOptions: Record<string, never> = {}
