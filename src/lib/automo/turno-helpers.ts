import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export interface TurnoBand {
  key:       'pico' | 'fora_pico' | 'diurno' | 'noturno'
  label:     string
  startHour: number // inclusivo
  endHour:   number // exclusivo — mesma convenção de rm_agent_config.peak_end
}

const DEFAULT_TURNOS: [TurnoBand, TurnoBand] = [
  { key: 'diurno',  label: 'Diurno',  startHour: 6,  endHour: 18 },
  { key: 'noturno', label: 'Noturno', startHour: 18, endHour: 6  },
]

/**
 * Retorna os 2 turnos configurados para a unidade.
 * Unidades com pricing_method='giro_uplift' (ex: LIV) usam a janela de pico
 * já configurada em rm_agent_config (peak_start/peak_end) — "Pico" vs "Fora de pico".
 * Demais unidades usam a divisão fixa diurno (06h–17:59h) / noturno (18h–05:59h),
 * já usada na precificação por banda (day-band-grid.ts / band-demand.ts).
 */
export async function getUnitTurnos(unitSlug: string): Promise<[TurnoBand, TurnoBand]> {
  const admin = adminClient()
  const { data: unit } = await admin.from('units').select('id').eq('slug', unitSlug).single()
  if (!unit) return DEFAULT_TURNOS

  const { data: config } = await admin
    .from('rm_agent_config')
    .select('pricing_method, peak_start, peak_end')
    .eq('unit_id', unit.id)
    .maybeSingle()

  if (config?.pricing_method === 'giro_uplift') {
    const start = config.peak_start ?? 15
    const end   = config.peak_end   ?? 21
    return [
      { key: 'pico',      label: 'Pico',        startHour: start, endHour: end   },
      { key: 'fora_pico', label: 'Fora de pico', startHour: end,   endHour: start },
    ]
  }
  return DEFAULT_TURNOS
}

/**
 * Gera fragmento SQL CASE que classifica uma hora (0-23) no turno[0] ou turno[1].
 * `hourExpr` deve ser uma expressão SQL que resolve para a hora (int 0-23), ex:
 * "EXTRACT(HOUR FROM la.datainicialdaocupacao)::int". Suporta wrap-around.
 */
export function buildTurnoCaseSQL(turnos: [TurnoBand, TurnoBand], hourExpr: string): string {
  const [a, b] = turnos
  const cond = a.startHour < a.endHour
    ? `${hourExpr} >= ${a.startHour} AND ${hourExpr} < ${a.endHour}`
    : `(${hourExpr} >= ${a.startHour} OR ${hourExpr} < ${a.endHour})`
  return `CASE WHEN ${cond} THEN '${a.label}' ELSE '${b.label}' END`
}
