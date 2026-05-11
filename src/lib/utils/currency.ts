/**
 * Configuração de moeda por unidade.
 * Unidades fora do Brasil (slug 'liv') usam USD.
 */

export type CurrencyConfig = { locale: string; currency: string }

const UNIT_CURRENCY: Record<string, CurrencyConfig> = {
  liv: { locale: 'pt-BR', currency: 'USD' },
}

const DEFAULT_CURRENCY: CurrencyConfig = { locale: 'pt-BR', currency: 'BRL' }

export function getCurrencyConfig(unitSlug: string): CurrencyConfig {
  return UNIT_CURRENCY[unitSlug] ?? DEFAULT_CURRENCY
}

export function makeCurrencyFormatter(unitSlug: string) {
  const { locale, currency } = getCurrencyConfig(unitSlug)
  const symbol = currency === 'USD' ? '$' : 'R$'

  // Para USD usamos Intl sem style:'currency' + símbolo manual
  // Motivo: 'pt-BR' + 'USD' geraria "US$ 49.863" (prefixo "US$" indesejado)
  // Assim obtemos "$ 49.863" com separador de milhar latino (.)
  if (currency !== 'BRL') {
    const num0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
    const num2 = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    return {
      formatMoney: (v: number, decimals = 0) => `${symbol} ${(decimals > 0 ? num2 : num0).format(v)}`,
      symbol,
    }
  }

  const fmt0 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
  const fmt2 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
  return {
    formatMoney: (v: number, decimals = 0) => (decimals > 0 ? fmt2 : fmt0).format(v),
    symbol,
  }
}
