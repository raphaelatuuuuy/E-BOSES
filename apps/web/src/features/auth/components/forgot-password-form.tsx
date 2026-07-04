import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

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
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col items-start gap-0">
          <h1 className="text-2xl font-bold">Forgot password</h1>
          <p className="text-sm text-foreground">
            Enter your email and we&apos;ll send you a reset code
          </p>
        </div>
        <div className="h-1" />
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            placeholder="Enter your email"
            required
          />
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </Field>
        <Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {isSubmitting ? "Sending code" : "Send code"}
          </Button>
        </Field>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
        <p className="mt-4 text-sm text-foreground text-center">
          Remember your password?{" "}
          <button
            type="button"
            onClick={onBack}
            className="font-medium underline underline-offset-2"
          >
            Sign in
          </button>
        </p>
      </form>
    </div>
  )
}
