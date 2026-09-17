import { useEffect, useState } from "react"
import { LoaderCircle, Pencil, RotateCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { FieldError } from "@workspace/ui/components/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { cn } from "@workspace/ui/lib/utils"

import { resendOtp, verifyOtp, type AuthUser } from "@/features/auth/api"
import { AuthPageLogo } from "@/features/auth/components/auth-page-logo"
import { AuthSidePanel } from "@/features/auth/components/auth-side-panel"
import { usePageTitle } from "@/hooks/use-page-title"

interface AccountOtpVerificationPageProps {
  onBack?: () => void
  onSuccess?: (user: AuthUser) => void
}

const OTP_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60

const errorSlotClassName =
  "border-[3px] border-destructive data-[active=true]:border-[3px] data-[active=true]:border-destructive"

const slotClassName =
  "h-14 min-w-0 flex-1 rounded-xl border border-card-line-strong bg-white text-lg font-medium text-foreground shadow-none data-[active=true]:border-[3px] data-[active=true]:border-primary"

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

  // Reset the displayed seconds whenever the cooldown is cleared — render-adjust
  // instead of a sync setState at the top of the ticking effect below.
  const [prevExpiry, setPrevExpiry] = useState(cooldownExpiry)
  if (prevExpiry !== cooldownExpiry) {
    setPrevExpiry(cooldownExpiry)
    if (cooldownExpiry === null) setCooldownSeconds(0)
  }

  usePageTitle("Verify Account")

  useEffect(() => {
    const expiry = cooldownExpiry
    if (expiry === null) return

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiry - Date.now()) / 1000))
      setCooldownSeconds(remaining)
      if (remaining === 0) setCooldownExpiry(null)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownExpiry])

  async function handleVerify() {
    if (code.length !== OTP_LENGTH) {
      setError("Enter the 6-digit code.")
      return
    }

    setIsVerifying(true)
    setError("")
    setSubmitError("")

    try {
      const nextUser = await verifyOtp({ channel: "email", purpose: "registration", code })
      onSuccess?.(nextUser)
    } catch {
      setError("Invalid or expired code. Try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleResend() {
    if (isResending || cooldownSeconds > 0) return
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

  const cooldownActive = cooldownSeconds > 0
  const codeComplete = code.replace(/\D/g, "").length === OTP_LENGTH

  return (
    <main className="grid min-h-svh w-full bg-white lg:h-svh lg:grid-cols-2 lg:overflow-hidden">
      <AuthSidePanel />
      <section className="relative flex min-h-svh flex-col overflow-y-auto lg:h-full lg:min-h-0">
        <div className="flex flex-1 flex-col justify-center px-6 pb-8 pt-[max(2rem,env(safe-area-inset-top))] md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[440px]">
            <AuthPageLogo className="py-0 pb-5" />
            <h1 className="text-[1.5rem] font-semibold leading-snug tracking-tight text-foreground md:text-[1.75rem]">
              Enter the code sent to you.
            </h1>

            <div className="mt-8">
              <InputOTP
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(next) => {
                  setCode(next.replace(/\D/g, ""))
                  setError("")
                }}
                disabled={isVerifying}
                aria-invalid={Boolean(error)}
                aria-label="Email verification code"
                containerClassName="w-full"
              >
                <InputOTPGroup className="gap-2.5 sm:gap-3">
                  {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className={cn(slotClassName, error ? errorSlotClassName : undefined)}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error ? <FieldError className="mt-2">{error}</FieldError> : null}
            </div>

            <button
              type="button"
              disabled={isResending || cooldownActive || isVerifying}
              onClick={handleResend}
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-subtle-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw
                className={cn("size-4 shrink-0", isResending && "animate-spin")}
                aria-hidden="true"
              />
              {cooldownActive ? `Resend code (${cooldownSeconds}s)` : "Resend code"}
            </button>

            {submitError ? (
              <div className="mt-3" aria-live="polite" aria-atomic="true">
                <FieldError>{submitError}</FieldError>
              </div>
            ) : null}

            <div className="mt-10 flex items-center justify-end gap-5">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  disabled={isVerifying}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue transition-colors hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Edit your email
                  <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
                </button>
              ) : null}
              <Button
                type="button"
                disabled={isVerifying || !codeComplete}
                onClick={handleVerify}
                className="h-11 min-w-[7.5rem] rounded-full bg-brand-navy px-8 text-base font-semibold text-white shadow-none hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isVerifying ? (
                  <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  "Submit"
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}