import * as React from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
} from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { PasswordRequirementsList } from "@/features/auth/components/password-requirements-list"
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
  const { errors, handleChange, handleSubmit, isSubmitting, passwordStrength, submitError, values } =
    useNewPasswordForm({ onSuccess })
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [passwordFocused, setPasswordFocused] = React.useState(false)

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex w-full flex-col gap-2" noValidate onSubmit={handleSubmit}>
        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="password"
              type={showPassword ? "text" : "password"}
              label="New password"
              value={values.password}
              onChange={(event) => handleChange("password", event.target.value)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              aria-invalid={Boolean(errors.password)}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((open) => !open)}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-xs font-medium text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {passwordFocused && values.password.length > 0 ? (
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: passwordStrength.max }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 rounded-full bg-muted transition-colors",
                    i < passwordStrength.score &&
                      (passwordStrength.score <= 2
                        ? "bg-destructive"
                        : passwordStrength.score <= 4
                          ? "bg-neutral-1000"
                          : "bg-primary"),
                  )}
                />
              ))}
            </div>
          ) : null}
          {passwordFocused ? (
            <PasswordRequirementsList password={values.password} />
          ) : null}
          {errors.password ? <FieldError>{errors.password}</FieldError> : null}
        </Field>
        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              label="Confirm password"
              value={values.confirmPassword}
              onChange={(event) =>
                handleChange("confirmPassword", event.target.value)
              }
              aria-invalid={Boolean(errors.confirmPassword)}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((open) => !open)}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-xs font-medium text-foreground"
              aria-label={showConfirm ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showConfirm ? "Hide" : "Show"}
            </button>
          </div>
          {errors.confirmPassword ? (
            <FieldError>{errors.confirmPassword}</FieldError>
          ) : null}
        </Field>
        <Button type="submit" className="mt-2 h-12 w-full rounded-full text-base font-semibold shadow-none" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            "Reset password"
          )}
        </Button>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <button
            type="button"
            onClick={onBack}
            className="font-semibold text-foreground transition-all hover:text-primary"
          >
            Remember your password?
          </button>
        </p>
      </form>
    </div>
  )
}
