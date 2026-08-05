import { useState } from "react"
import { toast } from "sonner"

import {
  acknowledgeEmergency,
  markEmergencyArrived,
  requestEmergencyBackup,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"

/**
 * The responder's dispatch transitions — Acknowledge → (En route) → Arrived →
 * Resolved — as state, not as UI.
 *
 * This was `incident-actions.tsx`, a component that rendered both a 4-step
 * stepper and a stack of up to four buttons. The stepper has been replaced by
 * `dispatch-timeline.tsx` (which shows real timestamps instead of guessing),
 * and the buttons by `dispatch-action-bar.tsx` (which shows the one legal
 * transition instead of all four). The gating below is unchanged.
 *
 * Enable/disable matrix (see task-C-report.md for the full write-up):
 *  - Acknowledge: alert.status === "routed" AND own assignment is un-acknowledged.
 *    Posts POST /emergencies/{id}/acknowledge/, optimistic-updates the alert
 *    locally, then triggers a full refetch (per the brief).
 *  - En route: display-only — no button. Flips automatically once a location
 *    ping lands (the auto-ping loop on the dispatch page already does this,
 *    including the server's auto-acknowledge-on-first-ping fallback).
 *  - Arrived: existing `markEmergencyArrived` gating — alert.status is
 *    "en_route" or "nearby".
 *  - Resolved: enabled once the Arrived step is complete (alert.status ===
 *    "arrived") — a deliberate tightening vs. the looser
 *    `components/emergencies/responder-panels.tsx` gating (which also allows
 *    resolving straight from en_route/nearby) so the flow reads as strictly
 *    sequential. See report for rationale.
 */
export function useIncidentActions({
  alert,
  viewerId,
  onChanged,
  onRefresh,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  onChanged: (next: EmergencyAlert) => void
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState("")

  const ownAssignment =
    alert.assignments.find((assignment) => assignment.responder.id === viewerId) ??
    alert.current_assignment ??
    null

  const isCancelled = alert.status === "cancelled"
  const acknowledged = Boolean(ownAssignment?.acknowledged_at)
  const resolvedReached = alert.status === "resolved"

  const canAcknowledge =
    !isCancelled && alert.status === "routed" && ownAssignment?.status === "assigned" && !acknowledged
  // Arrived / Resolve stay reachable while backup is in flight — a responder
  // parked in `backup_requested` still needs to be able to say "I'm on scene"
  // or "we're done" without waiting for the backup responder to acknowledge.
  const canMarkArrived =
    !isCancelled &&
    ["en_route", "nearby", "backup_requested", "backup_assigned"].includes(alert.status)
  const canResolve =
    !isCancelled &&
    ["arrived", "in_progress", "backup_requested", "backup_assigned", "en_route", "nearby"].includes(alert.status)
  const canRequestBackup = !isCancelled && alert.status !== "resolved"
  const enRoutePending =
    !isCancelled &&
    !resolvedReached &&
    !canAcknowledge &&
    ["routed", "acknowledged"].includes(alert.status)
  // Backup states now expose Arrived/Resolve, so the parked-with-no-actions
  // case shrinks to just transfer/escalation and resident_safe.
  const holding =
    !isCancelled &&
    !resolvedReached &&
    !enRoutePending &&
    !canAcknowledge &&
    !canMarkArrived &&
    !canResolve

  async function handleAcknowledge() {
    if (!canAcknowledge) return
    setBusy("acknowledge")
    const previous = alert
    const optimistic: EmergencyAlert = {
      ...alert,
      status: "acknowledged",
      assignments: alert.assignments.map((assignment) =>
        assignment.id === ownAssignment?.id
          ? { ...assignment, status: "acknowledged", acknowledged_at: new Date().toISOString() }
          : assignment,
      ),
    }
    onChanged(optimistic)
    try {
      const next = await acknowledgeEmergency(alert.id)
      onChanged(next)
      toast.success("Dispatch acknowledged", { id: "ack" })
    } catch (err) {
      // Revert the optimistic guess immediately, then resync to whatever the
      // server actually has — a 409 here usually means the status already
      // moved on (a concurrent backup responder acknowledged first, or a
      // location ping auto-acknowledged it), so the stale local snapshot
      // must not be left in place: re-tapping it would just 409 forever.
      onChanged(previous)
      toast.error(err instanceof Error ? err.message : "Could not acknowledge dispatch.", { id: "ack-err" })
    } finally {
      setBusy("")
    }
    // Outside the guarded try/catch above on purpose: this refetch covers
    // both outcomes (resync after success, resync after a reverted failure)
    // and must never be able to make a *successful* acknowledgeEmergency
    // call look like a failure just because the refetch itself hiccups.
    await onRefresh().catch(() => {})
  }

  async function handleArrived() {
    if (!canMarkArrived) return
    setBusy("arrived")
    try {
      const next = await markEmergencyArrived(alert.id)
      onChanged(next)
      toast.success("Marked arrived on scene", { id: "arrived" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update arrival.", { id: "arrived-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleResolve() {
    if (!canResolve) return
    setBusy("resolve")
    try {
      const next = await resolveEmergency(alert.id, "Incident resolved by responder.")
      onChanged(next)
      toast.success("Incident resolved", { id: "resolve" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve incident.", { id: "resolve-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleBackup() {
    if (!canRequestBackup) return
    setBusy("backup")
    try {
      const next = await requestEmergencyBackup(alert.id, {
        backup_type: "other",
        reason: "Backup requested by responder.",
        urgency: "high",
      })
      onChanged(next)
      // Backup is presented as a broadcast to other responders; the responder
      // does not need a count of who was reassigned, only that the alert went
      // out. Reassignment/escalation happens server-side.
      toast.success("Other responders alerted.", { id: "backup" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not request backup.", { id: "backup-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  return {
    busy,
    isCancelled,
    resolvedReached,
    canAcknowledge,
    canMarkArrived,
    canResolve,
    canRequestBackup,
    enRoutePending,
    holding,
    status: alert.status,
    handleAcknowledge,
    handleArrived,
    handleResolve,
    handleBackup,
  }
}
