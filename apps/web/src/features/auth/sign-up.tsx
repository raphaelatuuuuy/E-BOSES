import { ChevronLeft } from "lucide-react"

import type { AuthUser } from "@/features/auth/api"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { SignUpForm } from "@/features/auth/components/sign-up-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface SignUpPageProps {
  onBack?: () => void
  onSignIn?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export default function SignUpPage({ onBack, onSignIn, onSuccess }: SignUpPageProps) {
  usePageTitle("Sign Up")

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-[40fr_60fr] lg:overflow-hidden">
      <section className="relative flex flex-col overflow-y-auto p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:p-10 lg:min-h-0">
        <button
          type="button"
          onClick={onBack ?? onSignIn}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <SignUpForm onSignIn={onSignIn} onSuccess={onSuccess} />
          </div>
        </div>
      </section>
      <AuthSidePanel />
    </main>
  )
}
