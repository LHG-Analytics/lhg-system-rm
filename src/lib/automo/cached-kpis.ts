import { unstable_cache } from 'next/cache'
import { fetchCompanyKPIsFromAutomo } from './company-kpis'
import { queryChannelKPIs } from './channel-kpis'

// Cache de 5 minutos no Data Cache do Next.js — persiste entre requests do mesmo servidor.
// A chave inclui todos os args automaticamente, então params diferentes = entradas distintas.
const REVALIDATE = 300

export const cachedCompanyKPIs = unstable_cache(
  fetchCompanyKPIsFromAutomo,
  ['automo-company-kpis-v2'],
  { revalidate: REVALIDATE },
)

export const cachedChannelKPIs = unstable_cache(
  queryChannelKPIs,
  ['automo-channel-kpis'],
  { revalidate: REVALIDATE },
)
