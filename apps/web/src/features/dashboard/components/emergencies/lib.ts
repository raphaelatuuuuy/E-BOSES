import { useEffect, useState } from "react"

import type { PublicUser } from "@/features/dashboard/api"
import type { EmergencyAlert, EmergencyStatus, EmergencyType } from "@/features/dashboard/emergency-api"

export type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

// `acknowledged` sits between `routed` and `en_route`: the responder has seen/accepted
// the auto-route but has not started moving yet. Officials only observe this status
// (the responder-side POST /emergencies/{id}/acknowledge/ sets it); it shares the
// "routed" visual step below and gets its own label + amber color.
export const statusLabel: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Routed",
  acknowledged: "Responder routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  false_alarm: "False alarm",
  invalid: "Invalid",
  cancelled: "Cancelled",
}

export const unitLabel: Record<ResponderUnit, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  "": "Responder",
}

export const statusSteps: EmergencyStatus[] = ["submitted", "routed", "en_route", "arrived", "resolved"]

/**
 * Date + time for incident records. The year is printed whenever the record is
 * not from the current year, so an operations log never renders two entries
 * twelve months apart as the same string.
 */
export function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown time"
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
  if (status === "submitted") return "border-severity-critical/40 bg-severity-critical-surface text-severity-critical-ink"
  if (status === "routed" || status === "acknowledged") return "border-severity-moderate/40 bg-severity-moderate-surface text-severity-moderate-ink"
  if (status === "en_route" || status === "nearby") return "border-status-active/40 bg-status-active-surface text-status-active-ink"
  if (status === "arrived" || status === "resolved") return "border-status-closed/40 bg-status-closed-surface text-status-closed-ink"
  if (status === "false_alarm" || status === "invalid") return "border-severity-critical/40 bg-severity-critical-surface text-severity-critical-ink"
  return "border-card-line bg-card-raised text-muted-foreground"
}

export function emergencyTone(type: EmergencyType) {
  return `${type.replace(/_/g, " ")} response`
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

export function hasAutoRoute(alert: EmergencyAlert) {
  return alert.status_events.some((event) => event.note.toLowerCase().includes("auto-routed"))
}

/** Local matchMedia hook for the 1280px (xl) three-column threshold — the 1024px
 * (lg) desktop boundary already has `useIsDesktop` in `lib/shell.ts`; this covers
 * the extra tier the emergencies console needs without touching that shared file. */
export function useMinWidth(px: number) {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= px : true))

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`)
    const apply = () => setMatches(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [px])

  return matches
}
