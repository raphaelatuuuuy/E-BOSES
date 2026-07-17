import { Field, FieldError } from "@workspace/ui/components/field"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

function sanitizeName(value: string) {
  return value.replace(/[^A-Za-zÑñ ]/g, "")
}

interface MiddleNameStepProps {
  values: SignUpValues
  errors: SignUpErrors
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onContinue: () => void
  onSkip: () => void
}

export function MiddleNameStep({
  values,
  errors,
  onChange,
  onContinue,
  onSkip,
}: MiddleNameStepProps) {
  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>Almost forgot, do you have a middle name?</StepTitle>

      <div className="mt-8">
        <Field>
          <FloatingLabelInput
            id="middleName"
            type="text"
            autoComplete="additional-name"
            label="Middle name"
            value={values.middleName ?? ""}
            onChange={(e) => onChange("middleName", sanitizeName(e.target.value))}
            aria-invalid={Boolean(errors.middleName)}
          />
          {errors.middleName ? <FieldError>{errors.middleName}</FieldError> : null}
        </Field>
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex h-12 items-center justify-center rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white transition-colors hover:bg-[#e6732e]"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
