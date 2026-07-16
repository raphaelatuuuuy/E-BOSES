import { FieldError } from "@workspace/ui/components/field"

import { BirthDatePicker } from "@/features/auth/components/sign-up-steps/birth-date-picker"
import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

interface DobStepProps {
  values: SignUpValues
  errors: SignUpErrors
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onContinue: () => void
}

export function DobStep({ values, errors, onChange, onContinue }: DobStepProps) {
  const firstName =
    values.firstName.trim().split(/\s+/).filter(Boolean)[0] || "neighbor"

  return (
    <div className="flex flex-1 flex-col pt-2 pb-8">
      <StepTitle>Okay, {firstName}. When were you born?</StepTitle>

      <div className="mt-8">
        <BirthDatePicker
          value={values.dateOfBirth}
          onChange={(iso) => onChange("dateOfBirth", iso)}
          invalid={Boolean(errors.dateOfBirth)}
        />
        {errors.dateOfBirth ? (
          <FieldError className="mt-2">{errors.dateOfBirth}</FieldError>
        ) : null}
      </div>

      <StepContinueButton onClick={onContinue}>Continue</StepContinueButton>
    </div>
  )
}
