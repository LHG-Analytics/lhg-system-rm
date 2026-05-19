'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'

const LAST_UPDATED_PRIVACY = '19 de maio de 2026'
const LAST_UPDATED_TERMS   = '19 de maio de 2026'
const COMPANY_NAME         = 'LHG Gestão de Motéis Ltda.'
const CONTACT_EMAIL        = 'contato@lhgmoteis.com.br'
const PLATFORM_NAME        = 'LHG Revenue Manager'

// ─── Content ─────────────────────────────────────────────────────────────────

function PrivacyPolicy() {
  return (
    <article className="space-y-10 text-[15px] leading-7 text-foreground/85">
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">1. Quem somos</h2>
        <p>
          O {PLATFORM_NAME} é uma plataforma de gestão de receitas operada pela {COMPANY_NAME},
          destinada exclusivamente a colaboradores e parceiros autorizados das unidades do grupo LHG.
          Não comercializamos, nem oferecemos acesso público a esta plataforma.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">2. Dados que coletamos</h2>
        <p className="mb-3">Ao utilizar o {PLATFORM_NAME}, podemos coletar:</p>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li><strong>Dados de identificação:</strong> nome, endereço de e-mail e foto de perfil fornecidos pela conta Google utilizada no login.</li>
          <li><strong>Dados operacionais:</strong> métricas de desempenho (RevPAR, giro, faturamento, ocupação) extraídas do sistema ERP Automo das unidades LHG, em modo somente leitura.</li>
          <li><strong>Dados de uso:</strong> conversas com o agente de IA, propostas de precificação geradas e aprovadas, configurações de unidade e preferências de notificação.</li>
          <li><strong>Dados técnicos:</strong> logs de acesso, endereço IP e informações do navegador para fins de segurança e auditoria.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">3. Como usamos os dados</h2>
        <p className="mb-3">Utilizamos os dados coletados exclusivamente para:</p>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li>Autenticar e autorizar o acesso à plataforma.</li>
          <li>Gerar análises e recomendações de precificação com auxílio de inteligência artificial.</li>
          <li>Enviar notificações operacionais relacionadas às unidades às quais o usuário tem acesso.</li>
          <li>Manter registros de auditoria de decisões de precificação.</li>
          <li>Melhorar a qualidade das análises e do modelo de aprendizado interno da plataforma.</li>
        </ul>
        <p className="mt-3">
          <strong>Não utilizamos os seus dados para fins publicitários, nem os compartilhamos com terceiros para marketing.</strong>
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">4. Autenticação via Google</h2>
        <p>
          O login é realizado por meio do Google OAuth 2.0. Ao autenticar, o Google compartilha conosco
          seu nome, e-mail e foto de perfil. Utilizamos essas informações exclusivamente para criar e
          manter sua sessão na plataforma. Não solicitamos permissões além das necessárias para
          identificação (escopo <code className="bg-muted px-1 rounded text-xs">openid email profile</code>).
        </p>
        <p className="mt-3">
          O uso das informações recebidas do Google está sujeito também à{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            Política de Privacidade do Google
          </a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">5. Inteligência artificial</h2>
        <p>
          A plataforma utiliza modelos de linguagem de terceiros (OpenRouter / OpenAI) para análise
          de dados e geração de recomendações. As interações com o agente — incluindo o contexto de
          KPIs e tabelas de preços — podem ser processadas por esses provedores de IA conforme seus
          próprios termos de serviço. Dados pessoais identificáveis não são enviados a esses modelos.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">6. Armazenamento e segurança</h2>
        <p>
          Os dados são armazenados em banco de dados hospedado no Supabase (PostgreSQL), com
          criptografia em repouso e em trânsito (TLS 1.2+). O acesso é controlado por políticas de
          segurança em nível de linha (Row Level Security), garantindo que cada usuário acesse apenas
          os dados das unidades às quais foi autorizado.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">7. Retenção de dados</h2>
        <p>
          Os dados são retidos enquanto o usuário tiver acesso ativo à plataforma. Ao revogar o acesso,
          os dados pessoais de identificação podem ser removidos mediante solicitação. Registros
          operacionais (propostas de precificação, histórico de KPIs) podem ser mantidos para fins
          de auditoria interna por até 5 anos.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">8. Seus direitos</h2>
        <p className="mb-3">
          Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018), você tem direito a:
        </p>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li>Confirmar a existência e acessar os dados que temos sobre você.</li>
          <li>Solicitar a correção de dados incompletos ou imprecisos.</li>
          <li>Solicitar a exclusão de dados pessoais, observadas as obrigações legais de retenção.</li>
          <li>Revogar o consentimento para processamento de dados a qualquer momento.</li>
        </ul>
        <p className="mt-3">
          Para exercer qualquer desses direitos, entre em contato pelo e-mail{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4 hover:opacity-80">
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">9. Cookies e rastreamento</h2>
        <p>
          Utilizamos apenas cookies essenciais para manter a sessão autenticada. Não utilizamos cookies
          de rastreamento, analytics de terceiros ou publicidade.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">10. Alterações nesta política</h2>
        <p>
          Podemos atualizar esta política periodicamente. Alterações relevantes serão comunicadas
          por e-mail ou por notificação na plataforma. O uso contínuo após a publicação de alterações
          constitui aceite das novas condições.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">11. Contato</h2>
        <p>
          Dúvidas sobre esta Política de Privacidade podem ser encaminhadas para:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4 hover:opacity-80">
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </article>
  )
}

function TermsOfUse() {
  return (
    <article className="space-y-10 text-[15px] leading-7 text-foreground/85">
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">1. Aceitação dos Termos</h2>
        <p>
          Ao acessar e utilizar o {PLATFORM_NAME}, você confirma que leu, compreendeu e concorda
          com estes Termos de Uso. Se não concordar com qualquer disposição, não utilize a plataforma.
          O acesso é restrito a colaboradores e parceiros expressamente autorizados pela {COMPANY_NAME}.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">2. Descrição do serviço</h2>
        <p>
          O {PLATFORM_NAME} é uma ferramenta interna de gestão de receitas (Revenue Management)
          que auxilia na análise de desempenho operacional, monitoramento de concorrência e
          geração de recomendações de precificação para as unidades do grupo LHG, utilizando
          inteligência artificial como suporte à decisão humana.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">3. Acesso e segurança</h2>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li>O acesso é exclusivo mediante convite emitido por um administrador da plataforma.</li>
          <li>Você é responsável pela confidencialidade das suas credenciais de acesso.</li>
          <li>O compartilhamento de acesso com terceiros não autorizados é expressamente proibido.</li>
          <li>A {COMPANY_NAME} reserva-se o direito de revogar o acesso a qualquer momento, sem aviso prévio, em caso de uso indevido.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">4. Uso permitido</h2>
        <p className="mb-3">A plataforma deve ser utilizada exclusivamente para:</p>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li>Análise de indicadores operacionais das unidades LHG.</li>
          <li>Geração, revisão e aprovação de propostas de precificação.</li>
          <li>Consulta a histórico de desempenho e relatórios semanais.</li>
          <li>Configuração de estratégias de preços dentro das atribuições do usuário.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">5. Uso proibido</h2>
        <p className="mb-3">É expressamente proibido:</p>
        <ul className="list-disc list-inside space-y-2 pl-2">
          <li>Utilizar a plataforma para fins não relacionados às operações do grupo LHG.</li>
          <li>Exportar, copiar ou distribuir dados operacionais para terceiros não autorizados.</li>
          <li>Tentar acessar dados de unidades às quais não foi expressamente autorizado.</li>
          <li>Realizar engenharia reversa, decompilação ou qualquer tentativa de extrair o código-fonte.</li>
          <li>Utilizar scripts automatizados ou bots para interagir com a plataforma.</li>
          <li>Realizar qualquer ação que comprometa a segurança, disponibilidade ou integridade do sistema.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">6. Recomendações da IA — Limitação de responsabilidade</h2>
        <p>
          As análises e recomendações geradas pelo agente de inteligência artificial são de natureza
          <strong> consultiva</strong>. A decisão final sobre qualquer ajuste de preços ou estratégia
          comercial é de responsabilidade exclusiva do usuário e da gestão da unidade.
          A {COMPANY_NAME} não se responsabiliza por resultados operacionais decorrentes da
          aplicação das recomendações geradas pela plataforma.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">7. Propriedade intelectual</h2>
        <p>
          Todo o conteúdo, código-fonte, design, marca e funcionalidades do {PLATFORM_NAME} são
          de propriedade exclusiva da {COMPANY_NAME}. Nenhuma disposição destes Termos concede
          ao usuário qualquer direito de propriedade intelectual sobre a plataforma.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">8. Disponibilidade do serviço</h2>
        <p>
          A {COMPANY_NAME} empenhará esforços razoáveis para manter a plataforma disponível, mas
          não garante disponibilidade ininterrupta. Manutenções programadas serão comunicadas com
          antecedência sempre que possível. A empresa não se responsabiliza por indisponibilidades
          causadas por terceiros (provedores de nuvem, APIs externas, etc.).
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">9. Confidencialidade</h2>
        <p>
          As informações operacionais acessadas na plataforma — incluindo KPIs, estratégias de
          precificação, dados de concorrentes e relatórios — são consideradas informações
          confidenciais e sigilosas. O usuário compromete-se a não divulgar tais informações a
          terceiros sem autorização prévia e por escrito da {COMPANY_NAME}.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">10. Rescisão</h2>
        <p>
          O acesso à plataforma pode ser encerrado pela {COMPANY_NAME} a qualquer momento, com
          ou sem causa. O usuário também pode solicitar o encerramento do seu acesso a qualquer
          momento pelo e-mail{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4 hover:opacity-80">
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">11. Lei aplicável e foro</h2>
        <p>
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro
          da comarca de São Paulo — SP para dirimir quaisquer controvérsias decorrentes deste
          instrumento, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mb-3">12. Contato</h2>
        <p>
          Dúvidas sobre estes Termos de Uso podem ser encaminhadas para:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4 hover:opacity-80">
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </article>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LegalPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const doc = searchParams.get('doc') ?? 'privacidade'

  const isPrivacy = doc !== 'termos'
  const title       = isPrivacy ? 'Política de Privacidade' : 'Termos de Uso'
  const lastUpdated = isPrivacy ? LAST_UPDATED_PRIVACY : LAST_UPDATED_TERMS

  function setDoc(d: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('doc', d)
    router.push(`/legal?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/login" className="shrink-0 opacity-90 hover:opacity-100 transition-opacity">
            <Image
              src="/lhg-logo-white.png"
              alt="LHG"
              width={88}
              height={36}
              style={{ height: 'auto' }}
              priority
            />
          </Link>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setDoc('privacidade')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                isPrivacy
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              Privacidade
            </button>
            <button
              onClick={() => setDoc('termos')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                !isPrivacy
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              Termos de Uso
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-border/30 bg-card/30">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Última atualização: {lastUpdated}
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {isPrivacy ? <PrivacyPolicy /> : <TermsOfUse />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 bg-card/20 mt-8">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} {COMPANY_NAME}</span>
          <div className="flex items-center gap-6">
            <button
              onClick={() => setDoc('privacidade')}
              className="hover:text-foreground transition-colors"
            >
              Política de Privacidade
            </button>
            <button
              onClick={() => setDoc('termos')}
              className="hover:text-foreground transition-colors"
            >
              Termos de Uso
            </button>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="hover:text-foreground transition-colors"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function LegalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    }>
      <LegalPageInner />
    </Suspense>
  )
}
