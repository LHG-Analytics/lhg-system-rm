import { Resend } from 'resend'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { WeeklyReportData } from '@/lib/reports/types'
import { makeCurrencyFormatter } from '@/lib/utils/currency'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lhg-system-rm.vercel.app'

function getAdminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Destinatários do relatório semanal de uma unidade: super_admin/admin/manager
 * vinculados a ela + admins/super_admins "globais" (unit_id NULL — mesma regra de
 * acesso usada nas RLS policies em todo o sistema).
 */
async function getReportRecipients(unitId: string): Promise<{ email: string; name: string | null }[]> {
  const admin = getAdminClient()

  const [{ data: profiles }, { data: authUsers }] = await Promise.all([
    admin.from('profiles')
      .select('user_id, role, unit_id, display_name')
      .in('role', ['super_admin', 'admin', 'manager']),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const emailMap = new Map(authUsers?.users?.map((u) => [u.id, u.email ?? '']) ?? [])

  return (profiles ?? [])
    .filter((p) => p.unit_id === unitId || p.unit_id === null)
    .map((p) => ({ email: emailMap.get(p.user_id) ?? '', name: p.display_name ?? null }))
    .filter((r) => !!r.email)
}

function toneColor(tone: WeeklyReportData['executiveSummary']['tone']): string {
  if (tone === 'positive') return '#059669'
  if (tone === 'warning') return '#d97706'
  return '#71717a'
}

function buildEmailHtml(params: {
  unitName: string
  periodLabel: string
  reportUrl: string
  summary: WeeklyReportData['executiveSummary']
  opportunities: WeeklyReportData['opportunities']
  kpis: WeeklyReportData['kpis']
  fmtMoney: (v: number) => string
}): string {
  const { unitName, periodLabel, reportUrl, summary, opportunities, kpis, fmtMoney } = params
  const color = toneColor(summary.tone)
  const top3 = opportunities.slice(0, 3)

  const kpiRow = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:#71717a;font-size:13px;">${label}</td>
      <td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px;">${value}</td>
    </tr>`

  const opportunityItem = (o: WeeklyReportData['opportunities'][number]) => `
    <tr>
      <td style="padding:10px 14px;border:1px solid #e4e4e7;border-radius:8px;font-size:13px;color:#3f3f46;">
        <strong>${o.categoria}</strong> — ${o.suggestion}
      </td>
    </tr>
    <tr><td style="height:8px;"></td></tr>`

  return `
  <div style="background:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px 4px 28px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em;">Relatório semanal · LHG Revenue Manager</p>
          <h1 style="margin:4px 0 0 0;font-size:18px;color:#18181b;">${unitName}</h1>
          <p style="margin:2px 0 0 0;font-size:13px;color:#71717a;">${periodLabel}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 28px;">
          <table role="presentation" width="100%" style="border-left:3px solid ${color};background:#fafafa;border-radius:8px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0;font-size:14px;font-weight:600;color:#18181b;">${summary.headline}</p>
                ${summary.keyPoints.map((p) => `<p style="margin:6px 0 0 0;font-size:13px;color:#3f3f46;">• ${p}</p>`).join('')}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${summary.priorityAction ? `
      <tr>
        <td style="padding:0 28px 16px 28px;">
          <table role="presentation" width="100%" style="border:1px solid #d4d4d8;border-radius:8px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.03em;">Ação prioritária</p>
                <p style="margin:0;font-size:13px;color:#18181b;">${summary.priorityAction}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      ${top3.length > 0 ? `
      <tr>
        <td style="padding:0 28px 8px 28px;">
          <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#18181b;text-transform:uppercase;letter-spacing:0.03em;">Oportunidades identificadas</p>
          <table role="presentation" width="100%">
            ${top3.map(opportunityItem).join('')}
          </table>
        </td>
      </tr>` : ''}

      <tr>
        <td style="padding:8px 28px 20px 28px;">
          <table role="presentation" width="100%" style="border:1px solid #e4e4e7;border-radius:8px;">
            <tr><td style="padding:14px 16px;">
              <table role="presentation" width="100%">
                ${kpiRow('RevPAR', fmtMoney(kpis.current.revpar))}
                ${kpiRow('Giro', kpis.current.giro.toFixed(2))}
                ${kpiRow('Ocupação', `${(kpis.current.ocupacao * 100).toFixed(1)}%`)}
                ${kpiRow('Receita', fmtMoney(kpis.current.receita))}
              </table>
            </td></tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:0 28px 28px 28px;text-align:center;">
          <a href="${reportUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">Ver relatório completo →</a>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 28px;border-top:1px solid #f4f4f4;text-align:center;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;">Enviado automaticamente toda segunda-feira pelo Agente RM.</p>
        </td>
      </tr>
    </table>
  </div>`
}

export interface SendWeeklyReportEmailParams {
  unitId:      string
  unitSlug:    string
  unitName:    string
  reportId:    string
  periodStart: string  // YYYY-MM-DD
  periodEnd:   string  // YYYY-MM-DD
  reportData:  WeeklyReportData
}

/**
 * Envia o relatório semanal por e-mail para os admins/gerentes da unidade.
 * Falha silenciosa (loga e retorna) se RESEND_API_KEY não estiver configurada —
 * mesmo padrão de degradação graciosa usado nas demais integrações opcionais
 * (clima, eventos, concorrentes).
 */
export async function sendWeeklyReportEmail(params: SendWeeklyReportEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[send-weekly-report] RESEND_API_KEY não configurada — e-mail não enviado.')
    return
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'relatorios@lushmotel.com.br'

  const recipients = await getReportRecipients(params.unitId)
  if (!recipients.length) {
    console.warn(`[send-weekly-report] Nenhum destinatário encontrado para a unidade ${params.unitSlug}.`)
    return
  }

  const { formatMoney: fmtMoney } = makeCurrencyFormatter(params.unitSlug)
  const periodLabel = `${params.periodStart.split('-').reverse().join('/')} a ${params.periodEnd.split('-').reverse().join('/')}`
  const reportUrl = `${APP_URL}/dashboard/relatorios?unit=${params.unitSlug}`

  const html = buildEmailHtml({
    unitName: params.unitName,
    periodLabel,
    reportUrl,
    summary: params.reportData.executiveSummary,
    opportunities: params.reportData.opportunities,
    kpis: params.reportData.kpis,
    fmtMoney,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: `LHG Revenue Manager <${fromEmail}>`,
    to: recipients.map((r) => r.email),
    subject: `Relatório semanal — ${params.unitName} (${periodLabel})`,
    html,
  })

  if (error) {
    console.error(`[send-weekly-report] Falha ao enviar e-mail para ${params.unitSlug}:`, error)
  }
}
