import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'edge'

// ─── GET: lista guardrails da unidade ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const unitSlug = req.nextUrl.searchParams.get('unitSlug')
  if (!unitSlug) return new Response('unitSlug obrigatório', { status: 400 })

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  const { data, error } = await supabase
    .from('agent_price_guardrails')
    .select('id, categoria, periodo, dia_semana, hora_inicio, hora_fim, preco_minimo, preco_maximo')
    .eq('unit_id', unit.id)
    .order('categoria')
    .order('periodo')
    .order('dia_semana')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// ─── POST: cria ou atualiza guardrails (um por dia selecionado) ───────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, unit_id')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return new Response('Apenas admins podem configurar guardrails', { status: 403 })
  }

  const body = await req.json() as {
    unitSlug: string
    categoria: string
    periodo: string
    dias: string[]         // um ou mais dias da semana
    hora_inicio?: string   // "HH:MM" opcional
    hora_fim?: string      // "HH:MM" opcional
    preco_minimo: number
    preco_maximo: number
  }

  const { unitSlug, categoria, periodo, preco_minimo, preco_maximo } = body
  const dias = body.dias ?? ['todos']
  const hora_inicio = body.hora_inicio || null
  const hora_fim    = body.hora_fim    || null

  if (!unitSlug || !categoria || !periodo) {
    return new Response('unitSlug, categoria e periodo são obrigatórios', { status: 400 })
  }
  if (!dias.length) {
    return new Response('Selecione ao menos um dia', { status: 400 })
  }
  const VALID_DIAS = ['todos', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
    // legados migrados
    'semana', 'fds_feriado',
  ]
  const invalidDia = dias.find((d) => !VALID_DIAS.includes(d))
  if (invalidDia) return new Response(`dia inválido: ${invalidDia}`, { status: 400 })

  if (typeof preco_minimo !== 'number' || typeof preco_maximo !== 'number') {
    return new Response('preco_minimo e preco_maximo devem ser números', { status: 400 })
  }
  if (preco_minimo >= preco_maximo) {
    return new Response('preco_minimo deve ser menor que preco_maximo', { status: 400 })
  }
  if (preco_minimo < 0) {
    return new Response('preco_minimo não pode ser negativo', { status: 400 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('slug', unitSlug)
    .single()

  if (!unit) return new Response('Unidade não encontrada', { status: 404 })

  // Upsert em paralelo — um row por dia selecionado
  const upsertResults = await Promise.all(
    dias.map((dia) =>
      supabase
        .from('agent_price_guardrails')
        .upsert(
          {
            unit_id:      unit.id,
            categoria,
            periodo,
            dia_semana:   dia,
            hora_inicio,
            hora_fim,
            preco_minimo,
            preco_maximo,
            created_by:   user.id,
          },
          { onConflict: 'unit_id,categoria,periodo,dia_semana' }
        )
        .select()
        .single()
    )
  )

  const errors = upsertResults.filter((r) => r.error)
  if (errors.length) return Response.json({ error: errors[0].error?.message }, { status: 500 })

  const rows = upsertResults.flatMap((r) => (r.data ? [r.data] : []))
  return Response.json(rows)
}

// ─── DELETE: remove guardrail por id ──────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return new Response('Apenas admins podem remover guardrails', { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('id obrigatório', { status: 400 })

  const { error } = await supabase
    .from('agent_price_guardrails')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
