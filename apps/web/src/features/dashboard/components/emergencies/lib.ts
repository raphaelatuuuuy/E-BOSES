import type { PublicUser } from "@/features/dashboard/api"
import type { EmergencyAlert, EmergencyStatus } from "@/features/dashboard/emergency-api"
import { STATUS_LABEL, isEmergencyActive } from "@/features/dashboard/components/record/status"
import { responderUnitLabel as unitLabel } from "@/features/dashboard/lib/people"
import { useMinWidth } from "@/features/dashboard/lib/shell"

export const statusLabel: Record<EmergencyStatus, string> = STATUS_LABEL

export { unitLabel, isEmergencyActive, useMinWidth }

export function formatTime(value?: string | null, fallback = "Unknown time") {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function statusClass(status: EmergencyStatus) {
  const critical: EmergencyStatus[] = ["submitted", "routing", "escalation_required", "transfer_required", "false_alarm", "invalid"]
  const waiting: EmergencyStatus[] = ["routed", "awaiting_acknowledgment", "acknowledged", "backup_requested"]
  const moving: EmergencyStatus[] = ["en_route", "nearby", "backup_assigned", "in_progress"]
  const done: EmergencyStatus[] = ["arrived", "resolved", "closed", "resident_safe"]

  if (critical.includes(status)) return "border-severity-critical/40 bg-severity-critical-surface text-severity-critical-ink"
  if (waiting.includes(status)) return "border-severity-moderate/40 bg-severity-moderate-surface text-severity-moderate-ink"
  if (moving.includes(status)) return "border-status-active/40 bg-status-active-surface text-status-active-ink"
  if (done.includes(status)) return "border-status-closed/40 bg-status-closed-surface text-status-closed-ink"
  return "border-card-line bg-card-raised text-muted-foreground"
}

export function distanceKm(aLat?: string | number | null, aLng?: string | number | null, bLat?: string | number | null, bLng?: string | number | null) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function responderName(user?: PublicUser | null) {
  return user?.full_name || "Responder"
}

export { looksLikeCoordinates, readableLocation } from "@/features/dashboard/lib/location-text"

export function hasAutoRoute(alert: EmergencyAlert) {
  return (alert.status_events ?? []).some((event) => event.note.toLowerCase().includes("auto-routed"))
}

/**
 * Assumed responder speed for the candidate list, in km/h.
 *
 * The routing service returns a real `eta_seconds` (from OSRM) but only for the
 * responder actually assigned — getting one for every candidate would be one
 * routing call per row in the picker. So candidates get a straight-line
 * estimate at this constant, and the UI must label it as an estimate: a
 * dispatcher who mistakes it for a routed ETA will under-plan every time the
 * road does not run straight.
 */
export const ESTIMATED_RESPONSE_SPEED_KMH = 20

/** Minutes to cover `km` at the assumed speed. Null when distance is unknown. */
export function estimatedEtaMinutes(km: number | null) {
  if (km == null || !Number.isFinite(km)) return null
  return Math.max(1, Math.round((km / ESTIMATED_RESPONSE_SPEED_KMH) * 60))
}

export function formatDistanceKm(km: number | null) {
  if (km == null) return null
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

/* ── Queue filters ─────────────────────────────────────────────────────── */

/**
 * The queue had no filters at all, so a resolved or cancelled incident was
 * unreachable once it left the active set. These predicates are the whole
 * filter vocabulary; the page renders chips from this list and nothing else
 * decides membership.
 *
 * `resident_safe` deliberately counts as Active, not Resolved — the resident
 * has said they are safe but no responder has confirmed it, which is why the
 * backend keeps it in ACTIVE_STATUSES.
 */
export const EMERGENCY_FILTERS = [
  "All",
  "Active",
  "Resolved",
] as const

export type EmergencyFilter = (typeof EMERGENCY_FILTERS)[number]

const RESOLVED_STATUSES: EmergencyStatus[] = ["resolved", "closed"]

export function matchesEmergencyFilter(alert: EmergencyAlert, filter: string): boolean {
  switch (filter) {
    case "All":
      return true
    case "Active":
      return isEmergencyActive(alert.status)
    case "Resolved":
      return RESOLVED_STATUSES.includes(alert.status)
    default:
      return true
  }
}
