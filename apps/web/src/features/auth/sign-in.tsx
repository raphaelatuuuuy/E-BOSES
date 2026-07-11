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
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />

      {/* Right: Form panel */}
      <section className="flex flex-col justify-center overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center">
          <div className="mb-6 lg:hidden">
            <img src="/contents/logo.png" alt="E-Boses" className="mx-auto h-16 w-auto" />
          </div>
          <h1 className="text-balance text-center text-4xl font-heading font-bold">Welcome back</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Report concerns, get alerts, and stay connected to your barangay
          </p>
          <div className="mt-8 w-full">
            <LoginForm onForgotPassword={onForgotPassword} onSignUp={onSignUp} onSuccess={onSuccess} />
          </div>
        </div>
      </section>
    </main>
  )
}
