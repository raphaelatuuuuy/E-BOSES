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
            className="h-14 w-full rounded-[16px] bg-white px-4 text-lg font-semibold placeholder:text-sm placeholder:font-normal focus-visible:border focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)] aria-invalid:border aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"
          />
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </Field>
        <Field>
          <Button type="submit" className="h-14 w-full rounded-full text-base font-semibold" disabled={isSubmitting}>
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
