// Módulo de contexto climático — OpenWeatherMap

export interface WeatherDay {
  date: string        // YYYY-MM-DD
  min: number
  max: number
  description: string
  icon?: string       // OWM icon code ex: "01d", "10d"
}

export interface WeatherCurrent {
  temp: number
  feelsLike: number
  humidity: number
  windSpeed: number
  description: string
  icon?: string       // OWM icon code
}

export type WeatherResult =
  | { status: 'unconfigured' }
  | { status: 'error'; message: string }
  | { status: 'ok'; city: string; current: WeatherCurrent; forecast: WeatherDay[] }

/** Busca clima atual + previsão 5 dias e retorna dados estruturados para o widget. */
export async function fetchWeatherData(city: string): Promise<WeatherResult> {
  const key = process.env.OPENWEATHERMAP_API_KEY
  if (!key) return { status: 'unconfigured' }

  try {
    const base = 'https://api.openweathermap.org/data/2.5'
    const params = `q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=pt`

    const [currentRes, forecastRes] = await Promise.allSettled([
      fetch(`${base}/weather?${params}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${base}/forecast?${params}&cnt=56`, { signal: AbortSignal.timeout(5000) }),
    ])

    if (currentRes.status !== 'fulfilled' || !currentRes.value.ok) {
      return { status: 'error', message: 'Falha ao conectar com OpenWeatherMap' }
    }

    const current = await currentRes.value.json() as OWMCurrentResponse

    // Data de hoje no fuso BRT (America/Sao_Paulo)
    const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const todayBRT = `${nowBRT.getFullYear()}-${String(nowBRT.getMonth() + 1).padStart(2, '0')}-${String(nowBRT.getDate()).padStart(2, '0')}`

    const forecast: WeatherDay[] = []
    if (forecastRes.status === 'fulfilled' && forecastRes.value.ok) {
      const forecastData = await forecastRes.value.json() as OWMForecastResponse
      const byDay = new Map<string, { min: number; max: number; descs: string[]; icons: string[] }>()
      for (const item of forecastData.list) {
        const day = item.dt_txt.slice(0, 10)
        const icon = item.weather[0]?.icon ?? ''
        const existing = byDay.get(day)
        if (existing) {
          existing.min = Math.min(existing.min, item.main.temp_min)
          existing.max = Math.max(existing.max, item.main.temp_max)
          existing.descs.push(item.weather[0]?.description ?? '')
          if (icon.endsWith('d')) existing.icons.push(icon)
        } else {
          byDay.set(day, {
            min: item.main.temp_min,
            max: item.main.temp_max,
            descs: [item.weather[0]?.description ?? ''],
            icons: icon.endsWith('d') ? [icon] : [],
          })
        }
      }
      for (const [date, d] of byDay) {
        if (date < todayBRT) continue  // usa BRT — não pula o dia atual
        const modeDesc = d.descs.sort((a, b) =>
          d.descs.filter((v) => v === b).length - d.descs.filter((v) => v === a).length
        )[0] ?? ''
        const modeIcon = d.icons.length
          ? d.icons.sort((a, b) =>
              d.icons.filter((v) => v === b).length - d.icons.filter((v) => v === a).length
            )[0]
          : undefined
        forecast.push({ date, min: Math.round(d.min), max: Math.round(d.max), description: capitalize(modeDesc), icon: modeIcon })
        if (forecast.length >= 6) break
      }
    }

    return {
      status: 'ok',
      city: current.name,
      current: {
        temp: Math.round(current.main.temp),
        feelsLike: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        windSpeed: Math.round(current.wind.speed * 3.6),
        description: capitalize(current.weather[0]?.description ?? ''),
        icon: current.weather[0]?.icon,
      },
      forecast,
    }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}

interface OWMCurrentResponse {
  name: string
  main: { temp: number; feels_like: number; humidity: number; temp_min: number; temp_max: number }
  weather: Array<{ description: string; icon: string }>
  wind: { speed: number }
}

interface OWMForecastResponse {
  list: Array<{
    dt: number
    main: { temp: number; temp_min: number; temp_max: number }
    weather: Array<{ description: string; icon: string }>
    dt_txt: string
  }>
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function ptDayName(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${days[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Busca clima atual + previsão 3 dias e retorna bloco markdown para o system prompt.
 *  Retorna null se OPENWEATHERMAP_API_KEY não estiver configurada ou houver erro. */
export async function fetchWeatherContext(city: string): Promise<string | null> {
  const key = process.env.OPENWEATHERMAP_API_KEY
  if (!key) return null

  try {
    const base = 'https://api.openweathermap.org/data/2.5'
    const params = `q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=pt`

    const [currentRes, forecastRes] = await Promise.allSettled([
      fetch(`${base}/weather?${params}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${base}/forecast?${params}&cnt=24`, { signal: AbortSignal.timeout(5000) }),
    ])

    if (currentRes.status !== 'fulfilled' || !currentRes.value.ok) return null
    const current = await currentRes.value.json() as OWMCurrentResponse

    const cityName = current.name
    const temp = Math.round(current.main.temp)
    const feelsLike = Math.round(current.main.feels_like)
    const humidity = current.main.humidity
    const desc = capitalize(current.weather[0]?.description ?? '')

    let forecastBlock = ''
    if (forecastRes.status === 'fulfilled' && forecastRes.value.ok) {
      const forecast = await forecastRes.value.json() as OWMForecastResponse

      // Agrupa por dia (YYYY-MM-DD) e pega min/max + descrição predominante
      const byDay = new Map<string, { min: number; max: number; descs: string[] }>()
      for (const item of forecast.list) {
        const day = item.dt_txt.slice(0, 10)
        const existing = byDay.get(day)
        if (existing) {
          existing.min = Math.min(existing.min, item.main.temp_min)
          existing.max = Math.max(existing.max, item.main.temp_max)
          existing.descs.push(item.weather[0]?.description ?? '')
        } else {
          byDay.set(day, {
            min: item.main.temp_min,
            max: item.main.temp_max,
            descs: [item.weather[0]?.description ?? ''],
          })
        }
      }

      // Pega próximos 3 dias (exclui hoje)
      const today = new Date().toISOString().slice(0, 10)
      const nextDays = [...byDay.entries()]
        .filter(([d]) => d > today)
        .slice(0, 3)

      if (nextDays.length > 0) {
        const lines = nextDays.map(([dateStr, d]) => {
          const descDay = capitalize(
            d.descs.sort((a, b) =>
              d.descs.filter((v) => v === b).length - d.descs.filter((v) => v === a).length
            )[0] ?? ''
          )
          return `- ${ptDayName(dateStr)}: ${Math.round(d.min)}–${Math.round(d.max)}°C, ${descDay}`
        })
        forecastBlock = `**Próximos dias:**\n${lines.join('\n')}`
      }
    }

    return `## Clima — ${cityName}
**Agora:** ${temp}°C (sensação ${feelsLike}°C) · ${desc} · Umidade ${humidity}%
${forecastBlock}

> Use os dados climáticos para contextualizar a demanda esperada: calor intenso e FDS tende a elevar giro em períodos curtos; chuva pesada e dias frios reduzem a demanda de curto prazo.`
  } catch {
    return null
  }
}
