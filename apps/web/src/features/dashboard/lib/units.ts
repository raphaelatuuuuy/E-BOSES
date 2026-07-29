import type { BarangayUnit, Concern } from "@/features/dashboard/api"

/**
 * Reading helpers for the barangay unit assigned to a concern.
 *
 * The roster itself lives in the database (`concerns.Department`, seeded by
 * migration 0025 and editable in Configuration), not in this file. An earlier
 * version hardcoded twenty units here AND guessed which one owned a concern
 * from its category, then displayed the guess as though the barangay had made
 * it. That was wrong twice over: the roster is the barangay's to change, and
 * showing a unit on unrouted work tells an official it is owned when it is not.
 *
 * `unitOf` now reads only what the API actually assigned. Unrouted concerns
 * render a dash.
 */

export type Unit = BarangayUnit

/** The unit handling this concern, or null when nobody has routed it. */
export function unitOf(concern: Concern): Unit | null {
  return concern.assigned_department ?? null
}

/** Compact label for tables and pins, falling back to the full name. */
export function unitLabel(unit: Unit): string {
  return unit.short_name?.trim() || unit.name
}

/** Printed wherever a unit has not been set. */
export const NO_UNIT = "-"

/**
 * Stable colour for a unit, derived from its immutable `code`.
 *
 * Deriving colours from the roster's order would reshuffle every chart the
 * moment an official adds or reorders a unit, so the hue is hashed from the
 * code instead: a unit keeps the same colour for the life of the install.
 * Saturation and lightness are fixed so no unit can produce a colour that
 * fights the brand palette.
 */
export function unitColor(unit: Unit): string {
  let hash = 0
  for (let index = 0; index < unit.code.length; index += 1) {
    hash = (hash * 31 + unit.code.charCodeAt(index)) % 360
  }
  return `hsl(${hash} 52% 52%)`
}
