import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// Modelo primário: Claude Sonnet 4.5 via OpenRouter
export const PRIMARY_MODEL = openrouter('anthropic/claude-sonnet-4-5')

// Modelo de fallback para tasks menos críticas
export const FALLBACK_MODEL = openrouter('google/gemini-2.0-flash')

// Mantido para compatibilidade — sem opções extras necessárias no OpenRouter
export const gatewayOptions: Record<string, never> = {}
