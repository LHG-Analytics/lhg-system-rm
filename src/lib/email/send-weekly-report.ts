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

function toneColor(tone: WeeklyReportData['executiveSummary']['tone']): { accent: string; bg: string } {
  if (tone === 'positive') return { accent: '#059669', bg: '#ecfdf5' }
  if (tone === 'warning') return { accent: '#d97706', bg: '#fffbeb' }
  return { accent: '#71717a', bg: '#fafafa' }
}

const DIMENSION_LABEL_PT: Record<string, string> = { periodo: 'Período', turno: 'Turno', dia_semana: 'Dia' }

function deltaLabel(current: number, previous: number | undefined | null): string {
  if (!previous) return ''
  const pct = ((current - previous) / previous) * 100
  const color = pct >= 0 ? '#059669' : '#dc2626'
  const arrow = pct >= 0 ? '▲' : '▼'
  return `<span style="color:${color};font-size:11px;font-weight:600;">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`
}

export function buildEmailHtml(params: {
  unitName: string
  periodLabel: string
  reportUrl: string
  summary: WeeklyReportData['executiveSummary']
  opportunities: WeeklyReportData['opportunities']
  kpis: WeeklyReportData['kpis']
  fmtMoney: (v: number) => string
}): string {
  const { unitName, periodLabel, reportUrl, summary, opportunities, kpis, fmtMoney } = params
  const { accent, bg } = toneColor(summary.tone)
  // opportunities[0] já é a base do priorityAction abaixo — a lista secundária começa do índice 1
  // pra não repetir a mesma frase duas vezes no e-mail.
  const restOpportunities = opportunities.slice(1, 4)

  const statCell = (label: string, value: string, delta: string) => `
    <td width="50%" style="padding:12px 14px;background:#fafafa;border:1px solid #eeeeef;">
      <p style="margin:0;font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.03em;">${label}</p>
      <p style="margin:2px 0 0 0;font-size:18px;font-weight:700;color:#18181b;">${value} ${delta}</p>
    </td>`

  const opportunityItem = (o: WeeklyReportData['opportunities'][number]) => {
    const dirColor = o.direction === 'below' ? '#d97706' : '#059669'
    const arrow = o.direction === 'below' ? '▼' : '▲'
    return `
    <tr><td style="padding:0 0 8px 0;">
      <table role="presentation" width="100%" style="border:1px solid #e4e4e7;border-radius:8px;">
        <tr>
          <td width="4" style="background:${dirColor};border-radius:8px 0 0 8px;"></td>
          <td style="padding:10px 14px;font-size:13px;color:#3f3f46;">
            <span style="font-size:10px;font-weight:600;color:${dirColor};">${arrow} ${DIMENSION_LABEL_PT[o.dimension] ?? o.dimension}: ${o.label}</span><br/>
            <strong style="color:#18181b;">${o.categoria}</strong> — ${o.suggestion}
          </td>
        </tr>
      </table>
    </td></tr>`
  }

  return `
  <div style="background:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px 4px 28px;border-top:4px solid ${accent};">
          <p style="margin:0;font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;">Relatório semanal · LHG Revenue Manager</p>
          <h1 style="margin:4px 0 0 0;font-size:20px;color:#18181b;">${unitName}</h1>
          <p style="margin:2px 0 0 0;font-size:13px;color:#71717a;">${periodLabel}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${statCell('RevPAR', fmtMoney(kpis.current.revpar), deltaLabel(kpis.current.revpar, kpis.previousWeek?.revpar))}
              ${statCell('Giro', kpis.current.giro.toFixed(2), deltaLabel(kpis.current.giro, kpis.previousWeek?.giro))}
            </tr>
            <tr><td colspan="2" style="height:8px;"></td></tr>
            <tr>
              ${statCell('Ocupação', `${(kpis.current.ocupacao * 100).toFixed(1)}%`, deltaLabel(kpis.current.ocupacao, kpis.previousWeek?.ocupacao))}
              ${statCell('Receita', fmtMoney(kpis.current.receita), deltaLabel(kpis.current.receita, kpis.previousWeek?.receita))}
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 28px 0 28px;">
          <table role="presentation" width="100%" style="background:${bg};border-radius:8px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 6px 0;font-size:10px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.05em;">Leitura do período</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#18181b;">${summary.headline}</p>
                ${summary.diagnosis ? `<p style="margin:8px 0 0 0;font-size:13px;color:#3f3f46;line-height:1.55;">${summary.diagnosis}</p>` : ''}
                ${summary.keyPoints.map((p) => `<p style="margin:6px 0 0 0;font-size:12px;color:#71717a;">• ${p}</p>`).join('')}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${summary.priorityAction ? `
      <tr>
        <td style="padding:12px 28px 0 28px;">
          <table role="presentation" width="100%" style="border:1.5px solid #6366f1;border-radius:8px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.03em;">🎯 Ação prioritária</p>
                <p style="margin:0;font-size:13px;color:#18181b;line-height:1.5;">${summary.priorityAction}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      ${summary.agentPromptLink && summary.actionType !== 'none' ? `
      <tr>
        <td style="padding:10px 28px 0 28px;">
          <a href="${summary.agentPromptLink}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">🤖 Resolver com o Agente RM →</a>
        </td>
      </tr>` : ''}

      ${restOpportunities.length > 0 ? `
      <tr>
        <td style="padding:16px 28px 0 28px;">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:#18181b;text-transform:uppercase;letter-spacing:0.03em;">Outras oportunidades</p>
          <table role="presentation" width="100%">
            ${restOpportunities.map(opportunityItem).join('')}
          </table>
        </td>
      </tr>` : ''}

      ${summary.watchNextWeek ? `
      <tr>
        <td style="padding:4px 28px 0 28px;">
          <p style="margin:0;font-size:12px;color:#71717a;">👁 <strong style="color:#3f3f46;">Observar na próxima semana:</strong> ${summary.watchNextWeek}</p>
        </td>
      </tr>` : ''}

      <tr>
        <td style="padding:20px 28px 28px 28px;text-align:center;">
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
  /** Quando informado, ignora a lista de destinatários da unidade e envia SÓ para este e-mail — usado no teste manual. */
  testEmailOverride?: string
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
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'relatorios@lhgmoteis.com.br'
  // Cópia fixa em todo envio real — não entra em envios de teste (testEmailOverride),
  // que devem ficar isolados só pro endereço de teste.
  const ccEmail = process.env.WEEKLY_REPORT_CC_EMAIL ?? 'clovis@lhgmoteis.com.br'

  const recipients = params.testEmailOverride
    ? [{ email: params.testEmailOverride, name: null }]
    : await getReportRecipients(params.unitId)
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
    opportunities: params.reportData.opportunities ?? [],
    kpis: params.reportData.kpis,
    fmtMoney,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: `LHG Revenue Manager <${fromEmail}>`,
    to: recipients.map((r) => r.email),
    ...(params.testEmailOverride ? {} : { cc: ccEmail }),
    subject: `${params.testEmailOverride ? '[TESTE] ' : ''}Relatório semanal — ${params.unitName} (${periodLabel})`,
    html,
  })

  if (error) {
    console.error(`[send-weekly-report] Falha ao enviar e-mail para ${params.unitSlug}:`, error)
  }
}
