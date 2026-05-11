/**
 * Configuração de moeda por unidade.
 * Unidades fora do Brasil (slug 'liv') usam USD.
 */

export type CurrencyConfig = { locale: string; currency: string }

const UNIT_CURRENCY: Record<string, CurrencyConfig> = {
  liv: { locale: 'en-US', currency: 'USD' },
}

const DEFAULT_CURRENCY: CurrencyConfig = { locale: 'pt-BR', currency: 'BRL' }

export function getCurrencyConfig(unitSlug: string): CurrencyConfig {
  return UNIT_CURRENCY[unitSlug] ?? DEFAULT_CURRENCY
}

export function makeCurrencyFormatter(unitSlug: string) {
  const { locale, currency } = getCurrencyConfig(unitSlug)
  const fmt0 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
  const fmt2 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
  return {
    formatMoney: (v: number, decimals = 0) => (decimals > 0 ? fmt2 : fmt0).format(v),
    symbol: currency === 'USD' ? '$' : 'R$',
  }
}
