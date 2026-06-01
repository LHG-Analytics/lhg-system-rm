/**
 * Configuração de moeda por unidade.
 * O código de moeda vem do banco (coluna currency_code em units).
 * O mapa UNIT_CURRENCY é usado apenas como fallback estático quando o banco não é acessível.
 */

export type CurrencyConfig = { locale: string; currency: string }

/** Fallback estático — preferir o valor do banco sempre que disponível */
const UNIT_CURRENCY_FALLBACK: Record<string, string> = {
  liv: 'USD',
}

const DEFAULT_CURRENCY_CODE = 'BRL'

/** Cria uma CurrencyConfig a partir de um código ISO (ex: 'BRL', 'USD', 'PEN') */
export function getCurrencyConfigFromCode(currencyCode: string): CurrencyConfig {
  return { locale: 'pt-BR', currency: currencyCode }
}

/** Compat retroativa — prefira getCurrencyConfigFromCode quando o código já for conhecido */
export function getCurrencyConfig(unitSlug: string): CurrencyConfig {
  const code = UNIT_CURRENCY_FALLBACK[unitSlug] ?? DEFAULT_CURRENCY_CODE
  return getCurrencyConfigFromCode(code)
}

export function makeCurrencyFormatterFromCode(currencyCode: string) {
  const { locale, currency } = getCurrencyConfigFromCode(currencyCode)
  const symbol = currency === 'USD' ? '$' : currency === 'PEN' ? 'S/' : 'R$'

  // Para moedas não-BRL: Intl sem style:'currency' + símbolo manual
  // Motivo: 'pt-BR' + 'USD' geraria "US$ 49.863" (prefixo "US$" indesejado)
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

/** Compat retroativa — preferir makeCurrencyFormatterFromCode */
export function makeCurrencyFormatter(unitSlug: string) {
  const code = UNIT_CURRENCY_FALLBACK[unitSlug] ?? DEFAULT_CURRENCY_CODE
  return makeCurrencyFormatterFromCode(code)
}
