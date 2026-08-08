import { AuthPageLogo } from "@/features/auth/components/auth-page-logo"
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
    <main className="grid min-h-svh w-full bg-white lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex min-h-svh flex-col overflow-y-auto lg:h-full lg:min-h-0">
        <AuthPageLogo />
        <div className="flex flex-1 flex-col justify-center px-6 py-8 md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <h1 className="text-center text-[1.5rem] font-medium leading-tight tracking-tight text-foreground md:text-[1.75rem]">
              Reset your password
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Enter the email address associated with your account, and we will email you a secure
              link to reset your password
            </p>
            <div className="mt-7">
              <ForgotPasswordForm onBack={onBack} onSuccess={onSuccess} />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}