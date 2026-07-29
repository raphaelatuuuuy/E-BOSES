import type { EmergencyAlert, EmergencyStatus } from "@/features/dashboard/emergency-api"

/**
 * Shared formatting for the responder screens.
 *
 * Map, Shift and Profile all render the same clock, the same status wording and
 * the same relative timestamps. They used to each carry their own copy, which is
 * how the shift page ended up calling a resolved dispatch "responder routed"
 * while the map called it "Resolved".
 */

/** Running clock for an open shift: mm:ss under an hour, h:mm:ss over. */
export function formatElapsed(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return "00:00"
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

/** Settled duration, e.g. "2h 14m". Empty durations read as a word, not a dash. */
export function formatDuration(seconds?: number | null) {
  if (seconds == null || seconds <= 0) return "None recorded"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours <= 0) return `${minutes || 1}m`
  return `${hours}h ${minutes}m`
}

/** Compact response time for a stat readout, e.g. "4m 20s". */
export function formatResponse(seconds?: number | null) {
  if (seconds == null || seconds <= 0) return "None yet"
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`
}

/** "4m ago", "2h ago", "3d ago". */
export function formatAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return ""
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function formatClock(value: string | null | undefined) {
  if (!value) return ""
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  )
}

export function formatDayTime(value: string | null | undefined) {
  if (!value) return "Not recorded"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export const ACTIVE_EMERGENCY_STATUSES = new Set<string>([
  "submitted",
  "routed",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
])

export function isSettled(status: string) {
  return ["resolved", "cancelled", "false_alarm", "invalid"].includes(status)
}

/**
 * Tone for the state word in a row's meta line.
 *
 * Replaces the pill badges the console used to carry. `alarm` is the only tone
 * that means "you have not done your part yet".
 */
export type StateTone = "alarm" | "live" | "settled" | "idle"

export function toneClass(tone: StateTone) {
  return {
    alarm: "text-sos",
    live: "text-ice",
    settled: "text-status-closed",
    idle: "text-subtle-foreground",
  }[tone]
}

export function dotClass(tone: StateTone) {
  return {
    alarm: "bg-sos",
    live: "bg-ice",
    settled: "bg-status-closed",
    idle: "bg-subtle-foreground",
  }[tone]
}

const statusWords: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Routed to you",
  acknowledged: "Automatically routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  false_alarm: "False alarm",
  invalid: "Invalid",
  cancelled: "Cancelled",
}

/**
 * How a dispatch reads to *this* responder, as a word plus a tone.
 *
 * A routed dispatch the viewer has not acknowledged is the one case that
 * outranks the alert's own status: it is the responder's outstanding action.
 */
export function dispatchState(
  alert: EmergencyAlert,
  viewerId: number | null,
): { label: string; tone: StateTone } {
  if (alert.status === "routed") {
    const own = alert.assignments.find((assignment) => assignment.responder.id === viewerId)
    if (own && own.acknowledged_at === null) {
      return { label: "Awaiting you", tone: "alarm" }
    }
  }
  if (isSettled(alert.status)) {
    return { label: statusWords[alert.status], tone: "settled" }
  }
  if (alert.status === "submitted") return { label: statusWords[alert.status], tone: "alarm" }
  return { label: statusWords[alert.status], tone: "live" }
}
