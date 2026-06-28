import { useEffect, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"

import { OtpVerificationForm } from "@/features/auth/components/otp-verification-form"
import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"
import { usePageTitle } from "@/hooks/use-page-title"

interface OtpVerificationPageProps {
  title: string
  description: string
  recipientHint: string
  actionLabel: string
  resendStorageKey: string
  onBack?: () => void
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
  onSuccess,
}: OtpVerificationPageProps) {
  const { gradient, taglineLines } = useAuthPanelRotation()
  const [resendExpiry, setResendExpiryState] = useState(() => getResendExpiry(resendStorageKey))
  const [secondsRemaining, setSecondsRemaining] = useState(0)

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

  function handleResend() {
    setResendExpiryState(setResendExpiry(resendStorageKey))
    toast.success("Code sent", {
      description: "A new verification code has been sent to your email.",
    })
  }

  const resendDisabled = secondsRemaining > 0
  const resendLabel = resendDisabled
    ? `Resend (${formatSeconds(secondsRemaining)})`
    : "Resend?"
  const composedDescription = recipientHint
    ? `${description} ${recipientHint}.`
    : description

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-[40fr_60fr] lg:overflow-hidden">
      <section className="relative flex flex-col overflow-y-auto p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:p-10 lg:min-h-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
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
          </div>
        </div>
      </section>
      <section
        className="relative hidden overflow-hidden lg:block lg:h-svh"
        aria-hidden="true"
      >
        <div
          className={`absolute inset-0 ${gradient} animate-[gradientShift_8s_ease_infinite]`}
          style={{ backgroundSize: "200% 200%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
          <h2 className="font-serif text-balance text-3xl leading-tight text-white md:text-4xl">
            {taglineLines[0]}
            <br />
            {taglineLines[1]}
          </h2>
        </div>
      </section>
    </main>
  )
}
