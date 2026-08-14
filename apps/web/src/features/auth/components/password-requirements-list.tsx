import { cn } from "@workspace/ui/lib/utils"

import { evaluatePasswordRequirements } from "@/features/auth/lib/password-requirements"

interface PasswordRequirementsListProps {
  password: string
  className?: string
}

/** Boxicons solid `check-circle` — https://boxicons.com/?query=check-circle */
function BoxCheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm-1.999 14.413-3.713-3.705L7.7 11.292l2.299 2.295 5.294-5.294 1.414 1.414-6.706 6.706z" />
    </svg>
  )
}

/** Boxicons solid `x-circle` — https://boxicons.com/?query=x-circle */
function BoxXCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm4.207 12.793-1.414 1.414L12 13.414l-2.793 2.793-1.414-1.414L10.586 12 7.793 9.207l1.414-1.414L12 10.586l2.793-2.793 1.414 1.414L13.414 12l2.793 2.793z" />
    </svg>
  )
}

/**
 * Live password rules: green Boxicons check / red Boxicons cross per row.
 * Updates as the user types.
 */
export function PasswordRequirementsList({ password, className }: PasswordRequirementsListProps) {
  const requirements = evaluatePasswordRequirements(password)
  const hasInput = password.length > 0

  return (
    <ul
      className={cn("mt-2 flex flex-col gap-1.5", className)}
      aria-label="Password requirements"
      aria-live="polite"
    >
      {requirements.map((requirement) => {
        const met = requirement.met
        // Neutral until typing starts; then green pass / red fail.
        const tone = !hasInput
          ? "text-neutral-400"
          : met
            ? "text-foreground"
            : "text-neutral-400"

        return (
          <li
            key={requirement.id}
            className={cn(
              "flex items-center gap-2 text-sm leading-snug transition-colors",
              !hasInput
                ? "text-neutral-500"
                : met
                  ? "text-foreground"
                  : "text-sos",
            )}
          >
            <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", tone)}>
              {met ? (
                <BoxCheckCircleIcon className="size-4" />
              ) : (
                <BoxXCircleIcon className="size-4" />
              )}
            </span>
            <span>{requirement.label}</span>
            <span className="sr-only">{met ? "met" : "not met"}</span>
          </li>
        )
      })}
    </ul>
  )
}
