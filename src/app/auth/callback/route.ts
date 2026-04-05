import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      // Verifica se o usuário tem perfil cadastrado (invite-only)
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', data.user.id)
        .maybeSingle()

      if (!profile) {
        // Usuário autenticou mas não foi convidado — faz sign out e rejeita
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/login?error=unauthorized`)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
