import { Pool } from 'pg'

// ─── Mapeamento slug → variável de ambiente ────────────────────────────────

const UNIT_ENV_MAP: Record<string, string | undefined> = {
  'lush-ipiranga': process.env.DATABASE_URL_LOCAL_IPIRANGA,
  'lush-lapa':     process.env.DATABASE_URL_LOCAL_LAPA,
  'tout':          process.env.DATABASE_URL_LOCAL_TOUT,
  'andar-de-cima': process.env.DATABASE_URL_LOCAL_ANDAR_DE_CIMA,
  'altana':        process.env.DATABASE_URL_LOCAL_ALTANA,
}

// IDs de categoria por unidade (para filtrar queries no Automo)
export const UNIT_CATEGORY_IDS: Record<string, number[]> = {
  'lush-ipiranga': [10, 11, 12, 15, 16, 17, 18, 19, 24],
  'lush-lapa':     [7, 8, 9, 10, 11, 12],
  'tout':          [6, 7, 8, 9, 10, 12],
  'andar-de-cima': [2, 3, 4, 5, 6, 7, 12],
  'altana':        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

/**
 * Parseia connection string PostgreSQL com senha contendo '@'.
 * Estratégia: o ÚLTIMO '@' antes do host é o separador userinfo/host.
 * Ex: "postgresql://user:pass@word@host:5432/db"
 */
function parseConnectionString(url: string): {
  host: string; port: number; user: string; password: string; database: string
} {
  const raw = url.trim()
  const withoutScheme = raw.replace(/^postgres(?:ql)?:\/\//, '')

  const lastAt = withoutScheme.lastIndexOf('@')
  if (lastAt === -1) throw new Error('URL inválida: sem @')

  const userinfo = withoutScheme.slice(0, lastAt)
  const hostpart = withoutScheme.slice(lastAt + 1)

  const colonIdx = userinfo.indexOf(':')
  const user     = decodeURIComponent(userinfo.slice(0, colonIdx))
  const password = decodeURIComponent(userinfo.slice(colonIdx + 1))

  // hostpart pode ser "host:port/db?params" — pega só até '?'
  const hostNoQuery = hostpart.split('?')[0]
  const slashIdx = hostNoQuery.indexOf('/')
  const hostport  = slashIdx >= 0 ? hostNoQuery.slice(0, slashIdx) : hostNoQuery
  const database  = slashIdx >= 0 ? hostNoQuery.slice(slashIdx + 1) : 'automo'

  const colonH = hostport.lastIndexOf(':')
  const host   = colonH >= 0 ? hostport.slice(0, colonH) : hostport
  const port   = colonH >= 0 ? parseInt(hostport.slice(colonH + 1), 10) : 5432

  return { host, port, user, password, database }
}

// Cache de pools por slug
const poolCache = new Map<string, Pool>()

export function getAutomPool(unitSlug: string): Pool | null {
  const connStr = UNIT_ENV_MAP[unitSlug]
  if (!connStr) {
    console.warn(`[automo] Env var não configurada para slug: ${unitSlug}`)
    return null
  }

  if (poolCache.has(unitSlug)) return poolCache.get(unitSlug)!

  let config
  try {
    config = parseConnectionString(connStr)
  } catch (e) {
    console.error(`[automo] Erro ao parsear connection string para ${unitSlug}:`, e)
    return null
  }

  console.log(`[automo] Criando pool para ${unitSlug} → ${config.host}:${config.port}/${config.database} (user=${config.user})`)

  const pool = new Pool({
    host:     config.host,
    port:     config.port,
    user:     config.user,
    password: config.password,
    database: config.database,
    max: 3,
    idleTimeoutMillis:    30_000,
    connectionTimeoutMillis: 8_000,
    // Servidores Automo internos não usam SSL
    ssl: false,
  })

  // Log de erros de conexão em background
  pool.on('error', (err) => {
    console.error(`[automo] Pool error (${unitSlug}):`, err.message)
  })

  poolCache.set(unitSlug, pool)
  return pool
}
