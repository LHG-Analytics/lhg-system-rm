/**
 * POST /api/agente/sheets-price-import
 *
 * Reads the price_sheet_url from rm_agent_config, fetches all date-named tabs,
 * parses each with AI, and creates needs_review jobs in price_import_jobs.
 * The existing confirm/reject UI handles the rest.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { extractSpreadsheetId } from '@/lib/budget/google-sheets'
import { importPricesFromSheets } from '@/lib/budget/sheets-price-import'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autorizado', status: 401 as const, user: null, profile: null }
  const { data: profile } = await supabase.from('profiles').select('role, unit_id').eq('user_id', user.id).single()
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return { error: 'Acesso negado', status: 403 as const, user: null, profile: null }
  }
  return { error: null, status: 200 as const, user, profile }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return new Response(auth.error, { status: auth.status })

  const body = await req.json() as { unitSlug: string }
  const { unitSlug } = body
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id, slug').eq('slug', unitSlug).single()
  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  if (!(['super_admin', 'admin'].includes(auth.profile!.role ?? '') && !auth.profile!.unit_id) && auth.profile!.unit_id !== unit.id) {
    return new Response('Sem acesso a essa unidade', { status: 403 })
  }

  const { data: config } = await admin
    .from('rm_agent_config')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('price_sheet_url' as any)
    .eq('unit_id', unit.id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceSheetUrl = (config as any)?.price_sheet_url as string | null | undefined
  if (!priceSheetUrl) {
    return new Response('URL da planilha de preços não configurada para esta unidade', { status: 400 })
  }

  const spreadsheetId = extractSpreadsheetId(priceSheetUrl)

  try {
    const tabJobs = await importPricesFromSheets(spreadsheetId, unit.slug)

    if (tabJobs.length === 0) {
      return Response.json({ error: 'Nenhuma aba de preços pôde ser processada' }, { status: 422 })
    }

    // Create needs_review jobs — one per tab
    const inserts = tabJobs.map((job) => ({
      unit_id: unit.id,
      created_by: auth.user!.id,
      file_name: `Sheets: ${job.tabName}`,
      csv_content: '',
      valid_from: job.validFrom,
      valid_until: job.validUntil ?? null,
      status: 'needs_review' as const,
      import_type: 'prices',
      parsed_preview: {
        rows: job.rows,
        discount_rows: [],
        canais_encontrados: job.canaisEncontrados,
      },
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jobs, error } = await (admin as any)
      .from('price_import_jobs')
      .insert(inserts)
      .select('id, file_name, valid_from, valid_until, status')

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Update price_sheet_last_sync
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('rm_agent_config')
      .update({ price_sheet_last_sync: new Date().toISOString() })
      .eq('unit_id', unit.id)

    await admin.from('notifications').insert({
      user_id: auth.user!.id,
      title: 'Sheets sincronizado — confirme a importação',
      body: `${tabJobs.length} aba(s) analisadas. Acesse Preços para confirmar cada tabela.`,
      type: 'info',
      link: `/dashboard/precos?unit=${unitSlug}`,
    })

    return Response.json({
      success: true,
      tabsImported: tabJobs.length,
      jobs: jobs ?? [],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido'
    console.error('[sheets-price-import] Erro:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
