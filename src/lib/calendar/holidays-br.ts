/**
 * Feriados nacionais, estaduais e datas comerciais relevantes para motel.
 * Substitui necessidade de package externo — controlamos a lista, podemos
 * adicionar contexto de impacto específico do negócio.
 *
 * Uso:
 *   const events = generateHolidaysForYear(2026, 'Sao Paulo,BR')
 *   // → [{ title, event_date, event_end_date, event_type, impact_description }, ...]
 */

export type EventType = 'positivo' | 'negativo' | 'neutro'

export interface HolidayEvent {
  title: string
  event_date: string         // YYYY-MM-DD
  event_end_date: string | null
  event_type: EventType
  impact_description: string | null
}

// ─── Algoritmo de Páscoa (Gauss/Meeus) ────────────────────────────────────────
// Calcula a data da Páscoa para qualquer ano gregoriano.
function computeEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)  // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  // weekday: 0=domingo, 6=sábado. n=1..5
  const first = new Date(year, month - 1, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7)
}

// ─── Geração de eventos por ano ──────────────────────────────────────────────

const NATIONAL_HOLIDAYS = [
  { mm: '01', dd: '01', title: 'Confraternização Universal',         type: 'neutro'   as EventType, desc: 'Feriado nacional. Demanda variável conforme dia da semana.' },
  { mm: '04', dd: '21', title: 'Tiradentes',                          type: 'positivo' as EventType, desc: 'Feriado nacional. Aumento de demanda quando emendado.' },
  { mm: '05', dd: '01', title: 'Dia do Trabalhador',                  type: 'positivo' as EventType, desc: 'Feriado nacional. Aumento de demanda quando emendado.' },
  { mm: '09', dd: '07', title: 'Independência do Brasil',             type: 'positivo' as EventType, desc: 'Feriado nacional. Aumento de demanda quando emendado.' },
  { mm: '10', dd: '12', title: 'N. Sra. Aparecida',                   type: 'positivo' as EventType, desc: 'Feriado nacional. Aumento de demanda quando emendado.' },
  { mm: '11', dd: '02', title: 'Finados',                             type: 'neutro'   as EventType, desc: 'Feriado nacional. Demanda variável.' },
  { mm: '11', dd: '15', title: 'Proclamação da República',            type: 'positivo' as EventType, desc: 'Feriado nacional. Aumento de demanda quando emendado.' },
  { mm: '12', dd: '25', title: 'Natal',                               type: 'neutro'   as EventType, desc: 'Demanda baixa na noite anterior, aumenta na noite de 25/12.' },
]

const COMMERCIAL_DATES = [
  { mm: '02', dd: '14', title: 'Valentine\'s Day',           type: 'positivo' as EventType, desc: 'Demanda alta — segundo apenas ao Dia dos Namorados.' },
  { mm: '03', dd: '08', title: 'Dia Internacional da Mulher', type: 'positivo' as EventType, desc: 'Demanda alta — relevante para casais e celebrações.' },
  { mm: '06', dd: '12', title: 'Dia dos Namorados',          type: 'positivo' as EventType, desc: 'Pico anual de demanda do segmento. Tarifas premium absorvidas.' },
  { mm: '12', dd: '31', title: 'Réveillon',                  type: 'positivo' as EventType, desc: 'Pernoite de alta demanda. Tarifa premium.' },
]

// Estaduais por cidade (city é o valor de rm_agent_config.city, ex: "Sao Paulo,BR")
const STATE_HOLIDAYS: Record<string, Array<{ mm: string; dd: string; title: string; type: EventType; desc: string }>> = {
  'Sao Paulo,BR': [
    { mm: '07', dd: '09', title: 'Revolução Constitucionalista (SP)', type: 'positivo', desc: 'Feriado estadual de SP. Aumento quando emendado.' },
    { mm: '11', dd: '20', title: 'Dia da Consciência Negra (SP)',     type: 'positivo', desc: 'Feriado estadual de SP. Aumento quando emendado.' },
  ],
  'Brasilia,BR': [
    { mm: '11', dd: '30', title: 'Dia do Evangélico (DF)',            type: 'neutro',   desc: 'Feriado distrital de Brasília.' },
  ],
  'Campinas,BR': [
    { mm: '07', dd: '14', title: 'Aniversário de Campinas',           type: 'neutro',   desc: 'Feriado municipal.' },
    { mm: '12', dd: '08', title: 'Dia da Padroeira (Campinas)',       type: 'neutro',   desc: 'Feriado municipal.' },
  ],
}

export function generateHolidaysForYear(year: number, city: string | null = null): HolidayEvent[] {
  const events: HolidayEvent[] = []

  // Feriados fixos nacionais
  for (const h of NATIONAL_HOLIDAYS) {
    events.push({
      title: h.title,
      event_date: `${year}-${h.mm}-${h.dd}`,
      event_end_date: null,
      event_type: h.type,
      impact_description: h.desc,
    })
  }

  // Datas comerciais
  for (const c of COMMERCIAL_DATES) {
    events.push({
      title: c.title,
      event_date: `${year}-${c.mm}-${c.dd}`,
      event_end_date: null,
      event_type: c.type,
      impact_description: c.desc,
    })
  }

  // Dia das Mães — 2º domingo de maio
  const mothersDay = nthWeekdayOfMonth(year, 5, 0, 2)
  events.push({
    title: 'Dia das Mães',
    event_date: isoDate(mothersDay),
    event_end_date: null,
    event_type: 'positivo',
    impact_description: 'Demanda elevada no FDS. Almoços/jantares aumentam noite anterior e da data.',
  })

  // Dia dos Pais — 2º domingo de agosto
  const fathersDay = nthWeekdayOfMonth(year, 8, 0, 2)
  events.push({
    title: 'Dia dos Pais',
    event_date: isoDate(fathersDay),
    event_end_date: null,
    event_type: 'positivo',
    impact_description: 'Demanda elevada no FDS. Atenção à noite anterior.',
  })

  // Carnaval — sexta-feira de Carnaval (Páscoa - 49) até quarta-feira de Cinzas (Páscoa - 46)
  const easter = computeEaster(year)
  const carnavalSexta = new Date(easter); carnavalSexta.setDate(easter.getDate() - 49)
  const cinzas        = new Date(easter); cinzas.setDate(easter.getDate() - 46)
  events.push({
    title: 'Carnaval',
    event_date: isoDate(carnavalSexta),
    event_end_date: isoDate(cinzas),
    event_type: 'positivo',
    impact_description: 'Período de alta demanda — sexta a quarta-feira de Cinzas. Tarifas premium absorvidas.',
  })

  // Sexta-feira da Paixão — Páscoa - 2
  const sextaPaixao = new Date(easter); sextaPaixao.setDate(easter.getDate() - 2)
  events.push({
    title: 'Sexta-feira da Paixão',
    event_date: isoDate(sextaPaixao),
    event_end_date: null,
    event_type: 'positivo',
    impact_description: 'Feriado nacional. Início do feriado de Páscoa — emendas ampliam impacto.',
  })

  // Páscoa
  events.push({
    title: 'Páscoa',
    event_date: isoDate(easter),
    event_end_date: null,
    event_type: 'neutro',
    impact_description: 'Domingo de Páscoa. Demanda concentrada em famílias.',
  })

  // Corpus Christi — Páscoa + 60 dias
  const corpusChristi = new Date(easter); corpusChristi.setDate(easter.getDate() + 60)
  events.push({
    title: 'Corpus Christi',
    event_date: isoDate(corpusChristi),
    event_end_date: null,
    event_type: 'positivo',
    impact_description: 'Feriado de quinta-feira. Aumento quando emendado para sexta + FDS.',
  })

  // Estaduais por cidade
  const stateList = city ? STATE_HOLIDAYS[city] ?? [] : []
  for (const s of stateList) {
    events.push({
      title: s.title,
      event_date: `${year}-${s.mm}-${s.dd}`,
      event_end_date: null,
      event_type: s.type,
      impact_description: s.desc,
    })
  }

  // Ordena por data
  return events.sort((a, b) => a.event_date.localeCompare(b.event_date))
}
