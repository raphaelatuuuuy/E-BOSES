import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

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

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
        <Field>
          <FieldLabel htmlFor="email" className="text-sm font-medium">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            placeholder="Enter your email"
            required
            className="h-14 w-full rounded-[16px] bg-white px-4 text-lg font-semibold placeholder:text-sm placeholder:font-normal focus-visible:border focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)] aria-invalid:border aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"
          />
          {errors.email && errors.email !== SILENT_SIGN_IN_ERROR ? (
            <FieldError>{errors.email}</FieldError>
          ) : null}
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password" className="text-sm font-medium">Password</FieldLabel>
            <button
              type="button"
              onClick={onForgotPassword}
              className="ml-auto text-sm text-foreground underline underline-offset-2"
            >
              Forgot your password?
            </button>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={values.password}
            onChange={(event) =>
              handleChange("password", event.target.value)
            }
            aria-invalid={Boolean(errors.password)}
            required
            className="h-14 w-full rounded-[16px] bg-white px-4 text-lg font-semibold placeholder:text-sm placeholder:font-normal focus-visible:border focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)] aria-invalid:border aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"
          />
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : null}
        </Field>
        <Field>
          <Button type="submit" className="h-14 w-full rounded-full text-base font-semibold" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircleIcon className="size-5 animate-spin" /> : null}
            {isSubmitting ? "Signing in" : "Sign in"}
          </Button>
        </Field>
        <p className="text-sm text-foreground text-center">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={onSignUp}
            className="font-medium underline underline-offset-2"
          >
            Sign-up
          </button>
        </p>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
      </form>
    </div>
  )
}
