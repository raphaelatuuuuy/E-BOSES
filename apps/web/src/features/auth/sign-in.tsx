import { ChevronLeft } from "lucide-react"

import type { AuthUser } from "@/features/auth/api"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { LoginForm } from "@/features/auth/components/login-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface LoginPageProps {
  onBack?: () => void
  onForgotPassword?: () => void
  onSignUp?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export default function LoginPage({ onBack, onForgotPassword, onSignUp, onSuccess }: LoginPageProps) {
  usePageTitle("Sign In")

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-[40fr_60fr] lg:overflow-hidden">
      {/* Left: Form panel */}
      <section className="relative flex flex-col overflow-y-auto p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:p-10 lg:min-h-0">
        <button
          type="button"
          onClick={onBack ?? (() => window.history.back())}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <LoginForm onForgotPassword={onForgotPassword} onSignUp={onSignUp} onSuccess={onSuccess} />
          </div>
        </div>
        <div className="flex justify-center mt-auto -mx-6 -mb-6 md:-mx-10 md:-mb-10">
          <img src="/contents/footer-auth.png" alt="" className="w-full h-auto" aria-hidden="true" />
        </div>
      </section>

      <AuthSidePanel />
    </main>
  )
}
