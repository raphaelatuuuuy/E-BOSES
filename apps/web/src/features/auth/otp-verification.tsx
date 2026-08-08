import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AuthPageLogo } from "@/features/auth/components/auth-page-logo"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { OtpVerificationForm } from "@/features/auth/components/otp-verification-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface OtpVerificationPageProps {
  title: string
  description: string
  recipientHint: string
  actionLabel: string
  resendStorageKey: string
  onBack?: () => void
  onResend?: () => Promise<void> | void
  onSuccess?: (code: string) => void
}

const RESEND_COOLDOWN_SECONDS = 60

function getResendExpiry(storageKey: string) {
  if (typeof window === "undefined") {
    return 0
  }

  const storedValue = window.localStorage.getItem(storageKey)
  const parsedValue = storedValue ? Number(storedValue) : 0

  return Number.isFinite(parsedValue) ? parsedValue : 0
}

function setResendExpiry(storageKey: string) {
  if (typeof window === "undefined") {
    return Date.now()
  }

  const expiresAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
  window.localStorage.setItem(storageKey, String(expiresAt))
  return expiresAt
}

function formatSeconds(seconds: number) {
  return `${seconds}s`
}

export default function OtpVerificationPage({
  title,
  description,
  recipientHint,
  actionLabel,
  resendStorageKey,
  onBack,
  onResend,
  onSuccess,
}: OtpVerificationPageProps) {
  const [resendExpiry, setResendExpiryState] = useState(() => getResendExpiry(resendStorageKey))
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [isResending, setIsResending] = useState(false)
  const [resendError, setResendError] = useState("")

  usePageTitle(title)

  useEffect(() => {
    const updateRemainingTime = () => {
      const remaining = Math.max(0, Math.ceil((resendExpiry - Date.now()) / 1000))
      setSecondsRemaining(remaining)
    }

    updateRemainingTime()

    if (resendExpiry <= Date.now()) {
      return
    }

    const timer = window.setInterval(updateRemainingTime, 1000)
    return () => window.clearInterval(timer)
  }, [resendExpiry])

  async function handleResend() {
    if (isResending || secondsRemaining > 0) return

    setIsResending(true)
    setResendError("")
    try {
      await onResend?.()
      setResendExpiryState(setResendExpiry(resendStorageKey))
      toast.success("Code sent", {
        description: "A new verification code has been sent to your email.",
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not resend code. Try again later."
      setResendError(message)
      toast.error(message)
    } finally {
      setIsResending(false)
    }
  }

  const resendDisabled = secondsRemaining > 0 || isResending
  const resendLabel = resendDisabled
    ? `Resend (${formatSeconds(secondsRemaining)})`
    : "Resend?"
  const composedDescription = recipientHint
    ? `${description} ${recipientHint}.`
    : description

  return (
    <main className="grid min-h-svh w-full bg-white lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex min-h-svh flex-col overflow-y-auto lg:h-full lg:min-h-0">
        <AuthPageLogo />
        <div className="flex flex-1 flex-col justify-center px-6 py-8 md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <h1 className="text-center text-[1.5rem] font-medium leading-tight tracking-tight text-foreground md:text-[1.75rem]">
              {title}
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">{composedDescription}</p>
            <div className="mt-7">
              <OtpVerificationForm
                title={title}
                description={composedDescription}
                actionLabel={actionLabel}
                onBack={onBack}
                onResend={handleResend}
                resendDisabled={resendDisabled}
                resendLabel={resendLabel}
                onSuccess={onSuccess}
              />
              {resendError ? (
                <p className="mt-3 text-center text-sm font-medium text-destructive" role="alert">
                  {resendError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}