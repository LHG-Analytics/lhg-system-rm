import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// Modelo primário: Google Gemma 3 27B (gratuito)
export const PRIMARY_MODEL = openrouter('google/gemma-4-26b-a4b-it:free')

// Modelo de fallback para tasks menos críticas
export const FALLBACK_MODEL = openrouter('nvidia/nemotron-3-super-120b-a12b:free')

// Mantido para compatibilidade — sem opções extras necessárias no OpenRouter
export const gatewayOptions: Record<string, never> = {}
