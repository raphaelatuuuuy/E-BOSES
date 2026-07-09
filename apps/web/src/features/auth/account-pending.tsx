import { LoaderCircle } from "lucide-react"

import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

export default function AccountPendingPage() {
  useAuthSession()

  usePageTitle("Account Pending Verification")

  return (
    <main className="grid min-h-svh w-full lg:grid-cols-[40fr_60fr]">
      <section className="relative flex flex-col p-6 md:p-10 overflow-y-auto">
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <LoaderCircle className="size-8 animate-spin text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Verifying your documents</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account is being reviewed. We&apos;re automatically checking your submitted documents to ensure they
              are valid. This usually takes just a few minutes.
            </p>
            <p className="mt-6 text-xs text-muted-foreground">
              Please check back shortly. You&apos;ll be able to access your account once verification is complete.
            </p>
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
