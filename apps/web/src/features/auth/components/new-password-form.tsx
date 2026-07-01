import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { useNewPasswordForm } from "@/features/auth/hooks/use-new-password-form"

interface NewPasswordFormProps extends React.ComponentProps<"div"> {
  onBack?: () => void
  onSuccess?: (password: string) => void
}

export function NewPasswordForm({
  className,
  onBack,
  onSuccess,
  ...props
}: NewPasswordFormProps) {
  const { errors, handleChange, handleSubmit, statusMessage, values } =
    useNewPasswordForm({ onSuccess })

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col items-start gap-0">
          <h1 className="text-2xl font-bold">Create new password</h1>
          <p className="text-sm text-foreground">
            Enter your new password below
          </p>
        </div>
        <div className="h-1" />
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            type="password"
            value={values.password}
            onChange={(event) => handleChange("password", event.target.value)}
            aria-invalid={Boolean(errors.password)}
            placeholder="Enter your new password"
            required
          />
          {errors.password ? <FieldError>{errors.password}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <Input
            id="confirmPassword"
            type="password"
            value={values.confirmPassword}
            onChange={(event) =>
              handleChange("confirmPassword", event.target.value)
            }
            aria-invalid={Boolean(errors.confirmPassword)}
            placeholder="Confirm your new password"
            required
          />
          {errors.confirmPassword ? (
            <FieldError>{errors.confirmPassword}</FieldError>
          ) : null}
        </Field>
        <Field>
          <Button type="submit" className="w-full">
            Reset password
          </Button>
        </Field>
        {statusMessage ? (
          <FieldDescription className="text-center">
            {statusMessage}
          </FieldDescription>
        ) : null}
        <p className="mt-4 text-sm text-foreground">
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
