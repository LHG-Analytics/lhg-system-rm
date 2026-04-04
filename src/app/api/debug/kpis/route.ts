import { NextRequest, NextResponse } from 'next/server'
import { getAutomPool, UNIT_CATEGORY_IDS } from '@/lib/automo/client'
import { fetchCompanyKPIsFromAutomo } from '@/lib/automo/company-kpis'

// GET /api/debug/kpis?unit=lush-ipiranga&start=01/03/2026&end=04/04/2026
export async function GET(request: NextRequest) {
  const params  = request.nextUrl.searchParams
  const slug    = params.get('unit') ?? 'lush-ipiranga'
  const start   = params.get('start') ?? '01/03/2026'   // DD/MM/YYYY
  const end     = params.get('end')   ?? '04/04/2026'

  const pool = getAutomPool(slug)
  if (!pool) return NextResponse.json({ error: `Pool indisponível para ${slug}` }, { status: 500 })

  const catIds = (UNIT_CATEGORY_IDS[slug] ?? []).join(',')
  if (!catIds) return NextResponse.json({ error: `Nenhum catId para ${slug}` }, { status: 500 })

  // Converte DD/MM/YYYY → ISO
  function toIso(ddmmyyyy: string) {
    const [d, m, y] = ddmmyyyy.split('/').map(Number)
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 00:00:00`
  }
  function addDay(iso: string) {
    const d = new Date(iso.replace(' ', 'T') + 'Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10) + ' 00:00:00'
  }

  const isoStart = toIso(start)
  const isoEnd   = addDay(toIso(end))

  const results: Record<string, unknown> = {
    slug, catIds, isoStart, isoEnd,
  }

  // 1. Conexão básica
  try {
    const r = await pool.query('SELECT NOW() AS now, version() AS pg_version')
    results['1_connection'] = { ok: true, now: r.rows[0].now, pg_version: r.rows[0].pg_version }
  } catch (e) {
    results['1_connection'] = { ok: false, error: String(e) }
    return NextResponse.json(results)
  }

  // 2. Tabelas que existem
  try {
    const tables = ['locacaoapartamento','apartamentostate','apartamento',
                    'categoriaapartamento','vendalocacao','saidaestoque',
                    'saidaestoqueitem','vendadireta','venda']
    const r = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [tables])
    const found = r.rows.map((x: { table_name: string }) => x.table_name)
    const missing = tables.filter(t => !found.includes(t))
    results['2_tables'] = { found, missing }
  } catch (e) {
    results['2_tables'] = { error: String(e) }
  }

  // 3. Coluna gorjeta existe?
  try {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'locacaoapartamento'
        AND column_name = 'gorjeta'
    `)
    results['3_gorjeta_column'] = { exists: r.rows.length > 0 }
  } catch (e) {
    results['3_gorjeta_column'] = { error: String(e) }
  }

  // 4. Count básico de locações no período
  try {
    const r = await pool.query(`
      SELECT COUNT(*) AS total
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
    `, [isoStart, isoEnd])
    results['4_rentals_count'] = { total: r.rows[0].total }
  } catch (e) {
    results['4_rentals_count'] = { error: String(e) }
  }

  // 5. receita_consumo (vendalocacao + saidaestoque + saidaestoqueitem)
  try {
    const r = await pool.query(`
      SELECT COUNT(*) AS total
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca_apt ON a.id_categoriaapartamento = ca_apt.id
      INNER JOIN vendalocacao vl      ON la.id_apartamentostate = vl.id_locacaoapartamento
      INNER JOIN saidaestoque se      ON vl.id_saidaestoque = se.id
      INNER JOIN saidaestoqueitem sei ON se.id = sei.id_saidaestoque
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND sei.cancelado IS NULL
        AND ca_apt.id IN (${catIds})
    `, [isoStart, isoEnd])
    results['5_receita_consumo'] = { ok: true, total: r.rows[0].total }
  } catch (e) {
    results['5_receita_consumo'] = { ok: false, error: String(e) }
  }

  // 6. sale_direct (vendadireta + venda)
  try {
    const r = await pool.query(`
      SELECT COUNT(*) AS total
      FROM saidaestoque se
      INNER JOIN vendadireta vd      ON se.id = vd.id_saidaestoque
      INNER JOIN saidaestoqueitem sei ON se.id = sei.id_saidaestoque
      LEFT  JOIN venda v              ON se.id = v.id_saidaestoque
      WHERE vd.venda_completa = true
        AND sei.cancelado IS NULL
        AND sei.datasaidaitem >= $1
        AND sei.datasaidaitem <  $2
    `, [isoStart, isoEnd])
    results['6_sale_direct'] = { ok: true, total: r.rows[0].total }
  } catch (e) {
    results['6_sale_direct'] = { ok: false, error: String(e) }
  }

  // 7. gorjeta na query de suite category
  try {
    const r = await pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CAST(la.gorjeta AS DECIMAL(15,4))), 0) AS total_gorjeta
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
        AND ca.id IN (${catIds})
    `, [isoStart, isoEnd])
    results['7_gorjeta_query'] = { ok: true, total: r.rows[0].total, gorjeta: r.rows[0].total_gorjeta }
  } catch (e) {
    results['7_gorjeta_query'] = { ok: false, error: String(e) }
  }

  // 8. Categorias disponíveis no período
  try {
    const r = await pool.query(`
      SELECT DISTINCT ca.id, ca.descricao
      FROM locacaoapartamento la
      INNER JOIN apartamentostate aps ON la.id_apartamentostate = aps.id
      INNER JOIN apartamento a        ON aps.id_apartamento = a.id
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      WHERE la.datainicialdaocupacao >= $1
        AND la.datainicialdaocupacao <  $2
        AND la.fimocupacaotipo = 'FINALIZADA'
      ORDER BY ca.id
    `, [isoStart, isoEnd])
    results['8_categories_in_db'] = {
      fromDb: r.rows,
      configuredIds: catIds,
    }
  } catch (e) {
    results['8_categories_in_db'] = { error: String(e) }
  }

  // 9. Chama fetchCompanyKPIsFromAutomo completo e mostra estrutura retornada
  try {
    const data = await fetchCompanyKPIsFromAutomo(slug, start, end)
    results['9_full_fetch'] = {
      ok: true,
      BigNumbers_length:            data.BigNumbers.length,
      TotalResult:                  data.TotalResult,
      DataTableSuiteCategory_length: data.DataTableSuiteCategory.length,
      DataTableGiroByWeek_length:    data.DataTableGiroByWeek.length,
      DataTableRevparByWeek_length:  data.DataTableRevparByWeek.length,
      // Primeiros itens para validar estrutura
      BigNumbers_0:                  data.BigNumbers[0],
      DataTableSuiteCategory_0:      data.DataTableSuiteCategory[0] ?? null,
      DataTableGiroByWeek_0:         data.DataTableGiroByWeek[0] ?? null,
    }
  } catch (e) {
    results['9_full_fetch'] = {
      ok: false,
      error: String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }
  }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
