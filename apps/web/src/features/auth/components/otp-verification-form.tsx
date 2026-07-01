import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
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
  "border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.15)] data-[active=true]:border-destructive data-[active=true]:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"

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
  const { errors, handleChange, handleSubmit, statusMessage, values } = useOtpForm({ onSuccess })

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col items-start gap-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-foreground">{description}</p>
        </div>
        <div className="h-1" />
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="otp-code">Verification code</FieldLabel>
            <button
              type="button"
              onClick={onResend}
              disabled={resendDisabled}
              className="shrink-0 text-sm font-medium text-foreground underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
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
          <Button type="submit" className="w-full">
            {actionLabel}
          </Button>
        </Field>
        {statusMessage ? (
          <FieldDescription className="text-center">
            {statusMessage}
          </FieldDescription>
        ) : null}
        {onBack ? (
          <p className="mt-4 text-sm text-foreground">
            Wrong email?{" "}
            <button
              type="button"
              onClick={onBack}
              className="font-medium underline underline-offset-2"
            >
              Go back
            </button>
          </p>
        ) : null}
      </form>
    </div>
  )
}
