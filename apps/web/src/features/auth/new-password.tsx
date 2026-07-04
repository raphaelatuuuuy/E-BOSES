import { ChevronLeft } from "lucide-react"

import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { NewPasswordForm } from "@/features/auth/components/new-password-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface NewPasswordPageProps {
  onBack?: () => void
  onSuccess?: (password: string) => void
}

export default function NewPasswordPage({
  onBack,
  onSuccess,
}: NewPasswordPageProps) {
  usePageTitle("Create New Password")

  return (
    <main className="grid min-h-svh w-full lg:grid-cols-[40fr_60fr]">
      <section className="relative flex flex-col p-6 md:p-10 overflow-y-auto">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <NewPasswordForm onBack={onBack} onSuccess={onSuccess} />
          </div>
        </div>
        <div className="flex justify-center pt-10 pb-4">
          <img src="/contents/footer-auth.png" alt="" className="w-full h-auto" aria-hidden="true" />
        </div>
      </section>
      <AuthSidePanel />
    </main>
  )
}
