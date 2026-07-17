import type { AuthUser } from "@/features/auth/api"
import { AuthPageLogo } from "@/features/auth/components/auth-page-logo"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { LoginForm } from "@/features/auth/components/login-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface LoginPageProps {
  onBack?: () => void
  onForgotPassword?: () => void
  onSignUp?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export default function LoginPage({ onForgotPassword, onSignUp, onSuccess }: LoginPageProps) {
  usePageTitle("Sign In")

  return (
    <main className="grid min-h-svh w-full bg-white lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />

      <section className="relative flex min-h-svh flex-col overflow-y-auto lg:h-full lg:min-h-0">
        <AuthPageLogo />
        <div className="flex flex-1 flex-col justify-center px-6 py-8 md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <h1 className="text-[1.5rem] font-medium leading-tight tracking-tight text-[#0f172a] md:text-[1.75rem]">
              Welcome back
            </h1>

            <div className="mt-[26px]">
              <LoginForm
                onForgotPassword={onForgotPassword}
                onSignUp={onSignUp}
                onSuccess={onSuccess}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
