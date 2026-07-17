import * as React from "react"
import { LoaderCircle, RotateCw } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { FieldError } from "@workspace/ui/components/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { cn } from "@workspace/ui/lib/utils"

import type { SignUpErrors } from "@/features/auth/schemas/sign-up-schema"

interface EmailOtpStepProps {
  email: string
  code: string
  errors: SignUpErrors
  isSending: boolean
  isVerifying: boolean
  cooldownSeconds: number
  onCodeChange: (code: string) => void
  onResend: () => void
  onEditEmail: () => void
  onSubmit: () => void
}

const OTP_LENGTH = 6

const errorSlotClassName =
  "border-[3px] border-destructive data-[active=true]:border-[3px] data-[active=true]:border-destructive"

const slotClassName =
  "h-14 min-w-0 flex-1 rounded-xl border border-[#c5cdd8] bg-white text-lg font-medium text-[#0f172a] shadow-none data-[active=true]:border-[3px] data-[active=true]:border-[#ff8133]"

export function EmailOtpStep({
  email,
  code,
  errors,
  isSending,
  isVerifying,
  cooldownSeconds,
  onCodeChange,
  onResend,
  onEditEmail,
  onSubmit,
}: EmailOtpStepProps) {
  const otpContainerRef = React.useRef<HTMLDivElement>(null)
  const cooldownActive = cooldownSeconds > 0
  const busy = isSending || isVerifying
  const codeComplete = code.replace(/\D/g, "").length === OTP_LENGTH
  const displayEmail = email.trim() || "your email"

  // Focus the OTP input as soon as this step mounts so the user can type immediately.
  React.useEffect(() => {
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
      // Second pass after layout settles (progress bar / header).
      window.setTimeout(focusOtp, 50)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="flex flex-1 flex-col pt-2">
      <h1 className="text-[1.5rem] font-semibold leading-snug tracking-tight text-[#0f172a] md:text-[1.75rem]">
        Sent to {displayEmail}! Enter the code you will receive shortly.
      </h1>

      <div className="mt-8" ref={otpContainerRef}>
        <InputOTP
          maxLength={OTP_LENGTH}
          value={code}
          onChange={(next) => onCodeChange(next.replace(/\D/g, "").slice(0, OTP_LENGTH))}
          disabled={busy}
          autoFocus
          aria-invalid={Boolean(errors.emailOtpCode)}
          aria-label="Email verification code"
          containerClassName="w-full"
        >
          <InputOTPGroup className="gap-2.5 sm:gap-3">
            {Array.from({ length: OTP_LENGTH }).map((_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className={cn(
                  slotClassName,
                  errors.emailOtpCode ? errorSlotClassName : undefined,
                )}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {errors.emailOtpCode ? (
          <FieldError className="mt-2">{errors.emailOtpCode}</FieldError>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy || cooldownActive}
        onClick={onResend}
        className="mt-5 inline-flex items-center gap-2 self-start text-sm font-medium text-neutral-800 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCw
          className={cn("size-4 shrink-0", isSending && "animate-spin")}
          aria-hidden="true"
        />
        {cooldownActive ? `Resend code (${cooldownSeconds}s)` : "Resend code"}
      </button>

      <div className="mt-10 flex items-center justify-end gap-5">
        <button
          type="button"
          onClick={onEditEmail}
          disabled={busy}
          className="inline-flex items-center text-base font-semibold text-neutral-900 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          Edit your email
        </button>
        <Button
          type="button"
          disabled={busy || !codeComplete}
          onClick={onSubmit}
          className="h-11 min-w-[7.5rem] rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-none hover:bg-[#e6732e] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isVerifying ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            "Submit"
          )}
        </Button>
      </div>
    </div>
  )
}
