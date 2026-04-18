import { NextRequest, NextResponse } from 'next/server'
import { runPendingReviews } from '@/lib/cron/run-reviews'

// Aumenta o timeout para 60s no Hobby plan (suficiente para geração de IA)
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runPendingReviews()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/revisoes] Erro:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
