import { Field, FieldError } from "@workspace/ui/components/field"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

function sanitizeName(value: string) {
  return value.replace(/[^A-Za-zÑñ ]/g, "")
}

interface NameStepProps {
  values: SignUpValues
  errors: SignUpErrors
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onContinue: () => void
}

export function NameStep({ values, errors, onChange, onContinue }: NameStepProps) {
  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>Hi, neighbor! What&apos;s your name?</StepTitle>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FloatingLabelInput
            id="firstName"
            type="text"
            autoComplete="given-name"
            label="First name"
            value={values.firstName}
            onChange={(e) => onChange("firstName", sanitizeName(e.target.value))}
            aria-invalid={Boolean(errors.firstName)}
            required
          />
          {errors.firstName ? <FieldError>{errors.firstName}</FieldError> : null}
        </Field>
        <Field>
          <FloatingLabelInput
            id="lastName"
            type="text"
            autoComplete="family-name"
            label="Last name"
            value={values.lastName}
            onChange={(e) => onChange("lastName", sanitizeName(e.target.value))}
            aria-invalid={Boolean(errors.lastName)}
            required
          />
          {errors.lastName ? <FieldError>{errors.lastName}</FieldError> : null}
        </Field>
      </div>

      <StepContinueButton onClick={onContinue}>Continue</StepContinueButton>
    </div>
  )
}
