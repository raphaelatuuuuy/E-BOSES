import type { AuthUser } from "@/features/auth/api"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"

/**
 * Legacy `responder_unit` enum labels, for accounts that predate the unit
 * registry. Only used when no Position/unit name is available.
 */
const LEGACY_UNIT_LABELS: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "Barangay Health Workers",
  bdrrmo: "BDRRMO",
}

/**
 * The person's display position — the thing under their name.
 *
 * Uses the Position the barangay assigned (`units[0].position`, e.g. "Barangay
 * Captain"), falling back to a responder's unit ("Barangay Tanod"), and finally
 * to the role label. The raw role string ("first_responder"/"responder") is
 * never shown.
 */
export function displayPosition(user: AuthUser | null): string {
  if (!user) return "Account"
  const position = user.units?.[0]?.position
  if (position) return position
  if (isResponderUser(user)) {
    return LEGACY_UNIT_LABELS[user.responder_unit || ""] || "First Responder"
  }
  if (isOfficialUser(user)) return "Barangay Official"
  return "Resident"
}

/** The assigned unit label shown under an official or responder's name. */
export function displayUnit(user: AuthUser | null): string {
  if (!user) return "Unit not assigned"
  const unit = user.units?.[0]
  if (unit) return unit.name || unit.short_name
  if (isResponderUser(user)) {
    return LEGACY_UNIT_LABELS[user.responder_unit || ""] || "Unit not assigned"
  }
  if (user.is_superuser) return "All units"
  return "Unit not assigned"
}
