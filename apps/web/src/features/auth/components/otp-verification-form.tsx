import { LoaderCircleIcon } from "lucide-react"

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
import { cn } from "@workspace/ui/lib/utils"

import { useOtpForm } from "@/features/auth/hooks/use-otp-form"

interface OtpVerificationFormProps extends React.ComponentProps<"div"> {
  title: string
  description: string
  actionLabel: string
  onBack?: () => void
  onResend?: () => void
  resendDisabled?: boolean
  resendLabel?: string
  onSuccess?: (code: string) => void
}

const errorSlotClassName =
  "border-destructive border-[3px] data-[active=true]:border-destructive data-[active=true]:border-[3px]"

export function OtpVerificationForm({
  className,
  title,
  description,
  actionLabel,
  onBack,
  onResend,
  resendDisabled = false,
  resendLabel = "Resend",
  onSuccess,
  ...props
}: OtpVerificationFormProps) {
  const { errors, handleChange, handleSubmit, isSubmitting, submitError, values } = useOtpForm({ onSuccess })
  const codeComplete = values.code.replace(/\D/g, "").length === 6

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-3" noValidate onSubmit={handleSubmit}>
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="otp-code">Verification code</FieldLabel>
            <button
              type="button"
              onClick={onResend}
              disabled={resendDisabled}
              className="shrink-0 text-sm font-semibold text-foreground underline underline-offset-2 decoration-1 transition-all hover:text-primary hover:decoration-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
            >
              {resendLabel}
            </button>
          </div>
          <InputOTP
            id="otp-code"
            maxLength={6}
            value={values.code}
            onChange={handleChange}
            aria-invalid={Boolean(errors.code)}
            containerClassName="w-full"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} className={errors.code ? errorSlotClassName : undefined} />
              <InputOTPSlot index={1} className={errors.code ? errorSlotClassName : undefined} />
              <InputOTPSlot index={2} className={errors.code ? errorSlotClassName : undefined} />
              <InputOTPSlot index={3} className={errors.code ? errorSlotClassName : undefined} />
              <InputOTPSlot index={4} className={errors.code ? errorSlotClassName : undefined} />
              <InputOTPSlot index={5} className={errors.code ? errorSlotClassName : undefined} />
            </InputOTPGroup>
          </InputOTP>
          {errors.code ? <FieldError>{errors.code}</FieldError> : null}
        </Field>
        <Field>
          <Button
            type="submit"
            className="h-12 w-full rounded-full text-base font-semibold shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting || !codeComplete}
          >
            {isSubmitting ? (
              <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              actionLabel
            )}
          </Button>
        </Field>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
        {onBack ? (
          <p className="mt-4 text-sm text-foreground text-center">
            Wrong email?{" "}
            <button
              type="button"
              onClick={onBack}
              className="font-semibold text-foreground underline underline-offset-2 decoration-1 transition-all hover:text-primary hover:decoration-2"
            >
              Go back
            </button>
          </p>
        ) : null}
      </form>
    </div>
  )
}
