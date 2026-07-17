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
  const { errors, handleChange, handleSubmit, isSubmitting, submitError, values } =
    useSignInForm({ onSuccess })
  const [showPassword, setShowPassword] = React.useState(false)

  return (
    <div className={cn("w-full", className)} {...props}>
      <form className="flex w-full flex-col gap-2" noValidate onSubmit={handleSubmit}>
        <Field>
          <FloatingLabelInput
            id="email"
            type="email"
            autoComplete="email"
            label="Email or phone number"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            required
          />
          {errors.email && errors.email !== SILENT_SIGN_IN_ERROR ? (
            <FieldError>{errors.email}</FieldError>
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

        <div className="flex justify-start mt-1.5">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-xs font-medium text-foreground underline underline-offset-2 decoration-1 transition-all hover:text-primary hover:decoration-2"
          >
            Forgot my password
          </button>
        </div>

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

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={onSignUp}
            className="font-semibold text-foreground underline underline-offset-2 decoration-1 transition-all hover:text-primary hover:decoration-2"
          >
            Sign up
          </button>
        </p>
      </form>
    </div>
  )
}
