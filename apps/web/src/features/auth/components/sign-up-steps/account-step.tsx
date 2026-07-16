import * as React from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
} from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { PasswordRequirementsList } from "@/features/auth/components/password-requirements-list"
import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

interface AccountStepProps {
  values: SignUpValues
  errors: SignUpErrors
  passwordStrength: { score: number; max: number }
  isCheckingEmail?: boolean
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onEmailBlur?: () => void
  onContinue: () => void
  onOpenTerms: () => void
  onOpenPrivacy: () => void
  onRequestAgree: () => void
  isContinuing?: boolean
}

export function AccountStep({
  values,
  errors,
  passwordStrength,
  isCheckingEmail = false,
  onChange,
  onEmailBlur,
  onContinue,
  onOpenTerms,
  onOpenPrivacy,
  onRequestAgree,
  isContinuing = false,
}: AccountStepProps) {
  const [showPassword, setShowPassword] = React.useState(false)
  const [passwordFocused, setPasswordFocused] = React.useState(false)

  return (
    <div className="flex flex-1 flex-col justify-center">
      <StepTitle className="text-center">Create an account to join your neighborhood.</StepTitle>

      <div className="mt-8 flex flex-col gap-3">
        <Field>
          <FloatingLabelInput
            id="email"
            type="email"
            autoComplete="email"
            label="Email address"
            value={values.email}
            onChange={(e) => onChange("email", e.target.value)}
            onBlur={() => onEmailBlur?.()}
            aria-invalid={Boolean(errors.email)}
            required
          />
          {isCheckingEmail ? (
            <FieldDescription className="flex items-center gap-1.5">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Checking email…
            </FieldDescription>
          ) : null}
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </Field>

        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              label="Create a password"
              value={values.password}
              onChange={(e) => onChange("password", e.target.value)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              aria-invalid={Boolean(errors.password)}
              required
              className="pr-14"
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
            <div className="mt-2 grid grid-cols-5 gap-1">
              {Array.from({ length: passwordStrength.max }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 rounded-full bg-muted transition-colors",
                    i < passwordStrength.score &&
                      (passwordStrength.score <= 2
                        ? "bg-destructive"
                        : passwordStrength.score <= 4
                          ? "bg-amber-500"
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
      </div>

      <div className="mt-6 space-y-2">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox
            checked={values.agreeToTerms}
            onChange={() => {
              if (values.agreeToTerms) {
                onChange("agreeToTerms", false)
              } else {
                // User must open and accept Privacy/Terms via the dialog flow.
                onRequestAgree()
              }
            }}
            className={cn(
              "mt-0.5 size-[1.125rem] rounded-[5px] border-2 shadow-none",
              "aria-invalid:border-[3px] aria-invalid:border-destructive aria-invalid:shadow-none",
              "focus-visible:ring-0 focus-visible:shadow-none",
            )}
            aria-invalid={Boolean(errors.agreeToTerms)}
          />
          <span
            className={cn(
              "leading-relaxed text-muted-foreground",
              errors.agreeToTerms && "font-medium text-destructive",
            )}
          >
            By continuing with sign up, you agree to our{" "}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenPrivacy()
              }}
              className={cn(
                "font-semibold underline-offset-2 hover:underline",
                errors.agreeToTerms ? "text-destructive" : "text-[#ff8133]",
              )}
            >
              Privacy Policy
            </button>
            , and{" "}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenTerms()
              }}
              className={cn(
                "font-semibold underline-offset-2 hover:underline",
                errors.agreeToTerms ? "text-destructive" : "text-[#ff8133]",
              )}
            >
              Terms of Service
            </button>
            .
          </span>
        </label>
      </div>

      <StepContinueButton
        fullWidth
        onClick={onContinue}
        disabled={isCheckingEmail || isContinuing}
        loading={isCheckingEmail || isContinuing}
      >
        Continue
      </StepContinueButton>
    </div>
  )
}

export function AccountStepLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
