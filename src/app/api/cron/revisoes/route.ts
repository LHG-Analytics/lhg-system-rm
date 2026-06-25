import { NextRequest, NextResponse, after } from 'next/server'
import { runPendingReviews } from '@/lib/cron/run-reviews'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    // CRON_SECRET ausente → cron sempre falha com 401. Configurar em:
    // Vercel Dashboard → Settings → Environment Variables → adicionar CRON_SECRET (Production)
    console.error('[cron/revisoes] CRON_SECRET não configurado na Vercel! O cron não consegue autenticar.')
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.error('[cron/revisoes] 401 — header recebido:', authHeader?.slice(0, 30) ?? '(ausente)')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Responde imediatamente para o scheduler da Vercel não registrar timeout.
  // O trabalho pesado (geração de IA, manutenção de 5+ unidades) roda em background.
  after(async () => {
    try {
      const result = await runPendingReviews()
      console.log('[cron/revisoes] Concluído:', JSON.stringify({ executed: result.executed, done: result.done, failed: result.failed }))
    } catch (err) {
      console.error('[cron/revisoes] Erro em background:', err instanceof Error ? err.message : String(err))
    }
  })

  return NextResponse.json({ ok: true, queued: true })
}
