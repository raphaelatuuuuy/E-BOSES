import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

import { deriveEmergencySeverity, derivePriority, severityLevel, type Severity } from "./severity"
import { toStatusView } from "./status"
import type { RecordAction, RecordFact, RecordSection, RecordTrackStep, RecordView } from "./types"

/**
 * Maps an emergency onto the shared record shape.
 *
 * Both the Alert Map panel and the Emergencies module render through this, so
 * the two surfaces cannot drift apart in what they show or how they rank it —
 * which is exactly what happened when each built its own layout.
 *
 * The adapter is a pure function: everything time-dependent is passed in, and
 * everything interactive arrives as callbacks.
 */

const TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
  disaster: "Disaster",
  child_protection: "Child Protection",
  domestic_violence: "Domestic Violence",
  drug_related: "Drug-Related Incident",
  other: "Other",
}

/** Lifecycle in the order responders actually move through it. */
const TRACK: { key: string; label: string; reached: string[] }[] = [
  { key: "submitted", label: "Received", reached: ["submitted", "routing", "routed", "awaiting_acknowledgment", "acknowledged", "en_route", "nearby", "arrived", "resident_safe", "backup_requested", "backup_assigned", "in_progress", "transfer_required", "escalation_required", "resolved", "closed"] },
  { key: "routed", label: "Routed", reached: ["routed", "acknowledged", "en_route", "nearby", "arrived", "resolved"] },
  { key: "acknowledged", label: "Acknowledged", reached: ["acknowledged", "en_route", "nearby", "arrived", "resolved"] },
  { key: "en_route", label: "En route", reached: ["en_route", "nearby", "arrived", "resolved"] },
  { key: "arrived", label: "Arrived", reached: ["arrived", "resolved"] },
  { key: "resolved", label: "Resolved", reached: ["resolved"] },
]

export function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")} elapsed`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m elapsed`
  return `${Math.floor(hours / 24)}d ${hours % 24}h elapsed`
}

/**
 * Date + time, always both.
 *
 * The previous helper printed `toLocaleTimeString` only, so an incident from
 * three weeks ago and one from this morning showed an identical "14:20" on
 * every lifecycle step. In an operations log that is not a cosmetic problem:
 * it is the difference between a stale record and a live one.
 *
 * Compact by design — these render inside a six-step progress track — but the
 * full timestamp is always available to assistive tech and on hover via
 * `fullTimestamp()` on the surrounding element.
 */
function shortTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

/** Unabbreviated timestamp for `title`/`dateTime` attributes. */
export function fullTimestamp(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function buildTrack(alert: EmergencyAlert): RecordTrackStep[] {
  if (alert.status === "cancelled") {
    return [{ key: "cancelled", label: "Cancelled", state: "current" }]
  }
  if (alert.status === "false_alarm" || alert.status === "invalid") {
    return [{ key: alert.status, label: alert.status === "false_alarm" ? "False alarm" : "Invalid", state: "current" }]
  }

  const timestampFor: Record<string, string | null | undefined> = {
    submitted: alert.created_at,
    routed: alert.routed_at,
    acknowledged: alert.current_assignment?.acknowledged_at,
    arrived: alert.current_assignment?.arrived_at,
    resolved: alert.resolved_at,
  }

  return TRACK.map((step) => {
    const reached = step.reached.includes(alert.status)
    const current = step.key === alert.status
    return {
      key: step.key,
      label: step.label,
      state: current ? "current" : reached ? "done" : "pending",
      at: shortTime(timestampFor[step.key]),
    }
  })
}

export interface EmergencyAdapterOptions {
  /** Injected so the adapter stays pure and testable. */
  now: number
  /** Route info from the live map, when available. */
  distanceLabel?: string | null
  etaLabel?: string | null
  /** Actions the current official may take. Order matters: [0] is primary. */
  actions?: RecordAction[]
  /** Tier 3 content, supplied by the calling screen. */
  sections?: RecordSection[]
}

export function toEmergencyRecordView(
  alert: EmergencyAlert,
  options: EmergencyAdapterOptions,
): RecordView {
  const witnessCount = alert.witness_notification_summary?.recipient_count ?? 0
  const acknowledged = Boolean(alert.current_assignment?.acknowledged_at)
  const elapsedMinutes = (options.now - new Date(alert.created_at).getTime()) / 60_000

  const { severity } = deriveEmergencySeverity({
    type: alert.type,
    elapsedMinutes,
    acknowledged,
    witnessCount,
  })

  const status = toStatusView(alert.status)
  const assignment = alert.current_assignment

  const facts: RecordFact[] = [
    {
      label: "Reported by",
      value: alert.reporter_phone || null,
      emptyHint: "Reporter contact withheld",
    },
    {
      label: "Nearby residents alerted",
      // Distinguishes "nobody was near" from "the alert never fired".
      value: alert.witness_notification_summary?.triggered
        ? `${witnessCount} notified`
        : "Not triggered",
    },
    {
      label: "Location source",
      value: alert.location_source === "gps" ? "GPS" : alert.location_source === "manual_pin" ? "Pinned manually" : alert.location_source.toUpperCase(),
    },
  ]

  if (options.etaLabel) {
    facts.push({ label: "ETA", value: options.etaLabel })
  }

  return {
    id: String(alert.id),
    kind: "emergency",
    typeLabel: TYPE_LABEL[alert.type] ?? alert.type,
    severity,
    // Emergency severity is computed from incident facts that always exist, so
    // unlike concerns it is never "pending assessment".
    severityAssessed: true,
    status,
    priority: derivePriority({
      severity,
      hoursSinceStatusChange: (options.now - new Date(alert.updated_at).getTime()) / 3_600_000,
    }),
    title: alert.note?.trim() || `${TYPE_LABEL[alert.type] ?? alert.type} emergency`,
    address: alert.address?.trim() || alert.barangay || null,
    elapsedLabel: formatElapsed(alert.created_at, options.now),
    distanceLabel: options.distanceLabel ?? null,
    facts,
    track: buildTrack(alert),
    assigneeLabel: assignment
      ? `${assignment.responder.full_name}${assignment.responder.responder_unit ? ` · ${assignment.responder.responder_unit}` : ""}`
      : null,
    assigneeDetail: assignment?.acknowledged_at
      ? `acknowledged ${shortTime(assignment.acknowledged_at)}`
      : assignment
        ? "awaiting acknowledgement"
        : null,
    actions: options.actions ?? [],
    sections: options.sections ?? [],
  }
}

export interface TriagedAlert {
  alert: EmergencyAlert
  severity: Severity
  priority: number
}

/**
 * Rank a queue of alerts: severity band first, priority within it.
 *
 * The same ordering rule the concern queue uses, so an official never has to
 * learn two different notions of "what comes first".
 */
export function triageAlerts(alerts: readonly EmergencyAlert[], now: number): TriagedAlert[] {
  return alerts
    .map((alert) => {
      const { severity } = deriveEmergencySeverity({
        type: alert.type,
        elapsedMinutes: (now - new Date(alert.created_at).getTime()) / 60_000,
        acknowledged: Boolean(alert.current_assignment?.acknowledged_at),
        witnessCount: alert.witness_notification_summary?.recipient_count ?? 0,
      })
      return {
        alert,
        severity,
        priority: derivePriority({
          severity,
          hoursSinceStatusChange: (now - new Date(alert.updated_at).getTime()) / 3_600_000,
        }),
      }
    })
    .sort((a, b) => {
      const band = severityLevel(b.severity) - severityLevel(a.severity)
      return band !== 0 ? band : b.priority - a.priority
    })
}
