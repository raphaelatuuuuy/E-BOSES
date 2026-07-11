import { LoaderCircle } from "lucide-react"

import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

export default function AccountPendingPage() {
  useAuthSession()

  usePageTitle("Account Pending Verification")

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex flex-1 flex-col justify-center overflow-y-auto p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <LoaderCircle className="size-8 animate-spin text-primary" />
            </div>
            <div className="mb-6 lg:hidden">
              <img src="/contents/logo.png" alt="E-Boses" className="mx-auto h-16 w-auto" />
            </div>
            <h1 className="text-4xl font-heading font-bold">Verifying your documents</h1>
            <p className="text-sm text-muted-foreground">
              Your account is being reviewed. We&apos;re automatically checking your submitted documents to ensure they
              are valid. This usually takes just a few minutes.
            </p>
            <p className="text-sm text-muted-foreground">
              Please check back shortly. You&apos;ll be able to access your account once verification is complete.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
