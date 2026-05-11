'use client'

import { createContext, useContext, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { makeCurrencyFormatter } from '@/lib/utils/currency'

type CurrencyContextValue = {
  formatMoney: (v: number, decimals?: number) => string
  symbol: string
}

const CurrencyContext = createContext<CurrencyContextValue>({
  formatMoney: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v),
  symbol: 'R$',
})

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const slug = searchParams.get('unit') ?? ''
  const value = useMemo(() => makeCurrencyFormatter(slug), [slug])
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
