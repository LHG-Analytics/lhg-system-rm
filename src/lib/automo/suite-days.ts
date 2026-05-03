/**
 * SQL helpers para "suítes-dia disponíveis" — denominador correto de Giro,
 * RevPAR, TRevPAR e Ocupação que desconta períodos em que cada suíte
 * esteve bloqueada (em obra, manutenção etc).
 *
 * Estrutura no Automo:
 *   - apartamento (id, id_categoriaapartamento, dataexclusao)
 *   - apartamentostate (id, id_apartamento, datainicio, datafim)
 *   - bloqueadoapartamento (id_apartamentostate, observacao)
 *
 * Uma suíte está bloqueada no dia D se existe um row em bloqueadoapartamento
 * cujo apartamentostate.datainicio ≤ D ≤ COALESCE(datafim, infinito).
 *
 * Antes (incorreto):
 *   denominador = COUNT(suites) * n_dias
 * Depois (correto):
 *   denominador = SUM(suites_disponiveis_no_dia_D) para D em [start, end)
 *
 * Em períodos sem bloqueios os números são idênticos. Em períodos com
 * bloqueios, os KPIs sobem (numerador / denominador menor).
 *
 * Performance: para uma unidade de 20 suítes × 90 dias = 1800 rows.
 * Sem problemas em períodos típicos.
 */

/**
 * Bloco CTE comum (precisa estar no início do WITH ...):
 *   - dias_periodo: gera 1 row por dia no intervalo [isoStart::date, isoEnd::date)
 *   - bloqueios_intervalos: 1 row por bloqueio (datainicio, datafim) por suíte
 *   - suite_dias: 1 row por (suite, dia) onde a suíte NÃO está bloqueada
 *
 * As CTEs derivadas (totais, por categoria, por DOW) consomem `suite_dias`.
 */
export function cteBaseSuiteDays(catIds: string, startExpr = '$1', endExpr = '$2'): string {
  return `
    dias_periodo AS (
      SELECT generate_series(${startExpr}::date, ${endExpr}::date - INTERVAL '1 day', '1 day'::interval)::date AS dia
    ),
    bloqueios_intervalos AS (
      SELECT
        aps.id_apartamento,
        aps.datainicio::date AS bloq_inicio,
        COALESCE(aps.datafim::date, '9999-12-31'::date) AS bloq_fim
      FROM bloqueadoapartamento b
      INNER JOIN apartamentostate aps ON b.id_apartamentostate = aps.id
    ),
    suite_dias AS (
      SELECT
        a.id           AS id_apartamento,
        ca.id          AS id_categoria,
        ca.descricao   AS categoria,
        d.dia          AS dia
      FROM apartamento a
      INNER JOIN categoriaapartamento ca ON a.id_categoriaapartamento = ca.id
      CROSS JOIN dias_periodo d
      WHERE ca.id IN (${catIds})
        AND a.dataexclusao IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bloqueios_intervalos bi
          WHERE bi.id_apartamento = a.id
            AND d.dia BETWEEN bi.bloq_inicio AND bi.bloq_fim
        )
    )
  `
}

/**
 * Total de suítes-dia disponíveis no período (escalar único).
 * Usado em queryBigNumbers, queryTotalRevOcc, e queries de heatmap.
 *
 * Uso (dentro de WITH):
 *   ${cteBaseSuiteDays(catIds)},
 *   ${cteSuiteDaysTotal()}
 *
 * E no SELECT principal:
 *   (SELECT suite_dias FROM suite_dias_total) AS total_suite_dias
 */
export function cteSuiteDaysTotal(): string {
  return `
    suite_dias_total AS (
      SELECT COUNT(*)::bigint AS suite_dias FROM suite_dias
    )
  `
}

/**
 * Suítes-dia por categoria. Usado em queryDataTableSuiteCategory.
 *
 * Uso:
 *   ${cteBaseSuiteDays(catIds)},
 *   ${cteSuiteDaysByCategory()}
 *
 * E no SELECT/JOIN:
 *   INNER JOIN suite_dias_por_cat sc ON ca.descricao = sc.categoria
 *   sc.suite_dias AS suite_dias_categoria
 */
export function cteSuiteDaysByCategory(): string {
  return `
    suite_dias_por_cat AS (
      SELECT categoria, COUNT(*)::bigint AS suite_dias
      FROM suite_dias
      GROUP BY categoria
    )
  `
}

/**
 * Suítes-dia por categoria × dia da semana. Usado em queryWeekTables.
 * Substitui o cálculo antigo `suitesInCat * dow_occurrences`.
 *
 * Uso:
 *   ${cteBaseSuiteDays(catIds)},
 *   ${cteSuiteDaysByCategoryDow()},
 *   ${cteSuiteDaysByDow()}
 */
export function cteSuiteDaysByCategoryDow(): string {
  return `
    suite_dias_cat_dow AS (
      SELECT
        id_categoria,
        categoria,
        EXTRACT(DOW FROM dia)::int AS dow,
        COUNT(*)::bigint AS suite_dias
      FROM suite_dias
      GROUP BY id_categoria, categoria, EXTRACT(DOW FROM dia)
    )
  `
}

export function cteSuiteDaysByDow(): string {
  return `
    suite_dias_total_dow AS (
      SELECT
        EXTRACT(DOW FROM dia)::int AS dow,
        COUNT(*)::bigint AS suite_dias
      FROM suite_dias
      GROUP BY EXTRACT(DOW FROM dia)
    )
  `
}
