export type PasswordRequirementId =
  | "minLength"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special"

export interface PasswordRequirement {
  id: PasswordRequirementId
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: "minLength",
    label: "At least 8 characters",
    test: (password) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "At least one lowercase letter",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "At least one number",
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: "special",
    label: "At least one special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
] as const

export interface PasswordRequirementStatus {
  id: PasswordRequirementId
  label: string
  met: boolean
}

export function evaluatePasswordRequirements(password: string): PasswordRequirementStatus[] {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    met: requirement.test(password),
  }))
}

export function getPasswordStrength(password: string) {
  const statuses = evaluatePasswordRequirements(password)
  const score = statuses.filter((item) => item.met).length
  const max = statuses.length
  return {
    score,
    max,
    percent: max === 0 ? 0 : (score / max) * 100,
    checks: statuses.map((item) => item.met),
    requirements: statuses,
  }
}
