import { ChevronLeft } from "lucide-react"

import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface ForgotPasswordPageProps {
  onBack?: () => void
  onSuccess?: (email: string) => void
}

export default function ForgotPasswordPage({
  onBack,
  onSuccess,
}: ForgotPasswordPageProps) {
  usePageTitle("Forgot Password")

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex flex-1 flex-col justify-center overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center">
          <div className="mb-6 lg:hidden">
            <img src="/contents/logo.png" alt="E-Boses" className="mx-auto h-16 w-auto" />
          </div>
          <h1 className="text-balance text-center text-4xl font-heading font-bold">Forgot password</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a reset code
          </p>
          <div className="mt-8 w-full">
            <ForgotPasswordForm onBack={onBack} onSuccess={onSuccess} />
          </div>
        </div>
      </section>
    </main>
  )
}
