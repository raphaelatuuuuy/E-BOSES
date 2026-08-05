import * as React from "react"
import { LoaderCircle, LoaderCircleIcon, RotateCw, ShieldCheckIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
} from "@workspace/ui/components/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { cn } from "@workspace/ui/lib/utils"

import { StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

interface PhoneStepProps {
  values: SignUpValues
  errors: SignUpErrors
  phoneOtpSent: boolean
  phoneOtpVerified: boolean
  phoneOtpCooldownSeconds: number
  isSendingPhoneOtp: boolean
  isVerifyingPhoneOtp: boolean
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onSendOtp: () => void
  onVerifyOtp: () => void
  onEditPhone: () => void
  onContinue: () => void
}

const OTP_LENGTH = 6
/** Matches OTP_EXPIRY_MINUTES in apps/api/apps/accounts/services.py. */
const OTP_EXPIRY_SECONDS = 5 * 60

const primaryBtnClass =
  "inline-flex h-12 min-w-[10rem] items-center justify-center gap-2 rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-none transition-[transform,colors,filter] duration-150 ease-out hover:bg-[#e6732e] active:scale-[0.96] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"

const errorSlotClassName =
  "border-[3px] border-destructive data-[active=true]:border-[3px] data-[active=true]:border-destructive"

const slotClassName =
  "h-14 min-w-0 flex-1 rounded-xl border border-[#c5cdd8] bg-white text-lg font-medium text-[#0f172a] shadow-none data-[active=true]:border-[3px] data-[active=true]:border-[#ff8133]"

/** Simple 5-point star for the PH flag SVG. */
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

/** PH mobile E.164: +639XXXXXXXXX */
function isValidPhMobileE164(value: string) {
  return /^\+639\d{9}$/.test(value)
}

function toLocalPhMobile(e164: string): string {
  const digits = (e164 || "").replace(/\D/g, "")
  if (digits.startsWith("63") && digits.length > 2) return digits.slice(2, 12)
  if (digits.startsWith("0") && digits.length > 1) return digits.slice(1, 11)
  return digits.slice(0, 10)
}

function toE164PhMobile(raw: string): string {
  let digits = raw.replace(/\D/g, "")
  if (digits.startsWith("63") && digits.length > 2) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  digits = digits.slice(0, 10)
  return digits ? `+63${digits}` : ""
}

/** `+63 9•• ••• 4821` — enough to recognise, not enough to read over a shoulder. */
function maskDisplayPhone(e164: string): string {
  const local = toLocalPhMobile(e164)
  if (local.length < 4) return "your number"
  return `+63 9•• ••• ${local.slice(-4)}`
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

export function PhoneStep({
  values,
  errors,
  phoneOtpSent,
  phoneOtpVerified,
  phoneOtpCooldownSeconds,
  isSendingPhoneOtp,
  isVerifyingPhoneOtp,
  onChange,
  onSendOtp,
  onVerifyOtp,
  onEditPhone,
  onContinue,
}: PhoneStepProps) {
  const [focused, setFocused] = React.useState(false)
  const otpContainerRef = React.useRef<HTMLDivElement>(null)
  const localPhone = toLocalPhMobile(values.phoneNumber)
  const phoneValid = isValidPhMobileE164(values.phoneNumber)
  const busy = isSendingPhoneOtp || isVerifyingPhoneOtp
  const onCooldown = phoneOtpCooldownSeconds > 0
  const phoneCodeComplete =
    (values.phoneOtpCode ?? "").replace(/\D/g, "").length === OTP_LENGTH
  const hasLocalValue = localPhone.length > 0
  const isFloating = focused || hasLocalValue
  const invalid = Boolean(errors.phoneNumber)
  const sendDisabled = busy || !phoneValid || onCooldown || phoneOtpVerified

  // Server expiry is 5 minutes; the countdown starts when the code is sent.
  const [secondsLeft, setSecondsLeft] = React.useState(OTP_EXPIRY_SECONDS)
  React.useEffect(() => {
    if (!phoneOtpSent || phoneOtpVerified) return
    setSecondsLeft(OTP_EXPIRY_SECONDS)
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current <= 0 ? 0 : current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [phoneOtpSent, phoneOtpVerified, phoneOtpCooldownSeconds])
  const codeExpired = secondsLeft <= 0

  // After a successful verify, move on automatically.
  React.useEffect(() => {
    if (phoneOtpVerified) onContinue()
  }, [phoneOtpVerified, onContinue])

  // Focus OTP when the confirmation view opens.
  React.useEffect(() => {
    if (!phoneOtpSent || phoneOtpVerified) return
    const focusOtp = () => {
      const root = otpContainerRef.current
      if (!root) return
      const input =
        root.querySelector<HTMLInputElement>("input[data-input-otp]") ??
        root.querySelector<HTMLInputElement>("input")
      input?.focus({ preventScroll: true })
    }
    const frame = window.requestAnimationFrame(() => {
      focusOtp()
      window.setTimeout(focusOtp, 50)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [phoneOtpSent, phoneOtpVerified])

  // ── OTP confirmation UI (same style as email OTP) ─────────────────────────
  if (phoneOtpSent && !phoneOtpVerified) {
    return (
      <div className="flex flex-1 flex-col pt-2">
        <h1 className="text-[1.5rem] font-semibold leading-snug tracking-tight text-[#0f172a] md:text-[1.75rem]">
          Phone number verification
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          We sent a six-digit registration code to{" "}
          <span className="font-semibold tabular-nums text-neutral-900">
            {maskDisplayPhone(values.phoneNumber)}
          </span>
        </p>

        <div className="mt-8" ref={otpContainerRef}>
          <InputOTP
            maxLength={OTP_LENGTH}
            value={values.phoneOtpCode ?? ""}
            onChange={(next) =>
              onChange("phoneOtpCode", next.replace(/\D/g, "").slice(0, OTP_LENGTH))
            }
            disabled={busy}
            autoFocus
            aria-invalid={Boolean(errors.phoneOtpCode)}
            aria-label="Phone verification code"
            containerClassName="w-full"
          >
            <InputOTPGroup className="gap-2.5 sm:gap-3">
              {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className={cn(
                    slotClassName,
                    errors.phoneOtpCode ? errorSlotClassName : undefined,
                  )}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {errors.phoneOtpCode ? (
            <FieldError className="mt-2">{errors.phoneOtpCode}</FieldError>
          ) : null}
        </div>

        <p className="mt-3 text-sm text-neutral-600" aria-live="polite">
          {codeExpired ? (
            <span className="font-medium text-destructive">
              Code expired. Request a new one.
            </span>
          ) : (
            <>Code expires in <span className="tabular-nums">{formatCountdown(secondsLeft)}</span></>
          )}
        </p>

        <p className="mt-1 text-sm text-neutral-500" aria-live="polite">
          {isSendingPhoneOtp
            ? "Sending code…"
            : isVerifyingPhoneOtp
              ? "Checking your code…"
              : "Didn't receive the code?"}
        </p>

        <button
          type="button"
          disabled={busy || onCooldown}
          onClick={onSendOtp}
          className="mt-2 inline-flex items-center gap-2 self-start text-sm font-medium text-neutral-800 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCw
            className={cn("size-4 shrink-0", isSendingPhoneOtp && "animate-spin")}
            aria-hidden="true"
          />
          {onCooldown
            ? `Resend available in ${phoneOtpCooldownSeconds} seconds`
            : "Resend code"}
        </button>

        <div className="mt-10 flex items-center justify-end gap-5">
          <button
            type="button"
            onClick={onEditPhone}
            disabled={busy}
            className="inline-flex items-center text-base font-semibold text-neutral-900 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            Edit phone number
          </button>
          <Button
            type="button"
            disabled={busy || !phoneCodeComplete || codeExpired}
            onClick={onVerifyOtp}
            className="h-11 min-w-[7.5rem] rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-none hover:bg-[#e6732e] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isVerifyingPhoneOtp ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              "Verify code"
            )}
          </Button>
        </div>
      </div>
    )
  }

  // ── Phone entry UI ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>Let&apos;s try texting you a confirmation code.</StepTitle>

      <div className="mt-8 space-y-4">
        <Field>
          <div className="flex items-stretch gap-2.5">
            <div
              className={cn(
                "flex h-[60px] shrink-0 items-center gap-2 rounded-[12px] border-2 bg-white px-3.5",
                invalid ? "border-destructive" : "border-input",
              )}
              aria-label="Philippines country code +63"
            >
              <PhilippinesFlag className="h-5 w-[1.875rem] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
              <span className="text-base font-medium tabular-nums text-neutral-800">+63</span>
            </div>

            <div className="relative min-w-0 flex-1">
              <input
                id="phoneNumber"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={localPhone}
                placeholder=""
                aria-invalid={invalid}
                aria-required
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => onChange("phoneNumber", toE164PhMobile(e.target.value))}
                className={cn(
                  "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
                  "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
                  "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
                  "shadow-none focus-visible:shadow-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
              <label
                htmlFor="phoneNumber"
                className={cn(
                  "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
                  "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
                  isFloating
                    ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]"
                    : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5",
                  invalid && "text-destructive",
                )}
              >
                Mobile number
              </label>
            </div>
          </div>
          {errors.phoneNumber ? <FieldError>{errors.phoneNumber}</FieldError> : null}
        </Field>

        <p className="flex items-start gap-2 text-sm leading-snug text-neutral-500">
          <ShieldCheckIcon
            className="mt-0.5 size-4 shrink-0 text-neutral-400"
            strokeWidth={2}
          />
          <span>
            Used for account security and emergency alerts so responders can reach you when it
            matters. Your number must be verified before you can finish sign-up. It will not be
            shown publicly to other residents.
          </span>
        </p>
      </div>

      <div className="mt-8 flex w-full justify-end">
        <button
          type="button"
          onClick={onSendOtp}
          disabled={sendDisabled}
          className={cn(primaryBtnClass, "w-full sm:w-auto")}
        >
          {isSendingPhoneOtp ? (
            <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            "Send Code"
          )}
        </button>
      </div>
    </div>
  )
}
