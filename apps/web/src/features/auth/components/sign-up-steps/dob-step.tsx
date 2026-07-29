import { lazy, Suspense } from "react"

import { FieldError } from "@workspace/ui/components/field"

import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

/**
 * Loaded on demand.
 *
 * This is the only place in the entire app that touches MUI — the date picker
 * pulls in `@mui/material/styles` and `@mui/x-date-pickers` plus dayjs. Imported
 * statically it rode along in the sign-up chunk, so every visitor downloaded a
 * full component library and a date engine to render the *first* step of the
 * form, several steps before the calendar is ever shown.
 */
const BirthDatePicker = lazy(() =>
  import("@/features/auth/components/sign-up-steps/birth-date-picker").then((module) => ({
    default: module.BirthDatePicker,
  })),
)

/** Occupies the calendar's height so the step does not jump when it arrives. */
function BirthDatePickerFallback() {
  return (
    <div
      className="h-[336px] w-full animate-pulse rounded-2xl bg-neutral-100"
      aria-label="Loading date picker"
    />
  )
}

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
        <Suspense fallback={<BirthDatePickerFallback />}>
          <BirthDatePicker
            value={values.dateOfBirth}
            onChange={(iso) => onChange("dateOfBirth", iso)}
            invalid={Boolean(errors.dateOfBirth)}
          />
        </Suspense>
        {errors.dateOfBirth ? (
          <FieldError className="mt-2">{errors.dateOfBirth}</FieldError>
        ) : null}
      </div>

      <StepContinueButton onClick={onContinue}>Continue</StepContinueButton>
    </div>
  )
}
