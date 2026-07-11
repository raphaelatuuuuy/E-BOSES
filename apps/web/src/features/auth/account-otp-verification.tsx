import { useEffect, useState } from "react"
import { ChevronLeft, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"

import { resendOtp, verifyOtp, type AuthUser } from "@/features/auth/api"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { usePageTitle } from "@/hooks/use-page-title"

interface AccountOtpVerificationPageProps {
  onBack?: () => void
  onSuccess?: (user: AuthUser) => void
}

const errorSlotClassName =
  "border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.15)] data-[active=true]:border-destructive data-[active=true]:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"

const RESEND_COOLDOWN_SECONDS = 60

export default function AccountOtpVerificationPage({
  onBack,
  onSuccess,
}: AccountOtpVerificationPageProps) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [cooldownExpiry, setCooldownExpiry] = useState<number | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  usePageTitle("Verify Account")

  useEffect(() => {
    if (!cooldownExpiry) {
      setCooldownSeconds(0)
      return
    }

    function tick() {
      const remaining = Math.max(0, Math.ceil((cooldownExpiry - Date.now()) / 1000))
      setCooldownSeconds(remaining)
      if (remaining === 0) setCooldownExpiry(null)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownExpiry])

  async function handleVerify() {
    if (code.length !== 6) {
      setError("Enter the 6-digit code.")
      return
    }

    setIsVerifying(true)
    setError("")
    setSubmitError("")

    try {
      const user = await verifyOtp({ channel: "email", purpose: "registration", code })
      onSuccess?.(user)
    } catch {
      setError("Invalid or expired code. Try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleResend() {
    if (isResending) return
    setIsResending(true)
    setSubmitError("")
    try {
      await resendOtp({ channel: "email", purpose: "registration" })
      setCooldownExpiry(Date.now() + RESEND_COOLDOWN_SECONDS * 1000)
      toast.success("Code sent", {
        description: "A new verification code has been sent to your email.",
      })
    } catch {
      setSubmitError("Could not resend code. Try again later.")
    } finally {
      setIsResending(false)
    }
  }

  function renderCodeField() {
    const cooldownActive = cooldownSeconds > 0

    return (
      <Field data-invalid={Boolean(error)}>
        <div className="flex items-start justify-between gap-3">
          <FieldLabel>Email code</FieldLabel>
          <button
            type="button"
            disabled={isResending || cooldownActive || isVerifying}
            onClick={handleResend}
            className="shrink-0 text-sm font-medium text-foreground underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          >
            {cooldownActive ? `Resend (${cooldownSeconds}s)` : "Resend?"}
          </button>
        </div>
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(code) => {
            setCode(code.replace(/\D/g, ""))
            setError("")
          }}
          disabled={isVerifying}
          aria-invalid={Boolean(error)}
          containerClassName="w-full"
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }).map((_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className={error ? errorSlotClassName : undefined}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error ? <FieldError>{error}</FieldError> : null}
        <Button
          type="button"
          className="h-14 w-full rounded-full text-base"
          disabled={isVerifying}
          onClick={handleVerify}
        >
          {isVerifying ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {isVerifying ? "Verifying" : "Verify email code"}
        </Button>
      </Field>
    )
  }

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex flex-1 flex-col justify-center overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center">
          <div className="mb-6 lg:hidden">
            <img src="/contents/logo.png" alt="E-Boses" className="mx-auto h-16 w-auto" />
          </div>
          <h1 className="text-balance text-center text-4xl font-heading font-bold">Verify your account</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Enter the 6-digit code sent to your email address.
          </p>
          <div className="mt-8 w-full">
            <div className="flex flex-col gap-4">
              {renderCodeField()}
              {submitError ? (
                <div aria-live="polite" aria-atomic="true">
                  <FieldError>{submitError}</FieldError>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
