import { AuthPageLogo } from "@/features/auth/components/auth-page-logo"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { NewPasswordForm } from "@/features/auth/components/new-password-form"
import { usePageTitle } from "@/hooks/use-page-title"

function getObfuscatedEmail(): string | null {
  if (typeof window === "undefined") return null
  const email = window.sessionStorage.getItem("eboses-reset-identifier")
  if (!email || !email.includes("@")) return null
  const [local] = email.split("@")
  if (local.length <= 1) return email
  return local[0] + "**********" + local.slice(-1) + "@gmail.com"
}

interface NewPasswordPageProps {
  onBack?: () => void
  onSuccess?: (password: string) => void
}

export default function NewPasswordPage({
  onBack,
  onSuccess,
}: NewPasswordPageProps) {
  usePageTitle("Create New Password")
  const obfuscated = getObfuscatedEmail()

  return (
    <main className="grid min-h-svh w-full bg-white lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex min-h-svh flex-col overflow-y-auto lg:h-full lg:min-h-0">
        <div className="flex flex-1 flex-col justify-center px-6 py-8 md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <AuthPageLogo className="py-0 pb-5" />
            <h1 className="text-center text-[1.5rem] font-medium leading-tight tracking-tight text-foreground md:text-[1.75rem]">
              Set your new password
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              This is intended for the user associated with {obfuscated ?? "your account"}.
            </p>
            <div className="mt-7">
              <NewPasswordForm onBack={onBack} onSuccess={onSuccess} />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}