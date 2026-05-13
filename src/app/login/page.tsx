import Image from 'next/image'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './_components/login-form'
import { ThreeDMarquee } from '@/components/ui/3d-marquee'

export const metadata = {
  title: 'Entrar — LHG Revenue Manager',
}

// Logos repetidas em ordens diferentes para compor as 4 linhas do marquee
const MARQUEE_IMAGES = [
  '/lhg-logo-white.png',
  '/lush-logo.png',
  '/tout-logo.png',
  '/altana-logo.webp',
  '/liv-logo.png',
  '/andar-de-cima-logo.png',
  '/lhg-logo-color.png',
  '/lush-logo.png',
  // linha 2
  '/tout-logo.png',
  '/altana-logo.webp',
  '/lhg-logo-white.png',
  '/liv-logo.png',
  '/andar-de-cima-logo.png',
  '/lhg-logo-color.png',
  '/lush-logo.png',
  '/tout-logo.png',
  // linha 3
  '/altana-logo.webp',
  '/lhg-logo-color.png',
  '/andar-de-cima-logo.png',
  '/lush-logo.png',
  '/lhg-logo-white.png',
  '/tout-logo.png',
  '/liv-logo.png',
  '/altana-logo.webp',
  // linha 4
  '/liv-logo.png',
  '/lhg-logo-white.png',
  '/tout-logo.png',
  '/lush-logo.png',
  '/altana-logo.webp',
  '/andar-de-cima-logo.png',
  '/lhg-logo-color.png',
  '/liv-logo.png',
]

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
    unauthorized: 'Acesso não autorizado. Solicite um convite ao administrador.',
  }
  const error = params.error ? (errorMap[params.error] ?? 'Erro desconhecido.') : null

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950">
      {/* Background: grade 3D com logos das unidades */}
      <div className="absolute inset-0">
        <ThreeDMarquee images={MARQUEE_IMAGES} />
      </div>

      {/* Overlay escuro para legibilidade do formulário */}
      <div className="absolute inset-0 bg-neutral-950/65" />

      {/* Formulário centralizado */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/lhg-logo-white.png"
              alt="LHG"
              width={120}
              height={48}
              priority
              style={{ height: 'auto' }}
            />
            <p className="text-sm text-neutral-400">
              Gestão de preços e disponibilidade
            </p>
          </div>

          <Card className="border-white/10 bg-neutral-900/80 backdrop-blur-md">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-lg text-neutral-100">Entrar</CardTitle>
              <CardDescription className="text-neutral-400">
                Acesse o painel da sua unidade
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
