import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  LocateFixedIcon,
  MapPinIcon,
  NavigationIcon,
  PhoneCallIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SirenIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useSearchParams } from "react-router-dom"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getOfficialDashboardSummary,
  getResponderDashboardSummary,
  listActiveResponders,
  type ActiveResponder,
  type OfficialRoleSummary,
  type PublicUser,
  type ResponderRoleSummary,
} from "@/features/dashboard/api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import {
  assignEmergency,
  assignEmergencyResponders,
  escalateOverdueEmergencies,
  getEmergency,
  listAssignedEmergencies,
  listEmergencyAppeals,
  listEmergencyQueue,
  markEmergencyArrived,
  reassignEmergency,
  removeEmergencyAssignment,
  reviewEmergencyAppeal,
  resolveEmergency,
  sendEmergencyLocationPing,
  updateEmergencyDuty,
  type EmergencyAlert,
  type EmergencyAppeal,
  type EmergencyStatus,
  type EmergencyType,
} from "@/features/dashboard/emergency-api"

type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

const statusLabel: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Routed",
  acknowledged: "Responder routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

const unitLabel: Record<ResponderUnit, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  other: "Responder",
  "": "Responder",
}

const eligibleUnits: Record<EmergencyType, ResponderUnit[]> = {
  medical: ["bhw"],
  fire: ["bdrrmo"],
  crime: ["tanod"],
  disaster: ["bdrrmo"],
  other: ["tanod", "bhw", "bdrrmo"],
}

const statusSteps: EmergencyStatus[] = ["submitted", "routed", "en_route", "arrived", "resolved"]

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function statusClass(status: EmergencyStatus) {
  if (status === "submitted") return "border-red-200 bg-red-50 text-red-700"
  if (status === "routed" || status === "acknowledged") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "en_route" || status === "nearby") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "arrived" || status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

function emergencyTone(type: EmergencyType) {
  if (type === "medical") return "Medical response"
  if (type === "crime") return "Tanod response"
  if (type === "fire") return "Fire/disaster response"
  if (type === "disaster") return "Disaster response"
  return "General response"
}

function distanceKm(aLat?: string | number | null, aLng?: string | number | null, bLat?: string | number | null, bLng?: string | number | null) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function responderName(user?: PublicUser | null) {
  return user?.full_name || "Responder"
}

function hasAutoRoute(alert: EmergencyAlert) {
  return alert.status_events.some((event) => event.note.toLowerCase().includes("auto-routed"))
}

function StatusRail({ status }: { status: EmergencyStatus }) {
  const effectiveStatus = status === "acknowledged" ? "routed" : status
  const index = effectiveStatus === "cancelled" ? -1 : statusSteps.indexOf(effectiveStatus)
  return (
    <div className="grid grid-cols-6 gap-1">
      {statusSteps.map((step, stepIndex) => {
        const done = index > stepIndex
        const current = index === stepIndex
        return (
          <div key={step} className="flex min-w-0 flex-col items-center gap-2">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-full border text-[11px] font-black",
                done && "border-[#07145f] bg-[#07145f] text-white",
                current && "border-[#ff6a1a] bg-[#ff6a1a] text-white",
                status === "cancelled" && stepIndex === 0 && "border-red-600 bg-red-600 text-white",
                !done && !current && status !== "cancelled" && "border-slate-200 bg-white text-slate-400",
              )}
            >
              {done ? <CheckCircleIcon className="size-4" /> : stepIndex + 1}
            </div>
            <span className="truncate text-[10px] font-bold capitalize text-[#68739c]">{statusLabel[step]}</span>
          </div>
        )
      })}
    </div>
  )
}

function QueueCard({
  alert,
  active,
  onClick,
}: {
  alert: EmergencyAlert
  active: boolean
  onClick: () => void
}) {
  const assigned = alert.current_assignment?.responder
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border bg-white p-4 text-left transition-colors hover:border-[#ff6a1a]",
        active ? "border-[#ff6a1a] shadow-sm ring-2 ring-[#ff6a1a]/10" : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
            <SirenIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black capitalize text-[#07145f]">{alert.type} emergency</p>
            <p className="mt-1 truncate text-xs font-semibold text-[#43507f]">{alert.address || alert.barangay}</p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black", statusClass(alert.status))}>
          {statusLabel[alert.status]}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#68739c]">{alert.note || "No note provided."}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-bold text-[#8b96b8]">
        <span>#{alert.id} · {formatTime(alert.created_at)}</span>
        <span className="truncate text-[#07145f]">{assigned ? responderName(assigned) : "Unassigned"}</span>
      </div>
    </button>
  )
}

function IncidentMap({ alert }: { alert: EmergencyAlert }) {
  const ping = alert.current_assignment?.last_location
  return (
    <div className="relative min-h-[250px] overflow-hidden rounded-2xl border border-slate-200 bg-[#eef3fb] p-4">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,20,95,0.06)_1px,transparent_1px),linear-gradient(rgba(7,20,95,0.06)_1px,transparent_1px)] bg-[size:34px_34px]" />
      <div className="absolute left-[18%] top-[58%] size-5 rounded-full border-4 border-white bg-red-600 shadow" />
      {ping ? <div className="absolute right-[24%] top-[28%] size-5 rounded-full border-4 border-white bg-[#07145f] shadow" /> : null}
      {ping ? (
        <div className="absolute left-[22%] right-[28%] top-[43%] h-1 -rotate-[18deg] rounded-full border-t-2 border-dashed border-[#ff6a1a]" />
      ) : null}
      <div className="relative z-10 flex h-full min-h-[218px] flex-col justify-between">
        <div className="w-fit rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#07145f] shadow-sm">
          Barangay Marikina Heights
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[11px] font-black uppercase text-red-600">Resident pin</p>
            <p className="mt-1 text-xs font-bold text-[#07145f]">{Number(alert.latitude).toFixed(5)}, {Number(alert.longitude).toFixed(5)}</p>
          </div>
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[11px] font-black uppercase text-[#07145f]">Responder route</p>
            <p className="mt-1 text-xs font-bold text-[#43507f]">{ping ? "Live ping received" : "Waiting for GPS ping"}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function IncidentBoard({ alert }: { alert: EmergencyAlert | null }) {
  if (!alert) {
    return (
      <section className="flex min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <div>
          <ShieldCheckIcon className="mx-auto size-10 text-[#07145f]" />
          <p className="mt-3 text-sm font-black text-[#07145f]">Select an emergency</p>
          <p className="mt-1 text-xs text-[#68739c]">Review location, timeline, assignment, and response status.</p>
        </div>
      </section>
    )
  }

  const assigned = alert.current_assignment?.responder
  const latest = alert.status_events.at(-1)
  const activeTeam = alert.assignments?.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-red-100 px-3 py-1 text-[11px] font-black uppercase text-red-700">Emergency alert #{alert.id}</span>
              <span className="rounded-full bg-[#fff0e8] px-3 py-1 text-[11px] font-black text-[#b9470b]">{emergencyTone(alert.type)}</span>
              {hasAutoRoute(alert) ? <span className="rounded-full bg-[#eaf0ff] px-3 py-1 text-[11px] font-black text-[#07145f]">Auto-routed</span> : null}
            </div>
            <h2 className="mt-3 text-2xl font-black capitalize text-[#07145f]">{alert.type} emergency</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#43507f]">{alert.note || "No note provided."}</p>
          </div>
          <span className={cn("w-fit rounded-full border px-3 py-1.5 text-xs font-black", statusClass(alert.status))}>
            {statusLabel[alert.status]}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <InfoTile icon={<MapPinIcon className="size-4" />} label="Location" value={alert.address || alert.barangay} detail={`${Number(alert.latitude).toFixed(5)}, ${Number(alert.longitude).toFixed(5)}`} />
          <InfoTile icon={<UserCheckIcon className="size-4" />} label="Responder" value={assigned ? responderName(assigned) : "Waiting for dispatch"} detail={assigned ? unitLabel[assigned.responder_unit || ""] : "No assignment yet"} />
          <InfoTile icon={<ClockIcon className="size-4" />} label="Latest update" value={latest ? statusLabel[latest.status] : "Submitted"} detail={latest ? formatTime(latest.created_at) : formatTime(alert.created_at)} />
        </div>
      </div>

      {alert.witness_notification_summary ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-[#07145f]">Nearby resident safety notice</p>
              <p className="mt-1 text-xs leading-5 text-[#43507f]">
                {alert.witness_notification_summary.triggered
                  ? "A privacy-limited safety notification was sent. Reporter identity, exact coordinates, and media were not included."
                  : "No eligible verified residents were within the configured notification radius."}
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-[#2447b3]">
              {alert.witness_notification_summary.recipient_count} notified
            </span>
          </div>
          {alert.witness_notification_summary.triggered ? (
            <div className="mt-3 grid gap-2 text-xs font-semibold text-[#43507f] sm:grid-cols-2 lg:grid-cols-4">
              <span>{alert.witness_notification_summary.in_app_delivered_count} in-app delivered</span>
              <span>{alert.witness_notification_summary.read_count} opened</span>
              <span>
                {alert.witness_notification_summary.push_delivered_count} push delivered
                {alert.witness_notification_summary.push_failure_count ? ` · ${alert.witness_notification_summary.push_failure_count} failed` : ""}
              </span>
              <span>Nearest: {alert.witness_notification_summary.nearest_distance_meters ?? "—"} m</span>
              <span>Farthest: {alert.witness_notification_summary.farthest_distance_meters ?? "—"} m</span>
              {alert.witness_notification_summary.push_status_counts.not_configured ? (
                <span className="text-amber-700">Browser push is not configured for {alert.witness_notification_summary.push_status_counts.not_configured} recipient{alert.witness_notification_summary.push_status_counts.not_configured === 1 ? "" : "s"}.</span>
              ) : null}
              {alert.witness_notification_summary.push_status_counts.not_subscribed ? (
                <span>{alert.witness_notification_summary.push_status_counts.not_subscribed} recipient{alert.witness_notification_summary.push_status_counts.not_subscribed === 1 ? "" : "s"} not subscribed to push.</span>
              ) : null}
              {alert.witness_notification_summary.push_status_counts.disabled ? (
                <span>{alert.witness_notification_summary.push_status_counts.disabled} recipient{alert.witness_notification_summary.push_status_counts.disabled === 1 ? "" : "s"} disabled push.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <IncidentMap alert={alert} />

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-black text-[#07145f]">Response status</p>
        <div className="mt-4">
          <StatusRail status={alert.status} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-black text-[#07145f]">Incident timeline</p>
        <div className="mt-4 space-y-4">
          {alert.status_events.map((event) => (
            <div key={event.id} className="flex gap-3">
              <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#07145f] text-white">
                <ClockIcon className="size-3.5" />
              </div>
              <div>
                <p className="text-xs font-black text-[#07145f]">{statusLabel[event.status]}</p>
                <p className="mt-1 text-xs leading-5 text-[#68739c]">
                  {event.note || "Status updated."} · {formatTime(event.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shared group chat: resident + all assigned responders (same thread) */}
      {(activeTeam.length > 0 || alert.current_assignment) &&
      alert.status !== "submitted" ? (
        <EmergencyChatPanel
          alertId={alert.id}
          open
          theme="light"
          disabled={alert.status === "cancelled" || alert.status === "resolved"}
          participantHint={
            activeTeam.length
              ? `Group · resident + ${activeTeam.length} responder${activeTeam.length === 1 ? "" : "s"}`
              : "Group · resident + assigned responders"
          }
          className="min-h-[320px]"
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-[#68739c]">
          Live chat opens once a responder is assigned. Everyone on the assignment list shares one group thread with the resident.
        </div>
      )}
    </section>
  )
}

function InfoTile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
      <p className="flex items-center gap-2 text-xs font-bold uppercase text-[#68739c]">
        <span className="text-[#ff6a1a]">{icon}</span>
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-black text-[#07145f]">{value}</p>
      <p className="mt-1 truncate text-xs text-[#68739c]">{detail}</p>
    </div>
  )
}

function DispatchPanel({
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
  const eligible = alert ? eligibleUnits[alert.type] : []
  const activeAssignments = alert?.assignments.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []
  const sorted = useMemo(() => {
    if (!alert) return responders
    return responders.filter((responder) => eligible.includes(responder.responder_unit || "")).sort((a, b) => {
      return (distanceKm(alert.latitude, alert.longitude, a.current_latitude, a.current_longitude) ?? 999) -
        (distanceKm(alert.latitude, alert.longitude, b.current_latitude, b.current_longitude) ?? 999)
    })
  }, [alert, eligible, responders])

  useEffect(() => {
    setSelectedResponderIds([])
    setTeamAction(null)
    setTeamReason("")
  }, [alert?.id])

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
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-[#07145f]">Response team</p>
            <p className="mt-1 text-xs font-semibold text-[#68739c]">Add support, replace the team, or remove support with an audit reason.</p>
          </div>
          <span className="rounded-md bg-[#eaf0ff] px-2 py-1 text-xs font-black text-[#07145f]">{activeAssignments.length} active</span>
        </div>
        <div className="mt-3 grid gap-2">
          {alert?.assignments.length ? alert.assignments.map((assignment) => {
            const active = !["cancelled", "declined", "resolved"].includes(assignment.status)
            return (
              <div key={assignment.id} className={cn("flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2", !active && "bg-slate-50 opacity-60")}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-[#07145f]">{responderName(assignment.responder)}</p>
                  <p className="mt-0.5 text-[11px] font-semibold capitalize text-[#68739c]">{assignment.status.replace(/_/g, " ")}</p>
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
                    className="h-8 border-red-200 text-xs text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            )
          }) : (
            <p className="rounded-xl bg-[#f8fafc] p-3 text-xs font-semibold text-[#68739c]">No response team has been assigned.</p>
          )}
        </div>
        {teamAction ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-black text-amber-950">
              {teamAction.kind === "replace"
                ? `Replace the active response team with ${responderName(teamAction.responder)}?`
                : `Remove ${teamAction.responderName} from this response?`}
            </p>
            <label htmlFor={`dispatch-team-reason-${alert?.id ?? "none"}`} className="mt-2 block text-[11px] font-bold text-amber-900">Operational reason</label>
            <textarea
              id={`dispatch-team-reason-${alert?.id ?? "none"}`}
              value={teamReason}
              onChange={(event) => setTeamReason(event.target.value)}
              rows={2}
              maxLength={255}
              placeholder="Explain why this assignment is changing"
              className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-[#07145f] outline-none focus:border-[#ff6a1a]"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busyAction === "team-change"} onClick={() => { setTeamAction(null); setTeamReason("") }}>Keep team</Button>
              <Button type="button" size="sm" disabled={busyAction === "team-change" || teamReason.trim().length < 5} onClick={() => void confirmTeamAction()} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">
                {busyAction === "team-change" ? "Updating" : "Confirm change"}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-[#07145f]">Assign responder</p>
            <p className="mt-1 text-xs font-semibold text-[#68739c]">
              Eligible: {eligible.length ? eligible.map((unit) => unitLabel[unit]).join(", ") : "Select an incident"}
            </p>
          </div>
          <UsersIcon className="size-5 text-[#ff6a1a]" />
        </div>
        <div className="mt-4 space-y-3">
          {sorted.length === 0 ? (
            <p className="rounded-xl bg-[#f8fafc] p-3 text-xs font-semibold text-[#68739c]">No on-duty responders with live location yet.</p>
          ) : sorted.map((responder) => {
            const km = alert ? distanceKm(alert.latitude, alert.longitude, responder.current_latitude, responder.current_longitude) : null
            const assigned = activeAssignments.some((assignment) => assignment.responder.id === responder.id)
            const selected = selectedResponderIds.includes(responder.id)
            return (
              <div key={responder.id} className={cn("rounded-xl border p-3", assigned ? "border-[#ff6a1a] bg-[#fff7f1]" : "border-slate-200 bg-white")}>
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
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#07145f] text-xs font-black text-white">
                    {responder.initials || responderName(responder).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-[#07145f]">{responderName(responder)}</p>
                    <p className="mt-1 text-xs font-semibold text-[#68739c]">
                      {unitLabel[responder.responder_unit || ""]} · {km == null ? "location pending" : `${km.toFixed(1)} km away`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {eligible.includes(responder.responder_unit || "") ? <span className="rounded-full bg-[#eaf0ff] px-2 py-1 text-[10px] font-black text-[#07145f]">Suitable unit</span> : null}
                      {responder.is_on_duty ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">On duty</span> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!alert || Boolean(busyId) || assigned}
                    onClick={() => assign(responder)}
                    className="bg-[#ff6a1a] text-white hover:bg-[#e85f17] disabled:bg-slate-200 disabled:text-slate-500"
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
                    className="border-[#b9c9f4] text-[#2447b3]"
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-black text-[#07145f]">Quick actions</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ActionButton icon={<PhoneCallIcon className="size-4" />} label="Call resident" onClick={callResident} />
          <ActionButton icon={<RefreshCwIcon className="size-4" />} label={busyAction === "refresh-team" ? "Refreshing" : "Refresh team"} onClick={() => void refreshTeam()} />
          <ActionButton icon={<AlertTriangleIcon className="size-4" />} label={busyAction === "escalate" ? "Escalating" : "Escalate"} onClick={() => void escalate()} />
          <ActionButton icon={<ShieldCheckIcon className="size-4" />} label={busyAction === "false-alarm" ? "Closing" : "False alarm"} onClick={() => void markFalseAlarm()} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-black text-[#07145f]">Incident summary</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SummaryBox label="Active" value={alert ? "1" : "0"} />
          <SummaryBox label="Responders" value={responders.length.toString()} />
          <SummaryBox label="Auto route" value={alert && hasAutoRoute(alert) ? "Yes" : "No"} />
          <SummaryBox label="Eligible units" value={eligible.length ? eligible.map((unit) => unitLabel[unit]).join(", ") : "—"} />
        </div>
      </section>
    </aside>
  )
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-[#f8fafc] px-2 text-center text-xs font-black text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]">
      <span className="text-[#ff6a1a]">{icon}</span>
      {label}
    </button>
  )
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] p-3">
      <p className="text-[10px] font-black uppercase text-[#68739c]">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-[#07145f]">{value}</p>
    </div>
  )
}

function DutyPanel({
  user,
}: {
  user: ReturnType<typeof useAuthSession>["user"]
}) {
  const [unit, setUnit] = useState<ResponderUnit>((user?.responder_unit as ResponderUnit) || "tanod")
  const [isOnDuty, setIsOnDuty] = useState(Boolean(user?.is_on_duty))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUnit((user?.responder_unit as ResponderUnit) || "tanod")
      setIsOnDuty(Boolean(user?.is_on_duty))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user?.responder_unit, user?.is_on_duty])

  async function updateDuty(nextDuty = isOnDuty, nextUnit = unit, requireGps = nextDuty) {
    if (requireGps && !navigator.geolocation) {
      toast.error("GPS is required before going on duty.")
      return
    }
    setBusy(true)
    const send = async (latitude?: number, longitude?: number) => {
      const next = await updateEmergencyDuty({ is_on_duty: nextDuty, responder_unit: nextUnit, latitude, longitude })
      setIsOnDuty(next.is_on_duty)
      setUnit((next.responder_unit as ResponderUnit) || nextUnit)
      toast.success(next.is_on_duty ? "Duty status live" : "You are off duty")
    }
    try {
      if (!requireGps) {
        await send()
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          void send(latitude, longitude).catch((error) => toast.error(error instanceof Error ? error.message : "Duty update failed.")).finally(() => setBusy(false))
        },
        () => {
          setBusy(false)
          toast.error("Allow location access so dispatch can route nearest responders.")
        },
        { enableHighAccuracy: true, timeout: 10000 },
      )
      return
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duty update failed.")
    } finally {
      if (!requireGps) setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Responder duty</p>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">Go on duty with GPS so auto-routing can find you.</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-[11px] font-black", isOnDuty ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
          {isOnDuty ? "On duty" : "Off duty"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <select
          value={unit}
          onChange={(event) => {
            const next = event.target.value as ResponderUnit
            setUnit(next)
            if (isOnDuty) void updateDuty(true, next, true)
          }}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#07145f] outline-none focus:border-[#ff6a1a]"
        >
          <option value="tanod">Barangay Tanod - crime/security</option>
          <option value="bhw">BHW - medical</option>
          <option value="bdrrmo">BDRRMO - fire/disaster</option>
          <option value="other">Other responder</option>
        </select>
        <Button
          type="button"
          disabled={busy}
          onClick={() => void updateDuty(!isOnDuty, unit, !isOnDuty)}
          className={cn(isOnDuty ? "bg-slate-700 hover:bg-slate-800" : "bg-[#ff6a1a] hover:bg-[#e85f17]", "text-white")}
        >
          <LocateFixedIcon className="size-4" />
          {busy ? "Updating" : isOnDuty ? "Go off duty" : "Go on duty"}
        </Button>
      </div>
    </section>
  )
}

function ResponderActions({ alert, onChanged }: { alert: EmergencyAlert; onChanged: (alert: EmergencyAlert) => void }) {
  const [busy, setBusy] = useState("")

  async function run(label: string, fn: () => Promise<EmergencyAlert>) {
    setBusy(label)
    try {
      const next = await fn()
      onChanged(next)
      toast.success("Emergency updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Emergency update failed.")
    } finally {
      setBusy("")
    }
  }

  function ping() {
    if (!navigator.geolocation) {
      toast.error("GPS is not available on this device.")
      return
    }
    setBusy("ping")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        void run("ping", () => sendEmergencyLocationPing(alert.id, { latitude, longitude, accuracy }))
      },
      () => {
        setBusy("")
        toast.error("Allow location access to send responder GPS.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-[#07145f]">Responder actions</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          disabled={Boolean(busy) || !["routed", "acknowledged", "en_route", "nearby"].includes(alert.status)}
          onClick={ping}
          className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
        >
          <LocateFixedIcon className="size-4" />
          {busy === "ping" ? "Sending GPS" : "Mark en route"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(busy) || !["en_route", "nearby", "acknowledged"].includes(alert.status)}
          onClick={() => run("arrived", () => markEmergencyArrived(alert.id))}
          variant="outline"
        >
          <NavigationIcon className="size-4" />
          {busy === "arrived" ? "Updating" : "I have arrived on scene"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(busy) || !["arrived", "en_route", "nearby"].includes(alert.status)}
          onClick={() => run("resolve", () => resolveEmergency(alert.id, "Incident resolved by responder."))}
          variant="outline"
        >
          <ShieldCheckIcon className="size-4" />
          {busy === "resolve" ? "Resolving" : "Resolve incident"}
        </Button>
      </div>
    </div>
  )
}

function EmergencyAppealsPanel({ appeals, onUpdated }: { appeals: EmergencyAppeal[]; onUpdated: (appeal: EmergencyAppeal) => void }) {
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)

  async function decide(appeal: EmergencyAppeal, status: "approved" | "denied") {
    const decisionNote = (notes[appeal.id] || "").trim()
    if (decisionNote.length < 5) {
      toast.error("Add a clear decision note before completing the review.")
      return
    }
    setBusy(appeal.id)
    try {
      onUpdated(await reviewEmergencyAppeal(appeal.id, { status, decision_note: decisionNote }))
      toast.success(`Emergency review request ${status}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this emergency request.")
    } finally {
      setBusy(null)
    }
  }

  if (appeals.length === 0) return null
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-[#07145f]">Emergency review requests</p><p className="mt-1 text-xs font-semibold text-[#68739c]">Decide resident requests from cancelled or disputed incidents with an auditable note.</p></div><span className="rounded-md bg-white px-2.5 py-1 text-xs font-black text-amber-800">{appeals.filter((item) => item.status === "submitted").length} pending</span></div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {appeals.map((appeal) => <article key={appeal.id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black capitalize text-[#07145f]">{appeal.alert_type || "Emergency"} incident</p><p className="mt-1 text-xs font-semibold text-[#68739c]">{appeal.appellant.full_name} · {formatTime(appeal.created_at)}</p></div><span className="rounded-md border border-[#dfe7f5] px-2 py-1 text-[10px] font-black uppercase text-[#43507f]">{appeal.status}</span></div><p className="mt-3 text-xs font-semibold leading-5 text-[#43507f]">{appeal.reason}</p>{appeal.status === "submitted" ? <><textarea rows={2} maxLength={255} value={notes[appeal.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [appeal.id]: event.target.value }))} placeholder="Decision note" className="mt-3 w-full resize-none rounded-xl border border-[#cbd8ee] p-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" /><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" disabled={busy === appeal.id} onClick={() => void decide(appeal, "denied")} className="border-red-200 text-red-700">Deny</Button><Button type="button" size="sm" disabled={busy === appeal.id} onClick={() => void decide(appeal, "approved")} className="bg-emerald-600 text-white">Approve</Button></div></> : appeal.decision_note ? <p className="mt-3 rounded-lg bg-[#f8fafc] p-3 text-xs font-semibold text-[#43507f]">Decision: {appeal.decision_note}</p> : null}</article>)}
      </div>
    </section>
  )
}

export default function EmergenciesPage() {
  usePageTitle("Emergency Ops")
  const { user } = useAuthSession()
  const [searchParams] = useSearchParams()
  const requestedAlertId = Number(searchParams.get("alert")) || null
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [responders, setResponders] = useState<ActiveResponder[]>([])
  const [appeals, setAppeals] = useState<EmergencyAppeal[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [summary, setSummary] = useState<OfficialRoleSummary | ResponderRoleSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const isOfficial = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponder = user?.role === "first_responder"

  const selected = useMemo(() => alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null, [alerts, selectedId])
  const counts = useMemo(() => ({
    active: isOfficial
      ? (summary as OfficialRoleSummary | null)?.active_emergencies ?? alerts.length
      : (summary as ResponderRoleSummary | null)?.assigned_active_emergencies ?? alerts.length,
    unassigned: alerts.filter((alert) => !alert.current_assignment).length,
    enRoute: alerts.filter((alert) => ["acknowledged", "en_route", "nearby"].includes(alert.status)).length,
    respondersOnDuty: (summary as OfficialRoleSummary | null)?.responders_on_duty ?? responders.length,
    awaitingAck: (summary as ResponderRoleSummary | null)?.assigned_active_emergencies ?? alerts.length,
  }), [alerts, isOfficial, responders.length, summary])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) return
      setLoading(true)
      setError("")
      try {
        const [nextAlerts, nextResponders, nextSummary, requestedAlert, nextAppeals] = await Promise.all([
          isOfficial ? listEmergencyQueue() : isResponder ? listAssignedEmergencies() : Promise.resolve([]),
          isOfficial ? listActiveResponders() : Promise.resolve([]),
          isOfficial ? getOfficialDashboardSummary() : isResponder ? getResponderDashboardSummary() : Promise.resolve(null),
          requestedAlertId ? getEmergency(requestedAlertId).catch(() => null) : Promise.resolve(null),
          isOfficial ? listEmergencyAppeals() : Promise.resolve([]),
        ])
        if (cancelled) return
        const mergedAlerts = requestedAlert && !nextAlerts.some((alert) => alert.id === requestedAlert.id)
          ? [requestedAlert, ...nextAlerts]
          : nextAlerts.map((alert) => alert.id === requestedAlert?.id ? requestedAlert : alert)
        setAlerts(mergedAlerts)
        setResponders(nextResponders)
        setSummary(nextSummary)
        setAppeals(nextAppeals)
        setSelectedId(requestedAlert?.id ?? mergedAlerts[0]?.id ?? null)
      } catch {
        if (!cancelled) setError("Could not load emergency operations.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [user, isOfficial, isResponder, requestedAlertId])

  function updateAlert(next: EmergencyAlert) {
    setAlerts((current) => current.map((alert) => alert.id === next.id ? next : alert))
    setSelectedId(next.id)
  }

  if (!isOfficial && !isResponder) {
    return (
      <div className="bg-white p-5 md:p-8">
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
          <AlertTriangleIcon className="mx-auto size-10 text-red-600" />
          <h1 className="mt-3 text-xl font-bold text-neutral-900">Emergency operations are staff-only</h1>
          <p className="mt-2 text-[15px] text-neutral-600">Residents can send SOS alerts from the SOS button.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 bg-white p-4 md:p-6 lg:p-8">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-red-600">Emergency operations</p>
              <h1 className="mt-1 text-[22px] font-bold tracking-tight text-neutral-900 sm:text-2xl">
                {isOfficial ? "Dispatch console" : "Responder field dashboard"}
              </h1>
              <p className="mt-2 max-w-3xl text-[15px] font-medium leading-6 text-neutral-600">
                {isOfficial
                  ? "SOS alerts auto-route to the nearest on-duty matching unit. Officials can override or add responders when the incident needs more support."
                  : "Keep your duty location live, follow automatically routed alerts, and update the resident as you respond."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <SummaryBox label="Active" value={counts.active.toString()} />
              <SummaryBox label={isOfficial ? "Unassigned" : "En route"} value={(isOfficial ? counts.unassigned : counts.enRoute).toString()} />
              <SummaryBox label={isOfficial ? "On duty" : "Routed"} value={(isOfficial ? counts.respondersOnDuty : counts.awaitingAck).toString()} />
            </div>
          </div>
        </div>

        {isOfficial ? <EmergencyAppealsPanel appeals={appeals} onUpdated={(next) => setAppeals((items) => items.map((item) => item.id === next.id ? next : item))} /> : null}

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

        {isResponder ? (
          <DutyPanel user={user} />
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-[14px] font-medium text-neutral-500">Loading emergencies...</div>
        ) : alerts.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
            <ShieldCheckIcon className="mx-auto size-10 text-emerald-600" />
            <h2 className="mt-3 text-lg font-bold text-neutral-900">No active emergencies</h2>
            <p className="mt-2 text-[14px] text-neutral-500">New SOS alerts and assignments will appear here.</p>
          </div>
        ) : isOfficial ? (
          <div className="grid gap-5 2xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-bold text-neutral-900">Incoming emergency queue</p>
                <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-700">{alerts.length} live</span>
              </div>
              {alerts.map((alert) => (
                <QueueCard key={alert.id} alert={alert} active={selected?.id === alert.id} onClick={() => setSelectedId(alert.id)} />
              ))}
            </aside>
            <IncidentBoard alert={selected} />
            <DispatchPanel alert={selected} responders={responders} onChanged={updateAlert} />
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <IncidentBoard alert={selected} />
              {selected ? <ResponderActions alert={selected} onChanged={updateAlert} /> : null}
            </div>
            <aside className="space-y-3">
              <p className="text-[14px] font-bold text-neutral-900">Assigned alerts</p>
              {alerts.map((alert) => (
                <QueueCard key={alert.id} alert={alert} active={selected?.id === alert.id} onClick={() => setSelectedId(alert.id)} />
              ))}
            </aside>
          </div>
        )}
    </div>
  )
}
