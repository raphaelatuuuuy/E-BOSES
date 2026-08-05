import type {
  EmergencyAlert,
  EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { isSettled, statusWords, type StateTone } from "@/features/dashboard/lib/responder-format"

/**
 * The dispatch timeline — one merged, reverse-chronological rail.
 *
 * The responder screen used to show a forward 4-step stepper with no
 * timestamps, while `status_events` and `assignment_logs` came down on every
 * payload and were never rendered. This merges what actually happened with
 * what is still to come, newest first, so the rail reads like every delivery
 * tracker a responder already uses: the remaining journey above the current
 * position, the history below it.
 *
 * The merge mirrors `components/emergencies/incident-board.tsx`'s
 * `IncidentChronology` rather than introducing a second chronology algorithm —
 * the difference is that this one is milestone-shaped (one row per state
 * reached) instead of log-shaped (one row per write).
 */

export type TimelineState = "upcoming" | "current" | "done"

export interface TimelineEntry {
  key: string
  status: EmergencyStatus
  label: string
  /** ISO timestamp. Null on upcoming milestones, which have not happened yet. */
  at: string | null
  detail: string
  state: TimelineState
  tone: StateTone
}

/**
 * The milestones a responder moves through, in order. `nearby` collapses into
 * `en_route` and `in_progress` into `arrived`: they are the same position on
 * the rail, and giving each its own row would make the ladder read as if the
 * responder had skipped a step whenever the server chose the other word.
 */
const LADDER: Array<{ status: EmergencyStatus; label: string }> = [
  { status: "routed", label: "Routed to you" },
  { status: "acknowledged", label: "Acknowledged" },
  { status: "en_route", label: "En route" },
  { status: "arrived", label: "On scene" },
  { status: "resolved", label: "Resolved" },
]

/**
 * Ladder rungs win over `statusWords` when naming a row.
 *
 * Without this the same milestone changes name as it passes: `acknowledged`
 * reads "Acknowledged" while it is still ahead of the responder and
 * "Automatically routed" (the queue-wide wording) once it is behind them, so
 * the rail looked like it had two different steps.
 */
const LADDER_LABELS = new Map(LADDER.map((step) => [step.status, step.label]))

function labelFor(status: EmergencyStatus) {
  return LADDER_LABELS.get(status) ?? statusWords[status] ?? status.replace(/_/g, " ")
}

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

/** How far along the ladder a status sits. Terminal-but-unresolved returns 3. */
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
    alert.assignments.find((assignment) => assignment.responder.id === viewerId) ??
    alert.current_assignment ??
    null

  // One row per state actually reached. Keyed by status so a status event and
  // the assignment milestone that produced it collapse into a single row —
  // otherwise acknowledging shows up twice, once from each source.
  const history = new Map<string, { at: string; detail: string; status: EmergencyStatus }>()

  const record = (status: EmergencyStatus, at: string | null, detail: string) => {
    if (!at) return
    const existing = history.get(status)
    // Earliest wins: the first time a state was reached is when it happened.
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
      label: labelFor(row.status),
      at: row.at,
      detail: row.detail,
      state: "done" as TimelineState,
      tone: toneFor(row.status, "done"),
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  // Everything on the ladder the alert has not reached yet, furthest goal
  // first, so "Resolved" sits at the top of the rail the way the destination
  // does on a delivery tracker.
  const reached = rankOf(alert.status)
  const upcoming: TimelineEntry[] = LADDER
    .filter((step) => rankOf(step.status) > reached)
    .reverse()
    .map((step) => ({
      key: `next-${step.status}`,
      status: step.status,
      label: step.label,
      at: null,
      detail: "",
      state: "upcoming" as TimelineState,
      tone: toneFor(step.status, "upcoming"),
    }))

  if (done.length === 0) return upcoming

  const [latest, ...rest] = done
  return [
    ...upcoming,
    { ...latest, key: `current-${latest.status}`, state: "current", tone: toneFor(latest.status, "current") },
    ...rest,
  ]
}
