import { useRef, useState } from "react"
import { toast } from "sonner"

import {
  markEmergencyArrived,
  markEmergencyEnRoute,
  requestEmergencyBackup,
  getEmergencyBackupUnits,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
export function useIncidentActions({
  alert,
  viewerId,
  onChanged,
  onRefresh,
  onResolveRequested,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  onChanged: (next: EmergencyAlert) => void
  onRefresh: () => Promise<void>
  onResolveRequested?: () => void
}) {
  const [busy, setBusy] = useState("")
  const [lastConfirmed, setLastConfirmed] = useState<{ label: string; at: number } | null>(null)
  const confirmTimerRef = useRef<number | null>(null)

  function confirm(label: string) {
    setLastConfirmed({ label, at: Date.now() })
    if (confirmTimerRef.current != null) window.clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = window.setTimeout(() => setLastConfirmed(null), 6000)
  }

  const ownAssignment = viewerId != null
    ? (alert.assignments ?? []).find((assignment) => assignment.responder.id === viewerId) ??
      (alert.current_assignment?.responder?.id === viewerId ? alert.current_assignment : null)
    : alert.current_assignment ?? null
  const hasOwnAssignment = Boolean(ownAssignment)

  const isCancelled = alert.status === "cancelled"
  const resolvedReached = alert.status === "resolved"

  const canStartTravel =
    hasOwnAssignment && !isCancelled && ["routed", "acknowledged"].includes(alert.status)
  const canMarkArrived =
    hasOwnAssignment &&
    !isCancelled &&
    ["en_route", "nearby", "backup_requested", "backup_assigned"].includes(alert.status)
  const canResolve =
    hasOwnAssignment &&
    !isCancelled &&
    ["arrived", "in_progress", "backup_requested", "backup_assigned", "en_route", "nearby"].includes(alert.status)
  const canRequestBackup = hasOwnAssignment && !isCancelled && alert.status !== "resolved"
  const holding =
    !hasOwnAssignment || (
    !isCancelled &&
    !resolvedReached &&
    !canStartTravel &&
    !canMarkArrived &&
    !canResolve)

  async function handleStartTravel() {
    if (!canStartTravel) return
    setBusy("start-travel")
    try {
      const next = await markEmergencyEnRoute(alert.id)
      onChanged(next)
      toast.success("Travel status shared", { id: "start-travel" })
      confirm("Responder en route")
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : "Could not share travel status.", { id: "start-travel-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleArrived() {
    if (!canMarkArrived) return
    setBusy("arrived")
    try {
      const next = await markEmergencyArrived(alert.id)
      onChanged(next)
      toast.success("Marked arrived on scene", { id: "arrived" })
      confirm("Marked arrived on scene")
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : "Could not update arrival.", { id: "arrived-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleResolve() {
    if (!canResolve) return
    if (onResolveRequested) {
      onResolveRequested()
      return
    }
    setBusy("resolve")
    try {
      const next = await resolveEmergency(alert.id, "Incident resolved by responder.")
      onChanged(next)
      toast.success("Incident resolved", { id: "resolve" })
      confirm("Incident resolved")
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : "Could not resolve incident.", { id: "resolve-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleBackup() {
    if (!canRequestBackup) return
    setBusy("backup")
    try {
      const units = await getEmergencyBackupUnits(alert.id)
      const unit = units[0]
      if (!unit) throw new Error("No backup unit is configured for this emergency type.")
      const next = await requestEmergencyBackup(alert.id, {
        target_department_id: unit.id,
        reason: "Backup requested by responder.",
        urgency: "high",
        idempotency_key: crypto.randomUUID(),
      })
      onChanged(next)
      toast.success("Other responders alerted.", { id: "backup" })
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : "Could not request backup.", { id: "backup-err" })
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  return {
    busy,
    hasOwnAssignment,
    lastConfirmed,
    isCancelled,
    resolvedReached,
    canStartTravel,
    canMarkArrived,
    canResolve,
    canRequestBackup,
    holding,
    status: alert.status,
    handleStartTravel,
    handleArrived,
    handleResolve,
    handleBackup,
  }
}
