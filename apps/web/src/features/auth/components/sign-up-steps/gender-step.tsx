import { FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

const OPTIONS = [
  {
    value: "male",
    label: "Male",
    iconBg: "bg-blue-50",
    iconRing: "ring-blue-200",
    iconColor: "text-blue-600",
    selectedBg: "bg-blue-50",
    selectedBorder: "border-blue-500",
    selectedLabel: "text-blue-700",
    idleLabel: "",
    Icon: MaleIcon,
  },
  {
    value: "female",
    label: "Female",
    iconBg: "bg-rose-50",
    iconRing: "ring-rose-200",
    iconColor: "text-rose-500",
    selectedBg: "bg-rose-50",
    selectedBorder: "border-rose-500",
    selectedLabel: "text-rose-700",
    idleLabel: "",
    Icon: FemaleIcon,
  },
  {
    value: "prefer_not_to_say",
    label: "Skip",
    iconBg: "bg-neutral-100",
    iconRing: "ring-neutral-200",
    iconColor: "text-neutral-500",
    selectedBg: "bg-neutral-100",
    selectedBorder: "border-neutral-400",
    selectedLabel: "text-neutral-700",
    idleLabel: "text-neutral-500",
    Icon: PreferNotIcon,
  },
] as const

interface GenderStepProps {
  values: SignUpValues
  errors: SignUpErrors
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onContinue: () => void
}

function firstWordOfName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return "neighbor"
  return trimmed.split(/\s+/)[0] || "neighbor"
}

/** Premium male (Mars) mark — light blue. */
function MaleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="14" r="5.25" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M14.25 9.75 19 5m0 0h-4.25M19 5v4.25"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Premium female (Venus) mark — pink. */
function FemaleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="9.5" r="5.25" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M12 14.75v5.5M9.25 17.5h5.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Premium neutral person mark — grey (no X). */
function PreferNotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M5.5 19.25c.9-3.1 3.35-4.75 6.5-4.75s5.6 1.65 6.5 4.75"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function GenderStep({ values, errors, onChange, onContinue }: GenderStepProps) {
  const firstName = firstWordOfName(values.firstName)

  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle className="text-center">
        Good day, {firstName}.
        <br />
        What&apos;s your gender?
      </StepTitle>

      <div className="mt-8 grid grid-cols-3 gap-3">
        {OPTIONS.map((option) => {
          const selected = values.gender === option.value
          const Icon = option.Icon
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange("gender", option.value)}
              className={cn(
                "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-[12px] border-2 bg-white px-2 py-4 text-center text-sm font-medium text-foreground transition-[border-width,border-color,background-color,box-shadow]",
                selected
                  ? cn("border-[3px] shadow-sm", option.selectedBorder, option.selectedBg)
                  : "border-input hover:bg-neutral-50 focus-visible:border-[3px] focus-visible:border-primary",
              )}
              aria-pressed={selected}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full ring-1",
                  option.iconBg,
                  option.iconRing,
                  option.iconColor,
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className={selected ? cn("font-semibold", option.selectedLabel) : option.idleLabel}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
      {errors.gender ? <FieldError className="mt-3">{errors.gender}</FieldError> : null}

      <StepContinueButton onClick={onContinue}>Continue</StepContinueButton>
    </div>
  )
}
