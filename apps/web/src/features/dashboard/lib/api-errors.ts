import { ApiError } from "@/lib/api"

import { CAPABILITY_LABEL } from "./capabilities"

/**
 * Turn an API failure into something an official can act on.
 *
 * A generic "Could not save" toast hides the two failures that actually happen
 * on configuration screens: a missing capability (fixable by asking the Barangay
 * Captain) and a field validation error (fixable by the person right there).
 * Both were invisible before, which made working screens look broken.
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message ? error.message : fallback
  }

  const data = error.data as Record<string, unknown> | null | undefined

  if (error.status === 429) {
    return "You're doing that too often. Please wait a moment and try again."
  }

  if (error.status === 401) {
    return "Your session expired. Please sign in again."
  }

  if (error.status === 403) {
    const capability = typeof data?.required_capability === "string" ? data.required_capability : null
    if (capability) {
      const label = CAPABILITY_LABEL[capability] ?? capability
      return `You need the “${label}” permission. Ask the Barangay Captain to grant it in Configuration → Permissions.`
    }
    return typeof data?.detail === "string" ? data.detail : "You do not have permission to do that."
  }

  if (error.status === 400 && data && typeof data === "object") {
    // DRF field errors: { field: ["message"] }. Name the field, because "invalid"
    // on its own does not tell anyone which input to fix.
    const parts: string[] = []
    for (const [field, value] of Object.entries(data)) {
      const message = Array.isArray(value) ? value.join(" ") : String(value)
      parts.push(field === "detail" || field === "non_field_errors" ? message : `${field}: ${message}`)
    }
    if (parts.length) return parts.join(" · ")
  }

  if (typeof data?.detail === "string") return data.detail

  return error.message || fallback
}
