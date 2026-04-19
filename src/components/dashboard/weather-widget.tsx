'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Droplets, Thermometer, Wind } from 'lucide-react'
import type { WeatherResult } from '@/lib/agente/weather'

interface WeatherWidgetProps {
  result: WeatherResult
}

const WEATHER_ICONS: Record<string, string> = {
  'céu limpo':         '☀️',
  'algumas nuvens':    '🌤️',
  'nuvens dispersas':  '⛅',
  'nublado':           '☁️',
  'chuva leve':        '🌦️',
  'chuva moderada':    '🌧️',
  'chuva forte':       '🌧️',
  'trovoada':          '⛈️',
  'neve':              '❄️',
  'névoa':             '🌫️',
  'neblina':           '🌫️',
  'garoa':             '🌦️',
}

function weatherIcon(description: string): string {
  const lower = description.toLowerCase()
  for (const [key, icon] of Object.entries(WEATHER_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return '🌡️'
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T12:00:00Z').getUTCDay()
  return day === 0 || day === 5 || day === 6
}

function ptDayShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return `${days[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function WeatherWidget({ result }: WeatherWidgetProps) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('weather-collapsed') === 'true') } catch {}
  }, [])

  function toggle() {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem('weather-collapsed', String(next)) } catch {}
      return next
    })
  }

  if (result.status === 'unconfigured') return null
  if (result.status === 'error') return null

  const { city, current, forecast } = result

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header clicável para colapsar */}
      <button
        onClick={toggle}
        className="w-full px-5 py-3 border-b flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Thermometer className="size-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold">Clima — {city}</h2>
          {collapsed ? (
            <span className="text-xs text-muted-foreground">
              {weatherIcon(current.description)} {current.temp}°C · {current.description}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">impacto na demanda</span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          : <ChevronUp className="size-4 text-muted-foreground shrink-0" />
        }
      </button>

      {!collapsed && (
        <>
          <div className="px-5 py-4 flex flex-col sm:flex-row gap-5 items-stretch">
            {/* Condição atual */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-4xl leading-none">{weatherIcon(current.description)}</span>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tabular-nums">{current.temp}°</span>
                  <span className="text-sm text-muted-foreground">C</span>
                </div>
                <p className="text-sm text-foreground/80 mt-0.5">{current.description}</p>
              </div>
              <div className="flex flex-col gap-1 ml-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Thermometer className="size-3" />
                  Sente {current.feelsLike}°C
                </span>
                <span className="flex items-center gap-1">
                  <Droplets className="size-3" />
                  {current.humidity}% umidade
                </span>
                <span className="flex items-center gap-1">
                  <Wind className="size-3" />
                  {current.windSpeed} km/h
                </span>
              </div>
            </div>

            {/* Previsão — cards preenchem todo o espaço disponível */}
            {forecast.length > 0 && (
              <div className="flex-1 flex gap-2 sm:border-l sm:pl-5">
                {forecast.map((day) => {
                  const weekend = isWeekend(day.date)
                  return (
                    <div
                      key={day.date}
                      className={`flex flex-col flex-1 items-center gap-1 rounded-lg px-2 py-2 text-center ${
                        weekend
                          ? 'bg-amber-500/10 border border-amber-500/20'
                          : 'bg-muted/40'
                      }`}
                    >
                      <span className={`text-[11px] font-semibold leading-tight ${weekend ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {ptDayShort(day.date)}
                      </span>
                      <span className="text-lg leading-none">{weatherIcon(day.description)}</span>
                      <span className="text-xs tabular-nums text-foreground/70">
                        {day.min}–{day.max}°
                      </span>
                      {weekend && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400 uppercase">
                          FDS
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="px-5 py-2 border-t bg-muted/20">
            <p className="text-[11px] text-muted-foreground">
              Calor intenso em FDS tende a elevar giro em períodos curtos. Chuva e frio reduzem demanda de curto prazo.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
