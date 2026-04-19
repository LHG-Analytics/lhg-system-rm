import { after } from 'next/server'
import { generateText } from 'ai'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { ANALYSIS_MODEL } from '@/lib/agente/model'
import type { WeatherResult } from '@/lib/agente/weather'
import type { CompanyKPIResponse } from '@/lib/kpis/types'
import type { Database } from '@/types/database.types'

const INSIGHT_TTL_MS = 4 * 60 * 60 * 1000 // 4h

interface InsightCache {
  text: string
  generatedAt: string
}

function getAdmin() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export function categorizeWeather(description: string): string {
  const l = description.toLowerCase()
  if (l.includes('trovoada') || l.includes('tempestade')) return 'trovoada'
  if (l.includes('chuva') || l.includes('garoa') || l.includes('chuvisco')) return 'chuva'
  if (l.includes('névoa') || l.includes('neblina') || l.includes('nevoeiro')) return 'névoa'
  if (l.includes('nublado') || l.includes('nuvens dispersas') || l.includes('algumas nuvens')) return 'nublado'
  if (l.includes('limpo') || l.includes('claro')) return 'ensolarado'
  return 'variável'
}

// Lê observações históricas e calcula médias por condição climática
async function buildCorrelationContext(unitId: string): Promise<string> {
  const admin = getAdmin()
  const { data } = await admin
    .from('rm_weather_observations')
    .select('weather_condition, temp_avg, giro, occupancy_rate, is_weekend')
    .eq('unit_id', unitId)
    .order('observed_date', { ascending: false })
    .limit(120)

  if (!data || data.length < 7) return ''

  type Stats = { giros: number[]; occs: number[] }
  const groups: Record<string, Stats> = {}
  for (const row of data) {
    const key = row.weather_condition ?? 'variável'
    if (!groups[key]) groups[key] = { giros: [], occs: [] }
    if (row.giro != null)          groups[key].giros.push(Number(row.giro))
    if (row.occupancy_rate != null) groups[key].occs.push(Number(row.occupancy_rate))
  }

  const lines: string[] = [`Padrão real observado nesta unidade (${data.length} dias registrados):`]
  for (const [cond, s] of Object.entries(groups)) {
    if (s.giros.length < 3) continue
    const avgGiro = s.giros.reduce((a, b) => a + b, 0) / s.giros.length
    const avgOcc  = s.occs.length > 0 ? s.occs.reduce((a, b) => a + b, 0) / s.occs.length : null
    lines.push(`  ${cond}: giro médio ${avgGiro.toFixed(2)}${avgOcc != null ? `, ocupação ${avgOcc.toFixed(1)}%` : ''} (${s.giros.length} dias)`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function buildPrompt(
  weatherResult: Extract<WeatherResult, { status: 'ok' }>,
  company: CompanyKPIResponse | null,
  correlation: string,
): string {
  const { current, forecast } = weatherResult

  const weatherLines = [`Agora: ${current.temp}°C, ${current.description}`]
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  for (const d of forecast) {
    const dt = new Date(d.date + 'T12:00:00Z')
    weatherLines.push(`${days[dt.getUTCDay()]} ${dt.getUTCDate()}/${dt.getUTCMonth() + 1}: ${d.min}–${d.max}°C, ${d.description}`)
  }

  const r = company?.TotalResult
  const kpiLine = r
    ? `KPIs (período selecionado): giro ${r.totalGiro.toFixed(2)} · ocupação ${r.totalOccupancyRate.toFixed(1)}% · RevPAR R$${r.totalRevpar.toFixed(0)} · ticket R$${r.totalAllTicketAverage.toFixed(0)}`
    : ''

  return `Você é um analista de Revenue Management de motel. Escreva 1-2 frases curtas e diretas sobre o impacto esperado do clima na demanda desta unidade nos próximos dias.

Clima:
${weatherLines.join('\n')}

${kpiLine}

${correlation}

Regras:
- Máximo 2 frases, máximo 200 caracteres no total
- Português, sem markdown
- Foco em implicação prática para precificação (ex: elevar preço FDS, reduzir para semana chuvosa)
- Se houver dados históricos, cite-os com números reais
- Se não houver dados, baseie-se no clima e KPIs atuais`
}

async function generateAndSave(
  unitId: string,
  weatherResult: Extract<WeatherResult, { status: 'ok' }>,
  company: CompanyKPIResponse | null,
): Promise<void> {
  const admin = getAdmin()
  try {
    const correlation = await buildCorrelationContext(unitId)
    const prompt = buildPrompt(weatherResult, company, correlation)

    const { text } = await generateText({
      model: ANALYSIS_MODEL,
      prompt,
      maxOutputTokens: 120,
      temperature: 0.3,
    })

    const cache: InsightCache = { text: text.trim(), generatedAt: new Date().toISOString() }
    await admin
      .from('rm_agent_config')
      .update({ weather_insight_cache: cache as unknown as import('@/types/database.types').Json })
      .eq('unit_id', unitId)
  } catch {
    // Não bloqueia o dashboard
  }
}

/**
 * Retorna o insight climático cacheado (ou null na primeira visita).
 * Se o cache estiver vencido, dispara regeneração em background via after().
 */
export async function getWeatherInsight(
  unitId: string,
  weatherResult: WeatherResult,
  company: CompanyKPIResponse | null,
): Promise<string | null> {
  if (weatherResult.status !== 'ok') return null

  const admin = getAdmin()
  const { data: cfg } = await admin
    .from('rm_agent_config')
    .select('weather_insight_cache')
    .eq('unit_id', unitId)
    .single()

  const cache = cfg?.weather_insight_cache as InsightCache | null | undefined
  const isFresh = !!cache?.text && !!cache.generatedAt &&
    Date.now() - new Date(cache.generatedAt).getTime() < INSIGHT_TTL_MS

  if (!isFresh) {
    // Regenera em background sem bloquear o render da página
    after(() => generateAndSave(unitId, weatherResult, company))
  }

  return cache?.text ?? null
}

/**
 * Registra a observação do dia (chamado pelo cron diário).
 * unit_id + slug + city + weather + KPIs de ontem.
 */
export async function recordWeatherObservation(params: {
  unitId: string
  unitSlug: string
  city: string
  fetchKPIs: (slug: string, date: string) => Promise<CompanyKPIResponse | null>
}): Promise<void> {
  const { unitId, unitSlug, city, fetchKPIs } = params
  const admin = getAdmin()

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yyyy = yesterday.getFullYear()
  const mm   = String(yesterday.getMonth() + 1).padStart(2, '0')
  const dd   = String(yesterday.getDate()).padStart(2, '0')
  const dateIso  = `${yyyy}-${mm}-${dd}`
  const dateLhg  = `${dd}/${mm}/${yyyy}`
  const dayOfWeek = yesterday.getDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6

  // Busca KPIs de ontem
  const kpis = await fetchKPIs(unitSlug, dateLhg)

  // Busca clima atual como proxy (rodando às 07h BRT, é representativo de ontem)
  const { fetchWeatherData } = await import('@/lib/agente/weather')
  const weather = await fetchWeatherData(city)
  if (weather.status !== 'ok') return

  const r = kpis?.TotalResult
  await admin
    .from('rm_weather_observations')
    .upsert({
      unit_id:             unitId,
      observed_date:       dateIso,
      weather_condition:   categorizeWeather(weather.current.description),
      weather_description: weather.current.description,
      temp_avg:            weather.current.temp,
      is_weekend:          isWeekend,
      giro:                r?.totalGiro            ?? null,
      occupancy_rate:      r?.totalOccupancyRate   ?? null,
      revpar:              r?.totalRevpar          ?? null,
      ticket_avg:          r?.totalAllTicketAverage ?? null,
      total_rentals:       r?.totalAllRentalsApartments != null
                             ? Math.round(r.totalAllRentalsApartments) : null,
    }, { onConflict: 'unit_id,observed_date' })
}
