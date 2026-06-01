'use client'

import { createContext, useContext, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { makeCurrencyFormatterFromCode, makeCurrencyFormatter } from '@/lib/utils/currency'

type CurrencyContextValue = {
  formatMoney: (v: number, decimals?: number) => string
  symbol: string
}

const CurrencyContext = createContext<CurrencyContextValue>({
  formatMoney: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v),
  symbol: 'R$',
})

interface CurrencyProviderProps {
  children: React.ReactNode
  /** Mapa slug → currency_code vindo do servidor. Se omitido usa fallback estático. */
  unitCurrencies?: Record<string, string>
}

export function CurrencyProvider({ children, unitCurrencies }: CurrencyProviderProps) {
  const searchParams = useSearchParams()
  const slug = searchParams.get('unit') ?? ''

  const value = useMemo(() => {
    if (unitCurrencies && slug && unitCurrencies[slug]) {
      return makeCurrencyFormatterFromCode(unitCurrencies[slug])
    }
    // Fallback para o mapa estático (funciona mesmo sem prop)
    return makeCurrencyFormatter(slug)
  }, [slug, unitCurrencies])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
