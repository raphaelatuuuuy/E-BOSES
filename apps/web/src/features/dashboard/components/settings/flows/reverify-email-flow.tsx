"use client"

import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkEmailAvailability,
  requestAccountEmailOtp,
  verifyAccountEmailOtp,
} from "@/features/auth/api"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { getAccessToken } from "@/lib/api"
import { ApiError } from "@/lib/api"

const OTP_LENGTH = 6

const otpSlotClass =
  "h-14 min-w-0 flex-1 rounded-xl border-2 border-input bg-white text-lg font-medium text-neutral-800 shadow-none data-[active=true]:border-[3px] data-[active=true]:border-primary"

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"

export function ReverifyEmailFlow({
  registerBack,
  onDone,
  onExit,
}: {
  registerBack: (fn: () => void) => void
  onDone: () => void
  onExit: () => void
}) {
  const { user, setAuthenticatedUser, refreshUser } = useAuthSession()

  const [step, setStep] = useState<"enter" | "otp">("enter")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const normalized = email.trim().toLowerCase()
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  const progress = step === "enter" ? 45 : 90

  function goBack() {
    if (step === "otp") {
      setStep("enter")
      setCode("")
      setError("")
      return
    }
    onExit()
  }

  useEffect(() => {
    registerBack(goBack)
  })

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

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
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid code. Try again.")
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <div className="w-full pb-5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {step === "enter" ? (
        <>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-foreground">
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
            <p className="mt-2 text-[13px] font-medium text-sos">{error}</p>
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
          <h1 className="text-[1.5rem] font-bold tracking-tight text-foreground">
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
            <p className="mt-2 text-[13px] font-medium text-sos">{error}</p>
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
            className="mt-3 flex h-11 w-full items-center justify-center text-[14px] font-semibold text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </>
      )}
    </>
  )
}