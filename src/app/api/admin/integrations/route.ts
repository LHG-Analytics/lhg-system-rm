import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface IntegrationStatus {
  id: string
  name: string
  description: string
  category: 'ia' | 'canais' | 'dados' | 'eventos'
  status: 'connected' | 'not_configured' | 'coming_soon'
  envVar?: string
  docsUrl?: string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const integrations: IntegrationStatus[] = [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      description: 'Roteamento de IA para o Agente RM, análise de planilhas e propostas de preço.',
      category: 'ia',
      status: process.env.OPENROUTER_API_KEY ? 'connected' : 'not_configured',
      envVar: 'OPENROUTER_API_KEY',
    },
    {
      id: 'apify',
      name: 'Apify',
      description: 'Scraping de preços de concorrentes via Playwright e Cheerio.',
      category: 'dados',
      status: process.env.APIFY_API_TOKEN ? 'connected' : 'not_configured',
      envVar: 'APIFY_API_TOKEN',
    },
    {
      id: 'openweather',
      name: 'OpenWeather',
      description: 'Clima em tempo real e previsão de 3 dias injetados no contexto do agente.',
      category: 'eventos',
      status: process.env.OPENWEATHERMAP_API_KEY ? 'connected' : 'not_configured',
      envVar: 'OPENWEATHERMAP_API_KEY',
    },
    {
      id: 'erp',
      name: 'ERP Automo',
      description: 'Conexão read-only ao banco PostgreSQL do ERP para KPIs em tempo real.',
      category: 'dados',
      status: process.env.AUTOMO_DB_HOST ? 'connected' : 'not_configured',
      envVar: 'AUTOMO_DB_HOST',
    },
    {
      id: 'ticketmaster',
      name: 'Ticketmaster',
      description: 'Eventos locais (cobertura limitada no Brasil — integração experimental).',
      category: 'eventos',
      status: process.env.TICKETMASTER_API_KEY ? 'connected' : 'not_configured',
      envVar: 'TICKETMASTER_API_KEY',
    },
    {
      id: 'sympla',
      name: 'Sympla',
      description: 'Descoberta de eventos locais via scraping público do Sympla.',
      category: 'eventos',
      status: process.env.SYMPLA_TOKEN ? 'connected' : 'not_configured',
      envVar: 'SYMPLA_TOKEN',
    },
    {
      id: 'guia',
      name: 'Guia de Motéis',
      description: 'Sincronização automática de preços e disponibilidade via API do Guia.',
      category: 'canais',
      status: 'coming_soon',
    },
    {
      id: 'ecommerce',
      name: 'Site E-Commerce',
      description: 'Atualização de tarifas e disponibilidade no site próprio da LHG.',
      category: 'canais',
      status: 'coming_soon',
    },
    {
      id: 'booking',
      name: 'Booking.com',
      description: 'Channel manager para sincronização de tarifas e reservas no Booking.',
      category: 'canais',
      status: 'coming_soon',
    },
    {
      id: 'expedia',
      name: 'Expedia',
      description: 'Channel manager para sincronização de tarifas e reservas na Expedia.',
      category: 'canais',
      status: 'coming_soon',
    },
  ]

  return NextResponse.json({ integrations })
}
