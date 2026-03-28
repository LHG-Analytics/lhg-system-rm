import { gateway } from 'ai'

export const PRIMARY_MODEL = gateway('anthropic/claude-sonnet-4.6')

// Fallback automático via AI Gateway: se Claude falhar, usa Gemini Flash
export const gatewayOptions = {
  gateway: {
    models: ['google/gemini-2.0-flash'],
    tags: ['app:lhg-rm'],
  },
}
