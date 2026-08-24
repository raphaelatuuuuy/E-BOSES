import type {
  EmergencyAlert,
  EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { statusLabelOf } from "@/features/dashboard/components/record/status"
import { isSettled, type StateTone } from "@/features/dashboard/lib/responder-format"

export type TimelineState = "upcoming" | "current" | "done"

export interface TimelineEntry {
  key: string
  status: EmergencyStatus
  label: string
  at: string | null
  detail: string
  state: TimelineState
  tone: StateTone
}

const LADDER: EmergencyStatus[] = [
  "routed",
  "acknowledged",
  "en_route",
  "arrived",
  "resolved",
]

const RANK: Partial<Record<EmergencyStatus, number>> = {
  submitted: 0,
  routing: 0,
  routed: 0,
  awaiting_acknowledgment: 0,
  acknowledged: 1,
  en_route: 2,
  nearby: 2,
  arrived: 3,
  in_progress: 3,
  backup_requested: 3,
  backup_assigned: 3,
  transfer_required: 3,
  escalation_required: 3,
  resolved: 4,
  closed: 4,
}

function rankOf(status: EmergencyStatus) {
  return RANK[status] ?? 3
}

function toneFor(status: EmergencyStatus, state: TimelineState): StateTone {
  if (state === "upcoming") return "idle"
  if (isSettled(status)) return "settled"
  return "live"
}

export function buildDispatchTimeline(
  alert: EmergencyAlert,
  viewerId: number | null,
): TimelineEntry[] {
  const own =
    (alert.assignments ?? []).find((assignment) => assignment.responder.id === viewerId) ??
    alert.current_assignment ??
    null

  const history = new Map<string, { at: string; detail: string; status: EmergencyStatus }>()

  const record = (status: EmergencyStatus, at: string | null, detail: string) => {
    if (!at) return
    const existing = history.get(status)
    if (existing && new Date(existing.at).getTime() <= new Date(at).getTime()) {
      if (!existing.detail && detail) existing.detail = detail
      return
    }
    history.set(status, { at, detail, status })
  }

  record("submitted", alert.created_at, "Emergency reported.")
  record("routed", alert.routed_at, "Dispatched to your unit.")
  if (own) {
    record("routed", own.assigned_at, "Dispatched to your unit.")
    record("acknowledged", own.acknowledged_at, "You acknowledged the dispatch.")
    record("arrived", own.arrived_at, "You reported on scene.")
  }
  for (const event of alert.status_events ?? []) {
    record(event.status, event.created_at, event.note || "")
  }
  record("resolved", alert.resolved_at, alert.resolution_report || "Incident resolved.")

  const done = [...history.values()]
    .map((row) => ({
      key: `done-${row.status}`,
      status: row.status,
      label: statusLabelOf(row.status),
      at: row.at,
      detail: row.detail,
      state: "done" as TimelineState,
      tone: toneFor(row.status, "done"),
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const reached = rankOf(alert.status)
  const upcoming: TimelineEntry[] = LADDER
    .filter((status) => rankOf(status) > reached)
    .reverse()
    .map((status) => ({
      key: `next-${status}`,
      status,
      label: statusLabelOf(status),
      at: null,
      detail: "",
      state: "upcoming" as TimelineState,
      tone: toneFor(status, "upcoming"),
    }))

  if (done.length === 0) return upcoming

  const [latest, ...rest] = done
  return [
    ...upcoming,
    { ...latest, key: `current-${latest.status}`, state: "current", tone: toneFor(latest.status, "current") },
    ...rest,
  ]
}
