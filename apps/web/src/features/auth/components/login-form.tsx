import * as React from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
} from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { SILENT_SIGN_IN_ERROR, useSignInForm } from "@/features/auth/hooks/use-sign-in-form"
import type { AuthUser } from "@/features/auth/api"

/**
 * The field already shows a fixed `+63`, so it holds the ten digits that follow
 * it. Pasting a full `+639…`, `639…` or `09…` number drops the part the prefix
 * already covers instead of being truncated into nonsense.
 */
function toLocalMobileDigits(value: string) {
  let digits = value.replace(/\D/g, "")
  if (digits.startsWith("63")) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  return digits.slice(0, 10)
}

interface LoginFormProps extends React.ComponentProps<"div"> {
  onForgotPassword?: () => void
  onSignUp?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export function LoginForm({
  className,
  onForgotPassword,
  onSignUp,
  onSuccess,
  ...props
}: LoginFormProps) {
  const { errors, handleChange, handleSubmit, isSubmitting, setMode, submitError, values } =
    useSignInForm({ onSuccess })
  const [showPassword, setShowPassword] = React.useState(false)
  const isPhone = values.mode === "phone"

  return (
    <div className={cn("w-full", className)} {...props}>
      <form className="flex w-full flex-col gap-2" noValidate onSubmit={handleSubmit}>
        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="identifier"
              name="identifier"
              type={isPhone ? "tel" : "email"}
              inputMode={isPhone ? "tel" : "email"}
              autoComplete={isPhone ? "tel" : "email"}
              label={isPhone ? "Phone number" : "Email address"}
              prefix={isPhone ? "+63" : undefined}
              value={values.identifier}
              maxLength={isPhone ? 10 : undefined}
              onChange={(event) => {
                handleChange(
                  "identifier",
                  isPhone ? toLocalMobileDigits(event.target.value) : event.target.value,
                )
              }}
              aria-invalid={Boolean(errors.identifier)}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setMode(isPhone ? "email" : "phone")}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-xs font-medium text-foreground"
              aria-label={isPhone ? "Sign in with email" : "Sign in with phone number"}
              tabIndex={-1}
            >
              {isPhone ? "Email" : "Phone"}
            </button>
          </div>
          {errors.identifier && errors.identifier !== SILENT_SIGN_IN_ERROR ? (
            <FieldError>{errors.identifier}</FieldError>
          ) : null}
        </Field>

        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              label="Password"
              value={values.password}
              onChange={(event) => handleChange("password", event.target.value)}
              aria-invalid={Boolean(errors.password)}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((open) => !open)}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-xs font-medium text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {errors.password ? <FieldError>{errors.password}</FieldError> : null}
        </Field>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 h-12 w-full rounded-full text-base font-semibold shadow-none"
        >
          {isSubmitting ? (
            <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            "Sign in"
          )}
        </Button>

        {submitError ? (
          <FieldError className="justify-center text-center">{submitError}</FieldError>
        ) : null}

        <div className="mt-3 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onSignUp}
          className="mt-3 h-12 w-full rounded-full border-foreground bg-white text-base font-semibold text-foreground transition-colors hover:bg-foreground hover:text-white"
        >
          Create an account
        </Button>

        <p className="mt-4 text-center">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-sm font-semibold text-foreground transition-all hover:text-primary"
          >
            Forgot your password?
          </button>
        </p>
      </form>
    </div>
  )
}
