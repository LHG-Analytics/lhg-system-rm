import { Pool } from 'pg'
import { getUnitConfig } from './unit-config'

/**
 * Parseia connection string PostgreSQL com senha contendo '@'.
 * Estratégia: o ÚLTIMO '@' antes do host é o separador userinfo/host.
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

/**
 * Retorna (ou cria) o pool de conexões Automo para a unidade.
 * A env var é DATABASE_URL_LOCAL_{automo_env_key}, lida do banco via unit-config.
 */
export async function getAutomPool(unitSlug: string): Promise<Pool | null> {
  if (poolCache.has(unitSlug)) return poolCache.get(unitSlug)!

  const config = await getUnitConfig(unitSlug)
  if (!config?.automo_env_key) {
    console.warn(`[automo] automo_env_key não configurado para: ${unitSlug}`)
    return null
  }

  const envKey = `DATABASE_URL_LOCAL_${config.automo_env_key}`
  const connStr = process.env[envKey]
  if (!connStr) {
    console.warn(`[automo] Env var ${envKey} não definida para: ${unitSlug}`)
    return null
  }

  let connConfig
  try {
    connConfig = parseConnectionString(connStr)
  } catch (e) {
    console.error(`[automo] Erro ao parsear connection string para ${unitSlug}:`, e)
    return null
  }

  console.log(`[automo] Criando pool para ${unitSlug} → ${connConfig.host}:${connConfig.port}/${connConfig.database} (user=${connConfig.user})`)

  const pool = new Pool({
    host:     connConfig.host,
    port:     connConfig.port,
    user:     connConfig.user,
    password: connConfig.password,
    database: connConfig.database,
    max: 3,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis:  8_000,
    ssl: false,
  })

  pool.on('error', (err) => {
    console.error(`[automo] Pool error (${unitSlug}):`, err.message)
  })

  poolCache.set(unitSlug, pool)
  return pool
}

/**
 * Retorna os IDs de categoria Automo para a unidade (lidos do DB via unit-config).
 */
export async function getUnitCategoryIds(unitSlug: string): Promise<number[]> {
  const config = await getUnitConfig(unitSlug)
  return config?.automo_category_ids ?? []
}

/**
 * Retorna o tipo de período da unidade ('standard' | 'altana').
 */
export async function getUnitPeriodType(unitSlug: string): Promise<'standard' | 'altana'> {
  const config = await getUnitConfig(unitSlug)
  return config?.period_type ?? 'standard'
}

/**
 * Invalida o pool cacheado (útil após alterar config de unidade).
 */
export function invalidatePool(unitSlug: string) {
  poolCache.delete(unitSlug)
}
