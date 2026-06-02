import { unstable_cache } from 'next/cache'
import { fetchCompanyKPIsFromAutomo } from './company-kpis'
import { queryChannelKPIs, queryPeriodMix } from './channel-kpis'

const REVALIDATE = 300

// Sem cache — sempre busca dados frescos do Automo para garantir exatidão dos KPIs
export const cachedCompanyKPIs = fetchCompanyKPIsFromAutomo

export const cachedChannelKPIs = unstable_cache(
  queryChannelKPIs,
  ['automo-channel-kpis'],
  { revalidate: REVALIDATE },
)

export const cachedPeriodMix = unstable_cache(
  queryPeriodMix,
  ['automo-period-mix'],
  { revalidate: REVALIDATE },
)
