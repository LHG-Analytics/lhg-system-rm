import { NextRequest, NextResponse } from 'next/server'

// Rota de diagnóstico temporária — remover após debug
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const email = process.env.LHG_ANALYTICS_EMAIL
  const password = process.env.LHG_ANALYTICS_PASSWORD

  if (!email || !password) {
    return NextResponse.json({ error: 'Credenciais não configuradas', email: !!email, password: !!password })
  }

  try {
    const res = await fetch('https://analytics.lhgmoteis.com.br/auth/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const setCookie = res.headers.get('set-cookie')
    const allHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { allHeaders[k] = v })

    const body = await res.text()

    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      setCookieHeader: setCookie,
      allHeaders,
      bodyPreview: body.slice(0, 300),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
