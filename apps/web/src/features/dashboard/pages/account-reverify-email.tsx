import { useEffect, useState } from "react"
import { ChevronLeftIcon, Loader2Icon } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkEmailAvailability,
  requestAccountEmailOtp,
  verifyAccountEmailOtp,
} from "@/features/auth/api"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { getAccessToken } from "@/lib/api"
import { ApiError } from "@/lib/api"
import { cn } from "@workspace/ui/lib/utils"

const OTP_LENGTH = 6

const otpSlotClass =
  "h-14 min-w-0 flex-1 rounded-xl border-2 border-input bg-white text-lg font-medium text-neutral-800 shadow-none data-[active=true]:border-[3px] data-[active=true]:border-primary"

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white transition-colors hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"

export default function AccountReverifyEmailPage() {
  usePageTitle("Verify email")
  const navigate = useNavigate()
  const location = useLocation()
  const { user, setAuthenticatedUser, refreshUser } = useAuthSession()
  const draftFromState =
    (location.state as { email?: string } | null)?.email?.trim() || ""

  const [step, setStep] = useState<"enter" | "otp">("enter")
  const [email, setEmail] = useState(draftFromState || "")
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const normalized = email.trim().toLowerCase()
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  const progress = step === "enter" ? 45 : 90

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  function goBack() {
    if (step === "otp") {
      setStep("enter")
      setCode("")
      setError("")
      return
    }
    navigate("/dashboard/settings?panel=account")
  }

  async function sendOtp() {
    if (!looksLikeEmail) {
      setError("Enter a valid email address.")
      return
    }
    if (normalized === (user?.email || "").toLowerCase()) {
      setError("That is already your email address.")
      return
    }
    setSending(true)
    setError("")
    try {
      const availability = await checkEmailAvailability({ email: normalized })
      if (!availability.available) {
        setError(availability.message || "This email is already in use.")
        return
      }
      await requestAccountEmailOtp({ email: normalized })
      setStep("otp")
      setCooldown(45)
      toast.success("Verification code sent")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send code.")
    } finally {
      setSending(false)
    }
  }

  async function verifyOtp() {
    if (!looksLikeEmail || code.replace(/\D/g, "").length !== OTP_LENGTH) return
    setVerifying(true)
    setError("")
    try {
      const nextUser = await verifyAccountEmailOtp({
        email: normalized,
        code: code.replace(/\D/g, ""),
      })
      const access = getAccessToken()
      if (access) setAuthenticatedUser(nextUser, access)
      else await refreshUser()
      toast.success("Email updated")
      navigate("/dashboard/settings?panel=account", { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid code. Try again.")
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-white">
      <div className="mx-auto w-full max-w-[600px] flex-1 px-5 pb-10 pt-4 md:px-0 md:pt-6">
        <header className="relative flex w-full items-center">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
            aria-label="Go back"
          >
            <ChevronLeftIcon className="size-6 stroke-[2]" />
          </button>
        </header>
        <div className="mt-3 w-full pb-5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-[#ff8133] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {step === "enter" ? (
          <>
            <h1 className="text-[1.5rem] font-bold tracking-tight text-[#020c4e]">
              Update your email
            </h1>
            <p className="mt-2 text-[15px] text-neutral-500">
              We&apos;ll send a one-time code to the new address. Only your email
              will change after verification.
            </p>

            <div className="mt-6">
              <FloatingLabelInput
                id="reverify-email"
                type="email"
                label="Email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError("")
                }}
                autoComplete="email"
                aria-invalid={Boolean(error)}
              />
            </div>
            {error ? (
              <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>
            ) : null}
            <button
              type="button"
              disabled={sending || !looksLikeEmail}
              onClick={() => void sendOtp()}
              className={cn(primaryBtn, "mt-8")}
            >
              {sending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Send code"
              )}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[1.5rem] font-bold tracking-tight text-[#020c4e]">
              Enter the code we sent
            </h1>
            <p className="mt-2 text-[15px] text-neutral-500">
              Sent to{" "}
              <span className="break-all font-medium text-neutral-800">
                {normalized}
              </span>
            </p>
            <div className="mt-6 w-full">
              <InputOTP
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(v) => {
                  setCode(v.replace(/\D/g, "").slice(0, OTP_LENGTH))
                  setError("")
                }}
              >
                <InputOTPGroup className="w-full gap-2 sm:gap-2.5">
                  {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className={otpSlotClass}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {error ? (
              <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>
            ) : null}
            <button
              type="button"
              disabled={verifying || code.replace(/\D/g, "").length !== OTP_LENGTH}
              onClick={() => void verifyOtp()}
              className={cn(primaryBtn, "mt-8")}
            >
              {verifying ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Verify and save"
              )}
            </button>
            <button
              type="button"
              disabled={sending || cooldown > 0}
              onClick={() => void sendOtp()}
              className="mt-3 flex h-11 w-full items-center justify-center text-[14px] font-semibold text-[#020c4e] disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
