import { Pool } from 'pg'

// ─── Mapeamento slug → variável de ambiente ────────────────────────────────

const UNIT_ENV_MAP: Record<string, string | undefined> = {
  lush_ipiranga: process.env.DATABASE_URL_LOCAL_IPIRANGA,
  lush_lapa:     process.env.DATABASE_URL_LOCAL_LAPA,
  tout:          process.env.DATABASE_URL_LOCAL_TOUT,
  andar_de_cima: process.env.DATABASE_URL_LOCAL_ANDAR_DE_CIMA,
  altana:        process.env.DATABASE_URL_LOCAL_ALTANA,
}

// IDs de categoria por unidade (para filtrar queries no Automo)
export const UNIT_CATEGORY_IDS: Record<string, number[]> = {
  lush_ipiranga: [10, 11, 12, 15, 16, 17, 18, 19, 24],
  lush_lapa:     [7, 8, 9, 10, 11, 12],
  tout:          [6, 7, 8, 9, 10, 12],
  andar_de_cima: [2, 3, 4, 5, 6, 7, 12],
  altana:        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

/**
 * Parseia um connection string PostgreSQL com senha que pode conter '@'.
 * Ex: "postgresql://user:pass@word@host:port/db"
 * O último '@' antes do host é o separador user:pass vs host.
 */
function parseConnectionString(url: string) {
  // Remove scheme
  const withoutScheme = url.replace(/^postgresql:\/\//, '')

  // Último '@' separa userinfo de host
  const lastAt = withoutScheme.lastIndexOf('@')
  const userinfo = withoutScheme.slice(0, lastAt)
  const hostpart = withoutScheme.slice(lastAt + 1)

  // user:password (password pode conter ':' — split no primeiro)
  const colonIdx = userinfo.indexOf(':')
  const user = decodeURIComponent(userinfo.slice(0, colonIdx))
  const password = decodeURIComponent(userinfo.slice(colonIdx + 1))

  // host:port/database
  const [hostport, database] = hostpart.split('/')
  const [host, portStr] = hostport.split(':')
  const port = portStr ? parseInt(portStr, 10) : 5432

  return { host, port, user, password, database }
}

// Cache de pools por slug para não recriar conexões a cada request
const poolCache = new Map<string, Pool>()

export function getAutomPool(unitSlug: string): Pool | null {
  const connStr = UNIT_ENV_MAP[unitSlug]
  if (!connStr) return null

  if (poolCache.has(unitSlug)) return poolCache.get(unitSlug)!

  const config = parseConnectionString(connStr)
  const pool = new Pool({
    ...config,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: false,
  })

  poolCache.set(unitSlug, pool)
  return pool
}
