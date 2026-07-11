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
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex flex-1 flex-col overflow-y-auto p-6 md:p-10 [overflow-x:clip]">
        <div className="mx-auto flex w-full max-w-md flex-col items-center">
          <div className="mb-6 lg:hidden">
            <img src="/contents/logo.png" alt="E-Boses" className="mx-auto h-16 w-auto" />
          </div>
          <h1 className="text-balance text-center text-4xl font-heading font-bold">Create an account</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Fill in the details below to get started
          </p>
          <div className="mt-8 w-full">
            <SignUpForm onSignIn={onSignIn} onSuccess={onSuccess} />
          </div>
        </div>
      </section>
    </main>
  )
}
