import { ChevronLeft } from "lucide-react"

import { LoginForm } from "@/features/auth/components/login-form"
import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"
import { usePageTitle } from "@/hooks/use-page-title"

interface LoginPageProps {
  onForgotPassword?: () => void
  onSignUp?: () => void
  onSuccess?: () => void
}

export default function LoginPage({ onForgotPassword, onSignUp, onSuccess }: LoginPageProps) {
  const { gradient, taglineLines } = useAuthPanelRotation()

  usePageTitle("Sign In")

  return (
    <main className="grid min-h-svh w-full lg:grid-cols-[40fr_60fr]">
      {/* Left: Form panel */}
      <section className="relative flex flex-col p-6 md:p-10 overflow-y-auto">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <LoginForm onForgotPassword={onForgotPassword} onSignUp={onSignUp} onSuccess={onSuccess} />
          </div>
        </div>
      </section>

      {/* Right: Gradient panel */}
      <section
        className="relative hidden h-full min-h-screen lg:block overflow-hidden"
        aria-hidden="true"
      >
        <div className={`absolute inset-0 ${gradient} bg-[length:200%_200%] animate-gradient-shift`} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
          <h2 className="font-heading text-balance text-3xl leading-tight text-white md:text-4xl">
            {taglineLines[0]}
            <br />
            {taglineLines[1]}
          </h2>
        </div>
      </section>
    </main>
  )
}
