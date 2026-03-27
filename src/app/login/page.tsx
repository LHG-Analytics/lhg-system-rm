import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './_components/login-form'

export const metadata = {
  title: 'Entrar — LHG Revenue Manager',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  const params = await searchParams
  const errorMap: Record<string, string> = {
    auth_callback_failed: 'Falha na autenticação. Tente novamente.',
  }
  const error = params.error ? (errorMap[params.error] ?? 'Erro desconhecido.') : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">LHG Revenue Manager</h1>
          <p className="text-sm text-muted-foreground">
            Gestão de preços e disponibilidade
          </p>
        </div>

        <Card>
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg">Entrar</CardTitle>
            <CardDescription>
              Acesse o painel da sua unidade
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
