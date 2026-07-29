import { useMemo, useState } from "react"
import { AlertTriangleIcon, PhoneCallIcon, RefreshCwIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { ActiveResponder } from "@/features/dashboard/api"
import {
  assignEmergency,
  assignEmergencyResponders,
  escalateOverdueEmergencies,
  getEmergency,
  reassignEmergency,
  removeEmergencyAssignment,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { distanceKm, hasAutoRoute, responderName, unitLabel } from "./lib"
import { SummaryBox } from "./queue-list"

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-panel border border-card-line bg-card-raised px-2 text-center text-xs font-semibold text-brand-navy transition-colors hover:border-brand-orange hover:text-brand-orange">
      <span className="text-brand-orange">{icon}</span>
      {label}
    </button>
  )
}

/**
 * Official dispatch console: response team, responder assignment, and quick actions.
 *
 * Reassign isolation: `confirmTeamAction` below is the ONLY call site for
 * `reassignEmergency` / `removeEmergencyAssignment` anywhere in the emergencies split.
 * The backend contract is a single `responder_id` (+ reason + status_version) —
 * already what `emergency-api.ts` sends; do not add a second reassign call site.
 */
export function DispatchPanel({
  alert,
  responders,
  onChanged,
}: {
  alert: EmergencyAlert | null
  responders: ActiveResponder[]
  onChanged: (alert: EmergencyAlert) => void
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState("")
  const [selectedResponderIds, setSelectedResponderIds] = useState<number[]>([])
  const [teamAction, setTeamAction] = useState<
    | { kind: "replace"; responder: ActiveResponder }
    | { kind: "remove"; assignmentId: number; responderName: string }
    | null
  >(null)
  const [teamReason, setTeamReason] = useState("")
  const activeAssignments = alert?.assignments.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []
  const sorted = useMemo(() => {
    if (!alert) return responders
    return responders.sort((a, b) => {
      return (distanceKm(alert.latitude, alert.longitude, a.current_latitude, a.current_longitude) ?? 999) -
        (distanceKm(alert.latitude, alert.longitude, b.current_latitude, b.current_longitude) ?? 999)
    })
  }, [alert, responders])

  // Selection state used to be cleared by an effect watching `alert?.id`, which
  // meant every incident switch rendered once with the previous incident's
  // selected responders before the reset landed. The call site now keys this
  // component by incident id, so React remounts it and local state starts
  // clean without a second render pass.

  async function assign(responder: ActiveResponder) {
    if (!alert) return
    setBusyId(responder.id)
    try {
      const next = await assignEmergency(alert.id, responder.id)
      onChanged(next)
      toast.success(`Assigned to ${responderName(responder)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign responder.")
    } finally {
      setBusyId(null)
    }
  }

  async function assignSelected() {
    if (!alert || selectedResponderIds.length === 0) return
    setBusyAction("assign-selected")
    try {
      const next = await assignEmergencyResponders(alert.id, selectedResponderIds)
      onChanged(next)
      toast.success("Selected responders assigned")
      setSelectedResponderIds([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign responders.")
    } finally {
      setBusyAction("")
    }
  }

  async function confirmTeamAction() {
    if (!alert || !teamAction) return
    const reason = teamReason.trim()
    if (reason.length < 5) {
      toast.error("Add a brief operational reason before changing the response team.")
      return
    }
    setBusyAction("team-change")
    try {
      const next = teamAction.kind === "replace"
        ? await reassignEmergency(alert.id, teamAction.responder.id, reason, alert.status_version)
        : await removeEmergencyAssignment(alert.id, teamAction.assignmentId, {
            reason,
            status_version: alert.status_version,
          })
      onChanged(next)
      toast.success(teamAction.kind === "replace" ? "Primary responder replaced" : "Support responder removed")
      setTeamAction(null)
      setTeamReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the response team.")
    } finally {
      setBusyAction("")
    }
  }

  async function escalate() {
    setBusyAction("escalate")
    try {
      const result = await escalateOverdueEmergencies(5)
      toast.success(result.escalated ? `${result.escalated} overdue emergency escalated` : "No overdue responders to escalate")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not escalate emergencies.")
    } finally {
      setBusyAction("")
    }
  }

  function callResident() {
    if (!alert?.reporter_phone) {
      toast.info("Resident phone is not available in this alert record yet.")
      return
    }
    window.location.href = `tel:${alert.reporter_phone}`
  }

  async function markFalseAlarm() {
    if (!alert) return
    setBusyAction("false-alarm")
    try {
      const next = await resolveEmergency(alert.id, "Marked as false alarm by official.")
      onChanged(next)
      toast.success("Emergency marked as false alarm")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark false alarm.")
    } finally {
      setBusyAction("")
    }
  }

  async function refreshTeam() {
    if (!alert) return
    setBusyAction("refresh-team")
    try {
      onChanged(await getEmergency(alert.id))
      toast.success("Team status refreshed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh team status.")
    } finally {
      setBusyAction("")
    }
  }

  return (
    <aside className="space-y-4">
      <section className="rounded-panel border border-card-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-navy">Response team</p>
            <p className="mt-1 text-xs font-semibold text-subtle-foreground">Add support, replace the team, or remove support with an audit reason.</p>
          </div>
          <span className="rounded-control bg-card-raised px-2 py-1 text-xs font-semibold text-brand-navy">{activeAssignments.length} active</span>
        </div>
        <div className="mt-3 grid gap-2">
          {alert?.assignments.length ? alert.assignments.map((assignment) => {
            const active = !["cancelled", "declined", "resolved"].includes(assignment.status)
            return (
              <div key={assignment.id} className={cn("flex items-center justify-between gap-2 rounded-panel border border-card-line px-3 py-2", !active && "bg-card-raised opacity-60")}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-brand-navy">{responderName(assignment.responder)}</p>
                  <p className="mt-0.5 text-[11px] font-semibold capitalize text-subtle-foreground">{assignment.status.replace(/_/g, " ")}</p>
                </div>
                {active && activeAssignments.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busyAction)}
                    onClick={() => {
                      setTeamAction({ kind: "remove", assignmentId: assignment.id, responderName: responderName(assignment.responder) })
                      setTeamReason("")
                    }}
                    className="h-8 border-severity-critical/40 text-xs text-severity-critical-ink hover:bg-severity-critical-surface"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            )
          }) : (
            <p className="rounded-panel bg-card-raised p-3 text-xs font-semibold text-subtle-foreground">No response team has been assigned.</p>
          )}
        </div>
        {teamAction ? (
          <div className="mt-3 rounded-panel border border-severity-moderate/40 bg-severity-moderate-surface p-3">
            <p className="text-xs font-semibold text-severity-moderate-ink">
              {teamAction.kind === "replace"
                ? `Replace the active response team with ${responderName(teamAction.responder)}?`
                : `Remove ${teamAction.responderName} from this response?`}
            </p>
            <label htmlFor={`dispatch-team-reason-${alert?.id ?? "none"}`} className="mt-2 block text-[11px] font-bold text-severity-moderate-ink">Operational reason</label>
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
              <Button type="button" size="sm" variant="outline" disabled={busyAction === "team-change"} onClick={() => { setTeamAction(null); setTeamReason("") }}>Keep team</Button>
              <Button type="button" size="sm" disabled={busyAction === "team-change" || teamReason.trim().length < 5} onClick={() => void confirmTeamAction()} className="bg-brand-navy text-white hover:bg-brand-navy">
                {busyAction === "team-change" ? "Updating" : "Confirm change"}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-panel border border-card-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-navy">Assign responder</p>
            <p className="mt-1 text-xs font-semibold text-subtle-foreground">
              Official dispatch rules decide eligibility. Manual assignment lists on-duty responders by distance.
            </p>
          </div>
          <UsersIcon className="size-5 text-brand-orange" />
        </div>
        <div className="mt-4 space-y-3">
          {sorted.length === 0 ? (
            <p className="rounded-panel bg-card-raised p-3 text-xs font-semibold text-subtle-foreground">No on-duty responders with live location yet.</p>
          ) : sorted.map((responder) => {
            const km = alert ? distanceKm(alert.latitude, alert.longitude, responder.current_latitude, responder.current_longitude) : null
            const assigned = activeAssignments.some((assignment) => assignment.responder.id === responder.id)
            const selected = selectedResponderIds.includes(responder.id)
            return (
              <div key={responder.id} className={cn("rounded-panel border p-3", assigned ? "border-brand-orange bg-brand-orange-soft" : "border-card-line bg-card")}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={assigned}
                    onChange={(event) => {
                      setSelectedResponderIds((current) => event.target.checked ? [...current, responder.id] : current.filter((id) => id !== responder.id))
                    }}
                    className="mt-3"
                    aria-label={`Select ${responderName(responder)}`}
                  />
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-semibold text-white">
                    {responder.initials || responderName(responder).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-brand-navy">{responderName(responder)}</p>
                    <p className="mt-1 text-xs font-semibold text-subtle-foreground">
                      {unitLabel[responder.responder_unit || ""]} · {km == null ? "location pending" : `${km.toFixed(1)} km away`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {responder.is_on_duty ? <span className="rounded-full bg-status-closed-surface px-2 py-1 text-[10px] font-semibold text-status-closed-ink">On duty</span> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!alert || Boolean(busyId) || assigned}
                    onClick={() => assign(responder)}
                    className="bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong disabled:bg-card-line-strong disabled:text-subtle-foreground"
                  >
                    {busyId === responder.id ? "Adding" : assigned ? "Assigned" : "Add support"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!alert || Boolean(busyId) || assigned || activeAssignments.length === 0}
                    onClick={() => {
                      setTeamAction({ kind: "replace", responder })
                      setTeamReason("")
                    }}
                    className="border-card-line-strong text-brand-orange"
                  >
                    Replace team
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        {sorted.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            disabled={!alert || selectedResponderIds.length === 0 || busyAction === "assign-selected"}
            onClick={() => void assignSelected()}
            className="mt-3 w-full"
          >
            {busyAction === "assign-selected" ? "Assigning selected" : `Assign selected (${selectedResponderIds.length})`}
          </Button>
        ) : null}
      </section>

      <section className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-sm font-semibold text-brand-navy">Quick actions</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ActionButton icon={<PhoneCallIcon className="size-4" />} label="Call resident" onClick={callResident} />
          <ActionButton icon={<RefreshCwIcon className="size-4" />} label={busyAction === "refresh-team" ? "Refreshing" : "Refresh team"} onClick={() => void refreshTeam()} />
          <ActionButton icon={<AlertTriangleIcon className="size-4" />} label={busyAction === "escalate" ? "Escalating" : "Escalate"} onClick={() => void escalate()} />
          <ActionButton icon={<ShieldCheckIcon className="size-4" />} label={busyAction === "false-alarm" ? "Closing" : "False alarm"} onClick={() => void markFalseAlarm()} />
        </div>
      </section>

      <section className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-sm font-semibold text-brand-navy">Incident summary</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SummaryBox label="Active" value={alert ? "1" : "0"} />
          <SummaryBox label="Responders" value={responders.length.toString()} />
          <SummaryBox label="Auto route" value={alert && hasAutoRoute(alert) ? "Yes" : "No"} />
          <SummaryBox label="Dispatch rule" value={alert ? "Official config" : "—"} />
        </div>
      </section>
    </aside>
  )
}
