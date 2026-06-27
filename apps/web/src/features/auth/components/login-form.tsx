import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { useSignInForm } from "@/features/auth/hooks/use-sign-in-form"

interface LoginFormProps extends React.ComponentProps<"div"> {
  onForgotPassword?: () => void
  onSignUp?: () => void
}

export function LoginForm({
  className,
  onForgotPassword,
  onSignUp,
  ...props
}: LoginFormProps) {
  const { errors, handleChange, handleSubmit, statusMessage, values } =
    useSignInForm()

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col items-start gap-0">
          <h1 className="text-xl font-bold">Welcome</h1>
          <p className="text-sm text-foreground">
            Sign in to connect with your barangay
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
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
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
          />
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : null}
        </Field>
        <Field>
          <Button type="submit" className="w-full">Sign in</Button>
        </Field>
        <p className="mt-4 text-sm text-foreground">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={onSignUp}
            className="font-medium underline underline-offset-2"
          >
            Sign-up
          </button>
        </p>
        {statusMessage ? (
          <FieldDescription className="text-center">
            {statusMessage}
          </FieldDescription>
        ) : null}
      </form>
    </div>
  )
}
