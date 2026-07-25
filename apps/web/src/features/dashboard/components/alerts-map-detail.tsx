import { useEffect, useState, type ReactNode } from "react"
import { Clock, MapPin, NavigationArrow, ShieldCheck, User, Warning, X } from "@phosphor-icons/react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  assignEmergency,
  getEmergency,
  reassignEmergency,
  removeEmergencyAssignment,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import type { LiveMapEmergency, LiveMapPerson, LiveMapSnapshot } from "@/features/dashboard/api"
import type { Selection } from "./alerts-map-view"
import {
  InfoRow,
  ResponseTeamCard,
  IncidentTimelineCard,
  EvidenceCard,
  EscalationCard,
  WitnessNotificationCard,
  AssignResponderCard,
  LoadingState,
  DetailErrorCard,
  TeamActionConfirmDialog,
} from "./alerts-map-detail-panels"
import { formatTime } from "./alerts-map-detail-panels.utils"

function formatDistance(meters: number | null) {
  if (meters == null) return "Route unavailable"
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatEta(seconds: number | null) {
  if (seconds == null) return "ETA unavailable"
  return `ETA ${Math.max(1, Math.round(seconds / 60))} min`
}

const inactiveAssignmentStatuses = new Set(["cancelled", "declined", "resolved"])

function roleLabel(role: LiveMapPerson["role"]) {
  if (role === "barangay_official") return "Official"
  if (role === "first_responder") return "Responder"
  return "Resident"
}

function PanelShell({ title, badge, onClose, children }: { title: string; badge: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase text-[#2447b3]">Alert Details</p>
          <h2 className="mt-1 text-base font-black capitalize text-[#07145f]">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700">{badge}</span>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#68739c] hover:bg-[#f8fafc]" aria-label="Close details"><X className="size-4" /></button>
        </div>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  )
}

export function DetailPanel({
  selected,
  snapshot,
  onClose,
  onEmergencyUpdated,
}: {
  selected: Selection
  snapshot: LiveMapSnapshot
  onClose: () => void
  onEmergencyUpdated: (emergency: LiveMapEmergency) => void
}) {
  const navigate = useNavigate()
  const [assigningResponderId, setAssigningResponderId] = useState<number | null>(null)
  const [emergencyDetail, setEmergencyDetail] = useState<EmergencyAlert | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [teamAction, setTeamAction] = useState<
    | { kind: "replace"; responder: LiveMapPerson }
    | { kind: "remove"; assignmentId: number; responderName: string }
    | null
  >(null)
  const [teamReason, setTeamReason] = useState("")
  const [teamBusy, setTeamBusy] = useState(false)
  const selectedEmergency = selected?.kind === "emergency"
    ? snapshot.emergencies.find((item) => item.id === selected.id) ?? null
    : null
  const selectedEmergencyId = selectedEmergency?.id ?? null
  const selectedEmergencyUpdatedAt = selectedEmergency?.updated_at ?? null

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTeamAction(null)
      setTeamReason("")
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedEmergencyId])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!selectedEmergencyId) {
        setEmergencyDetail(null)
        setDetailError("")
        setDetailLoading(false)
        return
      }
      setDetailLoading(true)
      setDetailError("")
      void getEmergency(selectedEmergencyId)
        .then((next) => {
          if (!cancelled) setEmergencyDetail(next)
        })
        .catch((error) => {
          if (!cancelled) {
            setEmergencyDetail(null)
            setDetailError(error instanceof Error ? error.message : "Could not load complete incident details.")
          }
        })
        .finally(() => {
          if (!cancelled) setDetailLoading(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [selectedEmergencyId, selectedEmergencyUpdatedAt, detailRefreshKey])

  if (!selected) return null
  if (selected.kind === "person") {
    const person = snapshot.people.find((item) => item.id === selected.id)
    if (!person) return null
    return (
      <PanelShell title={person.full_name} badge={roleLabel(person.role)} onClose={onClose}>
        <InfoRow icon={<User className="size-4" />} label="Role" value={roleLabel(person.role)} />
        <InfoRow icon={<MapPin className="size-4" />} label="Location" value={person.address || person.barangay} />
        <InfoRow icon={<Clock className="size-4" />} label="Last GPS" value={formatTime(person.location_updated_at)} />
        <InfoRow icon={<ShieldCheck className="size-4" />} label="Duty" value={person.role === "first_responder" ? (person.is_on_duty ? "On duty" : "Off duty") : "Verified"} />
      </PanelShell>
    )
  }
  if (selected.kind === "concern") {
    const concern = snapshot.concerns.find((item) => item.id === selected.id)
    if (!concern) return null
    return (
      <PanelShell title={concern.title} badge="Concern" onClose={onClose}>
        <InfoRow icon={<Warning className="size-4" />} label="Priority" value={concern.priority === "high" ? "High Priority" : "Normal"} />
        <InfoRow icon={<User className="size-4" />} label="Reported by" value={concern.reporter.full_name} />
        <InfoRow icon={<MapPin className="size-4" />} label="Location" value={concern.address || concern.barangay} />
        <p className="text-xs font-semibold leading-5 text-[#43507f]">{concern.description || "No description provided."}</p>
        <Button type="button" onClick={() => navigate(`/dashboard/reports/${concern.id}`)} className="w-full bg-[#07145f] text-white hover:bg-[#0b1b75]">View Full Details</Button>
      </PanelShell>
    )
  }
  const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
  if (!emergency) return null
  const currentEmergency = emergency
  const fullEmergency = emergencyDetail?.id === emergency.id ? emergencyDetail : null
  const activeTeamAssignments = fullEmergency?.assignments.filter(
    (assignment) => !inactiveAssignmentStatuses.has(assignment.status),
  ) ?? []
  const route = snapshot.routes.find((item) => item.alert_id === emergency.id)
  const eligibleResponderUnits = emergency.type === "medical"
    ? ["bhw"]
    : emergency.type === "fire" || emergency.type === "disaster"
      ? ["bdrrmo"]
      : emergency.type === "crime"
        ? ["tanod"]
        : ["tanod", "bhw", "bdrrmo"]
  const eligibleResponderUnitSet = new Set(eligibleResponderUnits)
  const availableResponders = snapshot.people.filter(
    (person) => person.role === "first_responder" && person.is_on_duty && eligibleResponderUnitSet.has(person.responder_unit || ""),
  )
  function patchFromEmergencyAlert(next: EmergencyAlert, responder?: LiveMapPerson) {
    setEmergencyDetail(next)
    const assignment = next.current_assignment
    const liveResponder =
      responder ??
      (assignment
        ? snapshot.people.find((person) => person.id === assignment.responder.id) ?? {
            id: assignment.responder.id,
            full_name: assignment.responder.full_name,
            role: "first_responder" as const,
            barangay: assignment.responder.barangay || currentEmergency.barangay,
            address: assignment.responder.street || "",
            responder_unit: assignment.responder.responder_unit || "",
            is_on_duty: Boolean(assignment.responder.is_on_duty),
            latitude: null,
            longitude: null,
            location_updated_at: assignment.responder.last_seen_at,
          }
        : null)
    onEmergencyUpdated({
      ...currentEmergency,
      status: next.status,
      updated_at: next.updated_at,
      resolved_at: next.resolved_at,
      current_assignment:
        assignment && liveResponder
          ? {
              id: assignment.id,
              responder: liveResponder,
              status: assignment.status,
              last_location: assignment.last_location,
            }
          : null,
    })
  }
  async function assignResponder(responder: LiveMapPerson) {
    setAssigningResponderId(responder.id)
    try {
      const next = await assignEmergency(currentEmergency.id, responder.id)
      patchFromEmergencyAlert(next, responder)
      toast.success(`Assigned to ${responder.full_name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign responder.")
    } finally {
      setAssigningResponderId(null)
    }
  }
  async function confirmTeamAction() {
    if (!fullEmergency || !teamAction) return
    const reason = teamReason.trim()
    if (reason.length < 5) {
      toast.error("Add a brief operational reason before changing the response team.")
      return
    }
    setTeamBusy(true)
    try {
      const next = teamAction.kind === "replace"
        ? await reassignEmergency(fullEmergency.id, teamAction.responder.id, reason, fullEmergency.status_version)
        : await removeEmergencyAssignment(fullEmergency.id, teamAction.assignmentId, {
            reason,
            status_version: fullEmergency.status_version,
          })
      patchFromEmergencyAlert(
        next,
        teamAction.kind === "replace" ? teamAction.responder : undefined,
      )
      toast.success(teamAction.kind === "replace" ? "Primary responder replaced" : "Support responder removed")
      setTeamAction(null)
      setTeamReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the response team.")
    } finally {
      setTeamBusy(false)
    }
  }
  async function resolveSelected() {
    try {
      const next = await resolveEmergency(currentEmergency.id, "Marked resolved from Alerts Map.")
      patchFromEmergencyAlert(next)
      toast.success("Emergency marked resolved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark resolved.")
    }
  }
  async function copySummary() {
    const summary = [
      `${currentEmergency.type.replace(/_/g, " ")} emergency`,
      `Status: ${currentEmergency.status.replace(/_/g, " ")}`,
      `Reporter: ${currentEmergency.reporter.full_name}`,
      `Responder: ${currentEmergency.current_assignment?.responder.full_name || "Unassigned"}`,
      `Location: ${currentEmergency.address || currentEmergency.barangay}`,
      currentEmergency.note ? `Note: ${currentEmergency.note}` : "",
    ].filter(Boolean).join("\n")
    await navigator.clipboard?.writeText(summary)
    toast.success("Emergency summary copied")
  }
  return (
    <PanelShell title={`${emergency.type} emergency`} badge="Emergency" onClose={onClose}>
      <InfoRow icon={<Warning className="size-4" />} label="Status" value={emergency.status.replace(/_/g, " ")} />
      <InfoRow icon={<User className="size-4" />} label="Reported by" value={emergency.reporter.full_name} />
      <InfoRow icon={<ShieldCheck className="size-4" />} label="Responder" value={emergency.current_assignment?.responder.full_name || "Unassigned"} />
      <InfoRow icon={<NavigationArrow className="size-4" />} label="Route" value={`${formatDistance(route?.distance_meters ?? null)} · ${formatEta(route?.eta_seconds ?? null)}`} />
      <InfoRow icon={<MapPin className="size-4" />} label="Location" value={emergency.address || emergency.barangay} />
      <p className="text-xs font-semibold leading-5 text-[#43507f]">{emergency.note || "No note provided."}</p>
      {detailLoading && !fullEmergency ? <LoadingState /> : null}
      {detailError ? <DetailErrorCard message={detailError} onRetry={() => setDetailRefreshKey((value) => value + 1)} /> : null}
      {fullEmergency ? (
        <>
          <ResponseTeamCard
            assignments={fullEmergency.assignments}
            activeTeamAssignments={activeTeamAssignments}
            onRemove={(assignment) => {
              setTeamAction({ kind: "remove", assignmentId: assignment.id, responderName: assignment.responder.full_name })
              setTeamReason("")
            }}
          />
          <IncidentTimelineCard statusEvents={fullEmergency.status_events} />
          <EvidenceCard media={fullEmergency.media} />
          <EscalationCard escalations={fullEmergency.escalations} />
          <WitnessNotificationCard summary={fullEmergency.witness_notification_summary} />
        </>
      ) : null}
      <EmergencyChatPanel
        alertId={emergency.id}
        open
        theme="light"
        participantHint={
          activeTeamAssignments.length
            ? `Group · resident + ${activeTeamAssignments.length} responder${activeTeamAssignments.length === 1 ? "" : "s"}`
            : emergency.current_assignment
              ? `Group · resident + ${emergency.current_assignment.responder.full_name}`
              : "Group chat opens after a responder is assigned"
        }
        disabled={
          !emergency.current_assignment ||
          emergency.status === "cancelled" ||
          emergency.status === "resolved"
        }
        className="min-h-[320px]"
      />
      <div className="grid gap-2">
        <Button type="button" onClick={() => navigate(`/dashboard/emergencies?alert=${emergency.id}`)} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">Open in Emergency Operations</Button>
        <AssignResponderCard
          responders={availableResponders}
          activeTeamAssignments={activeTeamAssignments}
          assigningResponderId={assigningResponderId}
          onAssign={(responder) => void assignResponder(responder)}
          onReplace={(responder) => {
            setTeamAction({ kind: "replace", responder })
            setTeamReason("")
          }}
        />
          <TeamActionConfirmDialog
            teamAction={teamAction}
            teamReason={teamReason}
            teamBusy={teamBusy}
            emergencyId={currentEmergency.id}
            onReasonChange={setTeamReason}
            onKeep={() => { setTeamAction(null); setTeamReason("") }}
            onConfirm={() => void confirmTeamAction()}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => void copySummary()}>Copy Summary</Button>
          <Button type="button" variant="outline" onClick={() => void resolveSelected()} className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">Mark Resolved</Button>
        </div>
    </PanelShell>
  )
}
