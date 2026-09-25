import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import {
  assignEmergency,
  reassignEmergency,
  removeEmergencyAssignment,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import {
  distanceKm,
  estimatedEtaMinutes,
  formatDistanceKm,
  responderName,
  unitLabel,
} from "./lib"

/** Responder shape both the Ops console and the Alerts Map can provide. */
export interface AssignableResponder {
  id: number
  full_name: string
  responder_unit: string | null
  is_on_duty?: boolean
  is_online?: boolean
  initials?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
}

type TeamAction =
  | { kind: "replace"; responder: AssignableResponder }
  | { kind: "remove"; assignmentId: number; responderName: string }

/**
 * The one responder-assignment UI. Roster (with remove), per-responder
 * Add support / Replace team, and the reason-gated confirm for both — used by
 * the Ops dispatch console and the Alerts Map detail panel so there is a
 * single authoritative way to staff an incident.
 */
export function ResponderAssignment({
  alert,
  responders,
  onChanged,
  maxResponders,
}: {
  alert: EmergencyAlert | null
  responders: AssignableResponder[]
  onChanged: (next: EmergencyAlert) => void
  /** Map panel keeps the list short; ops shows every eligible online responder. */
  maxResponders?: number
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState("")
  const [teamAction, setTeamAction] = useState<TeamAction | null>(null)
  const [teamReason, setTeamReason] = useState("")

  const activeAssignments =
    alert?.assignments?.filter(
      (assignment) =>
        !["cancelled", "declined", "resolved"].includes(assignment.status)
    ) ?? []

  const sorted = useMemo(() => {
    // Copy first — sorting the parent's array in place is the old bug this
    // consolidation was built to retire.
    const copy = [...responders]
    if (!alert) return copy
    return copy.sort((a, b) => {
      return (
        (distanceKm(alert.latitude, alert.longitude, a.latitude, a.longitude) ??
          999) -
        (distanceKm(alert.latitude, alert.longitude, b.latitude, b.longitude) ??
          999)
      )
    })
  }, [alert, responders])

  const visible = maxResponders ? sorted.slice(0, maxResponders) : sorted

  async function assign(responder: AssignableResponder) {
    if (!alert) return
    setBusyId(responder.id)
    try {
      const next = await assignEmergency(alert.id, responder.id)
      onChanged(next)
      toast.success(`Assigned to ${responder.full_name}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not assign responder."
      )
    } finally {
      setBusyId(null)
    }
  }

  async function confirmTeamAction() {
    if (!alert || !teamAction) return
    const reason = teamReason.trim()
    if (reason.length < 5) {
      toast.error(
        "Add a brief operational reason before changing the response team."
      )
      return
    }
    setBusyAction("team-change")
    try {
      const next =
        teamAction.kind === "replace"
          ? await reassignEmergency(
              alert.id,
              teamAction.responder.id,
              reason,
              alert.status_version
            )
          : await removeEmergencyAssignment(alert.id, teamAction.assignmentId, {
              reason,
              status_version: alert.status_version,
            })
      onChanged(next)
      toast.success(
        teamAction.kind === "replace"
          ? "Primary responder replaced"
          : "Support responder removed"
      )
      setTeamAction(null)
      setTeamReason("")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the response team."
      )
    } finally {
      setBusyAction("")
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        {alert?.assignments?.length ? (
          alert.assignments?.map((assignment) => {
            const active = !["cancelled", "declined", "resolved"].includes(
              assignment.status
            )
            return (
              <div
                key={assignment.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-control border border-card-line px-3 py-2",
                  !active && "bg-card-raised opacity-60"
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-brand-navy">
                    {responderName(assignment.responder)}
                  </p>
                </div>
                {active && activeAssignments.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busyAction)}
                    onClick={() => {
                      setTeamAction({
                        kind: "remove",
                        assignmentId: assignment.id,
                        responderName: responderName(assignment.responder),
                      })
                      setTeamReason("")
                    }}
                    className="h-8 border-severity-critical/40 text-xs text-severity-critical-ink hover:bg-severity-critical-surface"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            )
          })
        ) : (
          <p className="rounded-control bg-card-raised px-3 py-2 text-xs font-semibold text-subtle-foreground">
            No response team has been assigned.
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-brand-navy">
          Assign responder
        </p>
        <p className="mt-1 text-xs text-subtle-foreground">
          Online responders, nearest first. Distances are straight-line, so
          travel time is an estimate.
        </p>
      </div>

      <div className="grid gap-2">
        {visible.length === 0 ? (
          <p className="rounded-control bg-card-raised px-3 py-2 text-xs font-semibold text-subtle-foreground">
            No online responders with a recent location yet.
          </p>
        ) : (
          visible.map((responder) => {
            const km = alert
              ? distanceKm(
                  alert.latitude,
                  alert.longitude,
                  responder.latitude,
                  responder.longitude
                )
              : null
            const eta = estimatedEtaMinutes(km)
            const assigned = activeAssignments.some(
              (assignment) => assignment.responder.id === responder.id
            )
            return (
              <div
                key={responder.id}
                className={cn(
                  "rounded-control border p-3",
                  assigned
                    ? "border-brand-orange bg-brand-orange-soft"
                    : "border-card-line bg-card"
                )}
              >
                <div className="flex items-start gap-3">
                  <UserAvatar
                    user={responder}
                    online={responder.is_online}
                    showStatus={false}
                    size="sm"
                    className="!size-9 text-[14px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-brand-navy">
                      {responder.full_name}
                    </p>
                    {/* Distance and travel time are what decide who goes, so they
                      sit on the row. Availability comes from automatic
                      configured response unit and current location. */}
                    <p className="mt-0.5 text-xs text-subtle-foreground">
                      {unitLabel(responder.responder_unit)}
                      {km == null
                        ? " · location pending"
                        : ` · ${formatDistanceKm(km)}${eta ? ` · ~${eta} min` : ""}`}
                    </p>
                  </div>
                  {/* One primary action. "Replace team" used to sit beside it at
                    equal weight, so the destructive path and the ordinary one
                    looked like the same kind of choice. */}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!alert || Boolean(busyId) || assigned}
                    onClick={() => void assign(responder)}
                    className="h-8 shrink-0 bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong disabled:bg-card-line-strong disabled:text-subtle-foreground"
                  >
                    {busyId === responder.id
                      ? "Adding"
                      : assigned
                        ? "Assigned"
                        : "Dispatch"}
                  </Button>
                </div>
                {!assigned && activeAssignments.length > 0 ? (
                  <button
                    type="button"
                    disabled={!alert || Boolean(busyId)}
                    onClick={() => {
                      setTeamAction({ kind: "replace", responder })
                      setTeamReason("")
                    }}
                    className="mt-2 pl-12 text-[11px] font-semibold text-brand-orange transition-colors hover:text-brand-orange-strong disabled:text-subtle-foreground"
                  >
                    Replace the whole team with {responder.full_name}
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      {teamAction ? (
        <div className="rounded-control border border-severity-moderate/40 bg-severity-moderate-surface p-3">
          <p className="text-xs font-semibold text-severity-moderate-ink">
            {teamAction.kind === "replace"
              ? `Replace the active response team with ${teamAction.responder.full_name}?`
              : `Remove ${teamAction.responderName} from this response?`}
          </p>
          <label
            htmlFor={`dispatch-team-reason-${alert?.id ?? "none"}`}
            className="mt-2 block text-[11px] font-bold text-severity-moderate-ink"
          >
            Operational reason
          </label>
          <textarea
            id={`dispatch-team-reason-${alert?.id ?? "none"}`}
            value={teamReason}
            onChange={(event) => setTeamReason(event.target.value)}
            rows={2}
            maxLength={255}
            placeholder="Explain why this assignment is changing"
            className="mt-1 w-full resize-none rounded-panel border border-severity-moderate/40 bg-card px-3 py-2 text-xs text-brand-navy outline-none focus:border-brand-orange"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyAction === "team-change"}
              onClick={() => {
                setTeamAction(null)
                setTeamReason("")
              }}
            >
              Keep team
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                busyAction === "team-change" || teamReason.trim().length < 5
              }
              onClick={() => void confirmTeamAction()}
              className="bg-brand-orange text-white hover:bg-brand-orange-strong"
            >
              {busyAction === "team-change" ? "Updating" : "Confirm change"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
