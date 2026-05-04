import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Lições estruturadas: rm_pricing_lessons (HV2 / LHG-171).
 *
 * Substitui o filtro "últimas N propostas aprovadas" do buildStrategicMemoryBlock
 * por filtro de relevância contextual:
 *   - similaridade scope (categoria/período/dia)
 *   - similaridade contextual (estação, clima, eventos)
 *   - decay temporal (lições antigas pesam menos)
 *
 * O agente recebe top 5 lições mais relevantes ao cenário atual em vez de
 * sempre as 3 mais recentes.
 */

export interface LessonRow {
  id:                   string
  proposal_id:          string | null
  checkpoint_days:      number
  categoria:            string
  periodo:              string
  dia_tipo:             string
  canal:                string | null
  preco_anterior:       number
  preco_novo:           number
  variacao_pct:         number
  delta_revpar_pct:     number | null
  delta_giro_pct:       number | null
  delta_ocupacao_pp:    number | null
  delta_ticket_pct:     number | null
  attributed_pricing_pct: number | null
  implied_elasticity:   number | null
  conditions:           Record<string, unknown> | null
  verdict:              'success' | 'neutral' | 'failure'
  observed_at:          string
}

export interface LessonScenario {
  /** Cenário sendo avaliado — para scoring de relevância */
  categorias?:  string[]      // categorias presentes na proposta atual
  periodos?:    string[]
  dias_tipo?:   string[]
  canais?:      string[]
  weather_condition?: string  // categorizado (chuvoso, ensolarado, ...)
  events?:      string[]      // títulos de eventos ativos
  season_label?: string       // "alta", "media", "baixa" — opcional
}

export interface ScoredLesson extends LessonRow {
  relevance_score: number
}

const VERDICT_LABEL: Record<LessonRow['verdict'], string> = {
  success: '✅ sucesso',
  neutral: '⚪ neutro',
  failure: '❌ falha',
}

const DIA_LABEL: Record<string, string> = {
  semana:      'Semana',
  fds_feriado: 'FDS/Feriado',
  todos:       'Todos',
}

function getAdmin() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Score de relevância para uma lição:
 *   +3 mesmo categoria + periodo + dia_tipo
 *   +2 mesmo categoria + periodo
 *   +1 mesma categoria
 *   +1 mesma condição climática (se ambas tiverem)
 *   +1 mesmo evento ativo (interseção não-vazia)
 *   -1 a cada 30 dias de idade (limite -6)
 */
function scoreLesson(lesson: LessonRow, scenario: LessonScenario, todayMs: number): number {
  let score = 0

  const inCategorias = scenario.categorias?.includes(lesson.categoria) ?? false
  const inPeriodos   = scenario.periodos?.includes(lesson.periodo) ?? false
  const inDias       = scenario.dias_tipo?.includes(lesson.dia_tipo) ?? false

  if (inCategorias && inPeriodos && inDias) score += 3
  else if (inCategorias && inPeriodos)      score += 2
  else if (inCategorias)                    score += 1

  // Similaridade contextual
  const cond = (lesson.conditions ?? {}) as { weather_condition?: string; events?: string[] }
  if (scenario.weather_condition && cond.weather_condition && scenario.weather_condition === cond.weather_condition) {
    score += 1
  }
  if (scenario.events?.length && Array.isArray(cond.events) && cond.events.some((e) => scenario.events!.includes(e))) {
    score += 1
  }

  // Decay por idade (até -6)
  const ageDays = (todayMs - new Date(lesson.observed_at).getTime()) / (24 * 3600 * 1000)
  const decay = Math.min(6, Math.floor(ageDays / 30))
  score -= decay

  return score
}

/**
 * Busca lições da unidade nos últimos 180 dias e retorna as top N
 * mais relevantes ao cenário, com score >= 1 (descarta ruído).
 */
export async function getRelevantLessons(
  unitId: string,
  scenario: LessonScenario,
  limit = 5,
): Promise<ScoredLesson[]> {
  const admin = getAdmin()
  const cutoff = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString()

  const { data } = await admin
    .from('rm_pricing_lessons')
    .select('*')
    .eq('unit_id', unitId)
    .gte('observed_at', cutoff)
    .order('observed_at', { ascending: false })
    .limit(100)

  if (!data || data.length === 0) return []

  const todayMs = Date.now()
  const scored = (data as unknown as LessonRow[]).map((l) => ({
    ...l,
    relevance_score: scoreLesson(l, scenario, todayMs),
  }))

  return scored
    .filter((l) => l.relevance_score >= 1)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit)
}

/**
 * Bloco markdown para injetar no system prompt do agente.
 * Vazio quando não há lições relevantes — o agente continua usando
 * o buildStrategicMemoryBlock como fallback de "memória recente".
 */
export function buildLessonsBlock(lessons: ScoredLesson[]): string {
  if (!lessons.length) return ''

  const lines = lessons.map((l) => {
    const date = new Date(l.observed_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    })
    const dia = DIA_LABEL[l.dia_tipo] ?? l.dia_tipo
    const variacaoStr = `${l.variacao_pct >= 0 ? '+' : ''}${l.variacao_pct.toFixed(1)}%`
    const revpar = l.delta_revpar_pct != null
      ? `RevPAR ${l.delta_revpar_pct >= 0 ? '+' : ''}${l.delta_revpar_pct.toFixed(1)}%`
      : 'RevPAR n/d'
    const giro = l.delta_giro_pct != null
      ? `giro ${l.delta_giro_pct >= 0 ? '+' : ''}${l.delta_giro_pct.toFixed(1)}%`
      : ''
    const attribParts = [revpar, giro].filter(Boolean).join(', ')

    let attribDetails = ''
    if (l.attributed_pricing_pct != null) {
      attribDetails = ` _(atribuído ao preço: ${l.attributed_pricing_pct >= 0 ? '+' : ''}${l.attributed_pricing_pct.toFixed(1)}%)_`
    }

    return `| ${date} | ${l.categoria} | ${l.periodo} | ${dia} | ${variacaoStr} | ${attribParts}${attribDetails} | ${VERDICT_LABEL[l.verdict]} | ${l.checkpoint_days}d |`
  }).join('\n')

  return `## Lições aprendidas em propostas anteriores _(filtradas por similaridade ao cenário atual)_

| Quando | Categoria | Período | Dia | Δ% aplicado | Resultado observado | Veredito | Janela |
|--------|-----------|---------|-----|-------------|---------------------|----------|--------|
${lines}

> Use estas lições para calibrar a magnitude e direção da próxima proposta:
> - Se uma lição com cenário similar deu **falha**, recue da direção repetida.
> - Se deu **sucesso**, considere intensificar.
> - Lições com elasticidade negativa abaixo de -1.0 indicam demanda elástica — aumentos custam volume desproporcional.`
}

/**
 * Conveniência: busca lições e já formata o bloco markdown.
 * Usado por chat e proposals para injeção direta.
 */
export async function buildLessonsBlockForUnit(
  unitId: string,
  scenario: LessonScenario,
): Promise<string> {
  const lessons = await getRelevantLessons(unitId, scenario).catch(() => [])
  return buildLessonsBlock(lessons)
}
