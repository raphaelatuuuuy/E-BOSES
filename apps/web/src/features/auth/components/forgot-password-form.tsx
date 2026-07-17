import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
} from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { useForgotPasswordForm } from "@/features/auth/hooks/use-forgot-password-form"

interface ForgotPasswordFormProps extends React.ComponentProps<"div"> {
  onBack?: () => void
  onSuccess?: (email: string) => void
}

export function ForgotPasswordForm({
  className,
  onBack,
  onSuccess,
  ...props
}: ForgotPasswordFormProps) {
  const { errors, handleChange, handleSubmit, isSubmitting, submitError, values } =
    useForgotPasswordForm({ onSuccess })

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex w-full flex-col gap-2" noValidate onSubmit={handleSubmit}>
        <Field>
          <FloatingLabelInput
            id="email"
            type="email"
            label="Email address"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            required
          />
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </Field>
        <Button type="submit" className="mt-2 h-12 w-full rounded-full text-base font-semibold shadow-none" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            "Send reset email"
          )}
        </Button>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <button
            type="button"
            onClick={onBack}
            className="font-semibold text-foreground underline underline-offset-2 decoration-1 transition-all hover:text-primary hover:decoration-2"
          >
            Sign in
          </button>
        </p>
      </form>
    </div>
  )
}
