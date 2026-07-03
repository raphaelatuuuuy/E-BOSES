import { LoaderCircle } from "lucide-react"

import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

export default function AccountPendingPage() {
  useAuthSession()

  usePageTitle("Account Pending Verification")

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LoaderCircle className="size-8 animate-spin text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Verifying your documents</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is being reviewed. We're automatically checking your submitted documents to ensure they are valid. This usually takes just a few minutes.
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          Please check back shortly. You'll be able to access your account once verification is complete.
        </p>
      </div>
    </main>
  )
}
