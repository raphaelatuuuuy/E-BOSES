import type { EmergencyAlert, EmergencyStatus } from "@/features/dashboard/emergency-api"
import {
  SETTLED_EMERGENCY_STATUSES,
  STATUS_LABEL,
} from "@/features/dashboard/components/record/status"

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

/**
 * Great-circle distance in kilometres, or null when either point is missing or
 * unparseable. The dispatch page and the map page both need it, so it lives
 * here rather than being copied into each.
 */
export function distanceKm(
  aLat?: string | number | null,
  aLng?: string | number | null,
  bLat?: string | number | null,
  bLng?: string | number | null,
) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Distance for a metric tile. Under a kilometre reads in metres — "340 m" is
 * a distance a responder can picture; "0.3 km" is not.
 */
export function formatKm(km?: number | null) {
  if (km == null || !Number.isFinite(km)) return "—"
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

/** Routing ETA for a metric tile. */
export function formatEta(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—"
  if (seconds < 60) return "< 1 min"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Short elapsed readout for a metric tile: "12m", "1h 04m", "3d". */
export function formatSince(value: string | null | undefined, now = Date.now()) {
  if (!value) return "—"
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
  return `${Math.floor(hours / 24)}d`
}

/**
 * The same three readouts, split into magnitude and unit for `MetricTile`,
 * which sets the unit smaller and muted beside the value.
 *
 * These exist as their own functions rather than as a string splitter over the
 * `format*` output above, because that output is not safely splittable: the
 * last token of "1h 04m" is part of the magnitude and the last token of
 * "just now" is not a unit at all. Getting it wrong renders "just" large and
 * "now" as a unit, so the split is decided where the value is built.
 */
export interface Measure {
  value: string
  unit?: string
}

const NO_MEASURE: Measure = { value: "—" }

export function measureKm(km?: number | null): Measure {
  if (km == null || !Number.isFinite(km)) return NO_MEASURE
  if (km < 1) return { value: String(Math.round(km * 1000)), unit: "m" }
  return { value: km.toFixed(1), unit: "km" }
}

export function measureEta(seconds?: number | null): Measure {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return NO_MEASURE
  if (seconds < 60) return { value: "< 1", unit: "min" }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { value: String(minutes), unit: "min" }
  const hours = Math.floor(minutes / 60)
  return { value: `${hours}h ${minutes % 60}m` }
}

export function measureSince(value: string | null | undefined, now = Date.now()): Measure {
  if (!value) return NO_MEASURE
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return { value: "just now" }
  if (minutes < 60) return { value: String(minutes), unit: "min" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: `${hours}h ${String(minutes % 60).padStart(2, "0")}m` }
  const days = Math.floor(hours / 24)
  return { value: String(days), unit: days === 1 ? "day" : "days" }
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

export function formatResolvedOn(value: string | null | undefined) {
  if (!value) return ""
  const day = new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
  }).format(new Date(value))
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
  return `${day} at ${time}`
}

export function isSettled(status: string) {
  return SETTLED_EMERGENCY_STATUSES.has(status)
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

export const statusWords: Record<EmergencyStatus, string> = STATUS_LABEL

export function dispatchState(
  alert: EmergencyAlert,
  viewerId: number | null,
): { label: string; tone: StateTone } {
  if (alert.status === "routed") {
    const own = (alert.assignments ?? []).find((assignment) => assignment.responder.id === viewerId)
    if (own) {
      return { label: "Assigned to your unit", tone: "alarm" }
    }
  }
  if (isSettled(alert.status)) {
    return { label: statusWords[alert.status], tone: "settled" }
  }
  if (alert.status === "submitted") return { label: statusWords[alert.status], tone: "alarm" }
  return { label: statusWords[alert.status], tone: "live" }
}
