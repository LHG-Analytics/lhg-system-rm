import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// ─── Opções de modelo para o chat do agente ────────────────────────────────────

export interface ChatModelOption {
  id: string
  label: string
  description: string
  tier: 'fast' | 'balanced' | 'powerful' | 'reasoning' | 'max'
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  {
    id: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    description: 'Rápido e econômico',
    tier: 'fast',
  },
  {
    id: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    description: 'Raciocínio aprimorado',
    tier: 'balanced',
  },
  {
    id: 'openai/o4-mini',
    label: 'O4 Mini',
    description: 'Raciocínio avançado',
    tier: 'reasoning',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet',
    description: 'Análise estratégica profunda',
    tier: 'powerful',
  },
  {
    id: 'anthropic/claude-opus-4.7',
    label: 'Claude Opus',
    description: 'Máxima capacidade',
    tier: 'max',
  },
]

export const DEFAULT_CHAT_MODEL_ID = 'openai/gpt-4.1'

/** Cria uma instância de modelo a partir de um ID da lista CHAT_MODEL_OPTIONS */
export function createChatModel(modelId: string) {
  const valid = CHAT_MODEL_OPTIONS.some((m) => m.id === modelId)
  return openrouter(valid ? modelId : DEFAULT_CHAT_MODEL_ID)
}

/**
 * STRATEGY_MODEL — chat do agente, cron de revisões.
 * BYOK via chave OpenAI no OpenRouter; alterar modelo aqui atualiza os limites automaticamente.
 */
export const STRATEGY_MODEL = openrouter('openai/gpt-4.1-mini')
export const strategyOptions = {}
/** Tokens de saída para respostas do chat (análise completa + tabelas + sugerir_respostas). */
export const STRATEGY_MAX_OUTPUT_TOKENS = 8000
/**
 * Máximo de iterações de tool calls por turno do chat.
 * Fluxo máximo esperado: fetch lazy (1-3) + salvar_proposta (1) +
 * buscar_padrao_horario (1) + salvar_proposta_desconto (1) + sugerir_respostas (1) = 8.
 */
export const STRATEGY_MAX_STEPS = 8

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
