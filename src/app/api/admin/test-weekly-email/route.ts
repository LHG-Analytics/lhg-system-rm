import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { WeeklyReportData } from '@/lib/reports/types'
import { sendWeeklyReportEmail } from '@/lib/email/send-weekly-report'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Envia o relatório semanal mais recente (já gerado) de uma unidade para um único
 * e-mail de teste — não afeta a lista real de destinatários. Usado para validar
 * a configuração do Resend sem esperar o cron de segunda-feira.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single()
  if (!['super_admin', 'admin'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }

  const { unitSlug, testEmail } = await req.json() as { unitSlug?: string; testEmail?: string }
  if (!unitSlug || !testEmail) {
    return NextResponse.json({ error: 'unitSlug e testEmail são obrigatórios' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: unit } = await admin.from('units').select('id, name').eq('slug', unitSlug).single()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })

  const { data: report } = await admin
    .from('rm_weekly_reports')
    .select('id, period_start, period_end, report_data')
    .eq('unit_id', unit.id)
    .eq('status', 'done')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!report) {
    return NextResponse.json({ error: 'Nenhum relatório concluído encontrado para esta unidade. Gere um relatório antes de testar o e-mail.' }, { status: 404 })
  }

  await sendWeeklyReportEmail({
    unitId: unit.id,
    unitSlug,
    unitName: unit.name,
    reportId: report.id,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    reportData: report.report_data as unknown as WeeklyReportData,
    testEmailOverride: testEmail,
  })

  return NextResponse.json({ ok: true, reportId: report.id, periodStart: report.period_start, periodEnd: report.period_end })
}
