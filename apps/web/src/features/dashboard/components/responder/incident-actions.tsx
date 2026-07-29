import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  CheckIcon,
  LoaderCircleIcon,
  MapPinIcon,
  NavigationIcon,
  RadioIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  acknowledgeEmergency,
  markEmergencyArrived,
  requestEmergencyBackup,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"

type StepKey = "acknowledge" | "en_route" | "arrived" | "resolved"
type StepState = "done" | "current" | "upcoming"

const STEP_DEFS: Array<{ key: StepKey; label: string; icon: LucideIcon }> = [
  { key: "acknowledge", label: "Acknowledge", icon: CheckIcon },
  { key: "en_route", label: "En route", icon: NavigationIcon },
  { key: "arrived", label: "Arrived", icon: MapPinIcon },
  { key: "resolved", label: "Resolved", icon: ShieldCheckIcon },
]

/**
 * 4-step responder stepper — Acknowledge → En route → Arrived → Resolved.
 *
 * Enable/disable matrix (see task-C-report.md for the full write-up):
 *  - Acknowledge: alert.status === "routed" AND own assignment is un-acknowledged.
 *    Posts POST /emergencies/{id}/acknowledge/, optimistic-updates the alert
 *    locally, then triggers a full refetch (per the brief).
 *  - En route: display-only — no button. Flips automatically once a location
 *    ping lands (existing auto-ping loop in the page already does this,
 *    including the server's auto-acknowledge-on-first-ping fallback).
 *  - Arrived: existing `markEmergencyArrived` gating — alert.status is
 *    "en_route" or "nearby".
 *  - Resolved: enabled once the Arrived step is complete (alert.status ===
 *    "arrived") — a deliberate tightening vs. the looser
 *    `components/emergencies/responder-panels.tsx` gating (which also allows
 *    resolving straight from en_route/nearby) so the stepper reads as a
 *    strictly sequential flow. See report for rationale.
 */
export function IncidentActions({
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
  const enRouteReached = ["en_route", "nearby", "arrived", "resolved"].includes(alert.status)
  const arrivedReached = ["arrived", "resolved"].includes(alert.status)
  const resolvedReached = alert.status === "resolved"

  const stepState = (key: StepKey): StepState => {
    if (key === "acknowledge") {
      if (acknowledged) return "done"
      return isCancelled ? "upcoming" : "current"
    }
    if (key === "en_route") {
      if (enRouteReached) return "done"
      return acknowledged && !isCancelled ? "current" : "upcoming"
    }
    if (key === "arrived") {
      if (arrivedReached) return "done"
      return enRouteReached && !isCancelled ? "current" : "upcoming"
    }
    // resolved
    if (resolvedReached) return "done"
    return arrivedReached && !isCancelled ? "current" : "upcoming"
  }

  const canAcknowledge =
    !isCancelled && alert.status === "routed" && ownAssignment?.status === "assigned" && !acknowledged
  const canMarkArrived = !isCancelled && ["en_route", "nearby"].includes(alert.status)
  const canResolve = !isCancelled && alert.status === "arrived"
  const canRequestBackup = !isCancelled && alert.status !== "resolved"

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
      toast.success("Dispatch acknowledged")
    } catch (err) {
      // Revert the optimistic guess immediately, then resync to whatever the
      // server actually has — a 409 here usually means the status already
      // moved on (a concurrent backup responder acknowledged first, or a
      // location ping auto-acknowledged it), so the stale local snapshot
      // must not be left in place: re-tapping it would just 409 forever.
      onChanged(previous)
      toast.error(err instanceof Error ? err.message : "Could not acknowledge dispatch.")
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
      toast.success("Marked arrived on scene")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update arrival.")
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
      toast.success("Incident resolved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve incident.")
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  async function handleBackup() {
    if (!canRequestBackup) return
    setBusy("backup")
    try {
      const next = await requestEmergencyBackup(alert.id)
      onChanged(next)
      const teamSize = next.assignments?.length ?? 0
      toast.success(
        teamSize > 1
          ? `Backup responder routed. ${teamSize} responders are now assigned.`
          : "Backup request recorded.",
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not request backup.")
      await onRefresh().catch(() => {})
    } finally {
      setBusy("")
    }
  }

  const enRouteEvent = alert.status_events.find((event) => event.status === "en_route")

  return (
    <div className="space-y-3">
      <ol className="space-y-2" aria-label="Dispatch progress">
        {STEP_DEFS.map((step, index) => {
          const state = stepState(step.key)
          const Icon = step.icon
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                className={cn(
                  "relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black",
                  state === "done" && "border-brand-orange bg-brand-orange text-white",
                  state === "current" && "border-brand-orange bg-brand-orange-soft text-brand-orange",
                  state === "upcoming" && "border-neutral-200 bg-white text-neutral-400",
                )}
              >
                {state === "done" ? <CheckIcon className="size-4" /> : <Icon className="size-4" />}
                {index < STEP_DEFS.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-1/2 top-full h-2 w-0.5 -translate-x-1/2",
                      state === "done" ? "bg-brand-orange" : "bg-neutral-200",
                    )}
                  />
                ) : null}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <p
                  className={cn(
                    "text-sm font-black",
                    state === "upcoming" ? "text-neutral-400" : "text-brand-navy",
                  )}
                >
                  {step.label}
                </p>
                {step.key === "en_route" ? (
                  <p className="mt-0.5 text-xs font-semibold text-neutral-500">
                    {enRouteReached
                      ? enRouteEvent
                        ? `Confirmed en route at ${new Date(enRouteEvent.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : "Confirmed en route"
                      : state === "current"
                        ? "Sending your GPS automatically — this advances once a location ping lands."
                        : "Waiting on acknowledgement first."}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-neutral-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {canAcknowledge ? (
          <Button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void handleAcknowledge()}
            className="w-full bg-brand-orange text-white hover:bg-brand-orange/90"
          >
            {busy === "acknowledge" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
            Acknowledge dispatch
          </Button>
        ) : null}

        {!canAcknowledge && !canMarkArrived && !canResolve && !isCancelled && !resolvedReached ? (
          <Button type="button" disabled className="w-full bg-brand-orange-soft text-brand-orange">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Waiting for your GPS to confirm en route…
          </Button>
        ) : null}

        {canMarkArrived ? (
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void handleArrived()}
            className="w-full"
          >
            {busy === "arrived" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <MapPinIcon className="size-4" />}
            I have arrived on scene
          </Button>
        ) : null}

        {canResolve ? (
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void handleResolve()}
            className="w-full"
          >
            {busy === "resolve" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ShieldCheckIcon className="size-4" />}
            Resolve incident
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(busy) || !canRequestBackup}
          onClick={() => void handleBackup()}
          className="w-full"
        >
          {busy === "backup" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RadioIcon className="size-4" />}
          Request backup
        </Button>
      </div>
    </div>
  )
}
