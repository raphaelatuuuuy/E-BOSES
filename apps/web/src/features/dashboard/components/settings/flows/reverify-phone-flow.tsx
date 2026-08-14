"use client"

import { useEffect, useMemo, useState } from "react"
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
  requestAccountPhoneOtp,
  verifyAccountPhoneOtp,
} from "@/features/auth/api"
import { getAccessToken } from "@/lib/api"
import { ApiError } from "@/lib/api"

const OTP_LENGTH = 6

const otpSlotClass =
  "h-14 min-w-0 flex-1 rounded-xl border-2 border-input bg-white text-lg font-medium text-neutral-800 shadow-none data-[active=true]:border-[3px] data-[active=true]:border-primary"

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"

function localFromAny(raw: string) {
  let d = raw.replace(/\D/g, "")
  if (d.startsWith("63")) d = d.slice(2)
  if (d.startsWith("0")) d = d.slice(1)
  return d.slice(0, 10)
}

function e164FromLocal(local: string): string | null {
  const d = local.replace(/\D/g, "")
  if (d.length === 10 && d.startsWith("9")) return `+63${d}`
  return null
}

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`)
  }
  return pts.join(" ")
}

function PhilippinesFlag({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 36 24"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="12" y="0" fill="#0038A8" />
      <rect width="36" height="12" y="12" fill="#CE1126" />
      <path d="M0 0 L18 12 L0 24 Z" fill="#FFFFFF" />
      <circle cx="6.5" cy="12" r="2.15" fill="#FCD116" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 * Math.PI) / 180
        return (
          <line
            key={i}
            x1={6.5 + Math.cos(a) * 2.5}
            y1={12 + Math.sin(a) * 2.5}
            x2={6.5 + Math.cos(a) * 3.7}
            y2={12 + Math.sin(a) * 3.7}
            stroke="#FCD116"
            strokeWidth="0.7"
            strokeLinecap="round"
          />
        )
      })}
      {[
        [3.2, 4.2],
        [3.2, 19.8],
        [12.2, 12],
      ].map(([cx, cy], i) => (
        <polygon key={`star-${i}`} fill="#FCD116" points={starPoints(cx, cy, 1.05, 0.45)} />
      ))}
    </svg>
  )
}

export function ReverifyPhoneFlow({
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
  const [phoneLocal, setPhoneLocal] = useState(() =>
    localFromAny(user?.phone_number || ""),
  )
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const e164 = useMemo(() => e164FromLocal(phoneLocal), [phoneLocal])
  const progress = step === "enter" ? 45 : 90
  const invalid = Boolean(phoneLocal && !e164)

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
    if (!e164) {
      setError("Enter a valid PH mobile number (10 digits starting with 9).")
      return
    }
    if (e164 === (user?.phone_number || "")) {
      setError("That is already your mobile number.")
      return
    }
    setSending(true)
    setError("")
    try {
      await requestAccountPhoneOtp({ phone_number: e164 })
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
    if (!e164 || code.replace(/\D/g, "").length !== OTP_LENGTH) return
    setVerifying(true)
    setError("")
    try {
      const nextUser = await verifyAccountPhoneOtp({
        phone_number: e164,
        code: code.replace(/\D/g, ""),
      })
      const access = getAccessToken()
      if (access) setAuthenticatedUser(nextUser, access)
      else await refreshUser()
      toast.success("Mobile number updated")
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
            Update your mobile number
          </h1>
          <p className="mt-2 text-[15px] text-neutral-500">
            We&apos;ll send a one-time code to verify the new number. Only this
            field will change.
          </p>

          <div className="mt-6 flex items-stretch gap-2.5">
            <div
              className={cn(
                "flex h-[60px] shrink-0 items-center gap-2 rounded-[12px] border-2 bg-white px-3.5",
                invalid ? "border-destructive" : "border-input",
              )}
              aria-label="Philippines country code +63"
            >
              <PhilippinesFlag className="h-5 w-[1.875rem] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
              <span className="text-base font-medium tabular-nums text-neutral-800">
                +63
              </span>
            </div>
            <div className="relative min-w-0 flex-1">
              <input
                id="reverify-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phoneLocal}
                placeholder=""
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setPhoneLocal(localFromAny(e.target.value))
                  setError("")
                }}
                className={cn(
                  "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
                  "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
                  "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
                )}
              />
              <label
                htmlFor="reverify-phone"
                className={cn(
                  "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
                  "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
                  phoneLocal
                    ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]"
                    : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5 peer-focus-visible:top-2.5 peer-focus-visible:translate-y-0 peer-focus-visible:text-[11px] peer-focus-visible:font-medium peer-focus-visible:leading-[14px]",
                  invalid && "text-destructive",
                )}
              >
                Mobile number
              </label>
            </div>
          </div>
          {error ? (
            <p className="mt-2 text-[13px] font-medium text-sos">{error}</p>
          ) : null}
          <button
            type="button"
            disabled={sending || !e164}
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
            Sent to <span className="font-medium text-neutral-800">{e164}</span>
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
            className="mt-3 flex h-11 w-full items-center justify-center text-[14px] font-semibold text-foreground hover:text-foreground/90 disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </>
      )}
    </>
  )
}