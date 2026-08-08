import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  ClockIcon,
  LoaderCircleIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { LiveMapEmergency, LiveMapPerson, LiveMapSnapshot } from "@/features/dashboard/api"
import {
  assignEmergency,
  getEmergency,
  reassignEmergency,
  removeEmergencyAssignment,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { openAuthenticatedMedia } from "@/features/dashboard/lib/authenticated-media"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { RecordDetail } from "@/features/dashboard/components/record/record-detail"
import { toEmergencyRecordView } from "@/features/dashboard/components/record/emergency-adapter"
import type { RecordAction, RecordSection } from "@/features/dashboard/components/record/types"
import { PanelShell, InfoRow } from "./panel-shell"
import { formatDistance, formatEta, formatTime, roleLabel, type Selection } from "./lib"

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
  // Severity depends on elapsed time, so the panel needs a clock rather than
  // a render-time Date.now(). 30s is well under the tightest ack target (2min).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
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
        <InfoRow icon={<UserIcon className="size-4" />} label="Role" value={roleLabel(person.role)} />
        <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={person.address || person.barangay} />
        <InfoRow icon={<ClockIcon className="size-4" />} label="Last GPS" value={formatTime(person.location_updated_at)} />
        <InfoRow icon={<ShieldCheckIcon className="size-4" />} label="Duty" value={person.role === "first_responder" ? (person.is_on_duty ? "On duty" : "Off duty") : "Verified"} />
      </PanelShell>
    )
  }
  if (selected.kind === "concern") {
    const concern = snapshot.concerns.find((item) => item.id === selected.id)
    if (!concern) return null
    return (
      <PanelShell title={concern.title} badge="Concern" onClose={onClose}>
        <InfoRow icon={<AlertTriangleIcon className="size-4" />} label="Priority" value={concern.priority === "high" ? "High Priority" : "Normal"} />
        <InfoRow icon={<UserIcon className="size-4" />} label="Reported by" value={concern.reporter.full_name} />
        <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={concern.address || concern.barangay} />
        <p className="text-xs font-semibold leading-5 text-foreground">{concern.description || "No description provided."}</p>
        <Button type="button" onClick={() => navigate(`/dashboard/reports/${concern.id}`)} className="w-full bg-brand-navy text-white hover:bg-brand-navy/90">View Full Details</Button>
      </PanelShell>
    )
  }
  const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
  if (!emergency) return null
  const currentEmergency = emergency
  const fullEmergency = emergencyDetail?.id === emergency.id ? emergencyDetail : null
  const activeTeamAssignments = fullEmergency?.assignments.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []
  const route = snapshot.routes.find((item) => item.alert_id === emergency.id)
  const availableResponders = snapshot.people.filter(
    (person) => person.role === "first_responder" && person.is_on_duty,
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
  // Reassign isolation: this is the ONLY place in the alerts-map area that calls the
  // reassign/remove-assignment endpoints. Contract is single `responder_id` (+ reason + status_version).
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
  const sections: RecordSection[] = []

  if (fullEmergency) {
    sections.push({
      key: "emergency-team",
      title: "Response team",
      badge: String(activeTeamAssignments.length),
      defaultOpen: true,
      content: (
        <div className="grid gap-2">
          {fullEmergency.assignments.length ? (
            fullEmergency.assignments.map((assignment) => {
              const active = !["cancelled", "declined", "resolved"].includes(assignment.status)
              return (
                <div
                  key={assignment.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-panel border border-card-line bg-canvas px-3 py-2",
                    !active && "opacity-60",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-foreground">
                      {assignment.responder.full_name}
                    </p>
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {assignment.responder.responder_unit || "Responder"} · assigned{" "}
                      {formatTime(assignment.assigned_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded-control bg-tint px-2 py-1 text-[10px] font-bold capitalize text-brand-navy">
                      {assignment.status.replace(/_/g, " ")}
                    </span>
                    {active && activeTeamAssignments.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTeamAction({
                            kind: "remove",
                            assignmentId: assignment.id,
                            responderName: assignment.responder.full_name,
                          })
                          setTeamReason("")
                        }}
                        className="rounded-control px-2 py-1 text-[10px] font-bold text-severity-critical-ink hover:bg-severity-critical-surface"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })
          ) : (
            <p className="rounded-panel bg-canvas px-3 py-2 text-xs font-semibold text-muted-foreground">
              No responder assignment has been recorded.
            </p>
          )}

          <div className="rounded-panel border border-card-line bg-canvas p-3">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">Add or replace</p>
            <div className="mt-2 grid gap-2">
              {availableResponders.length === 0 ? (
                <p className="text-xs font-semibold text-muted-foreground">
                  No on-duty responders with live status.
                </p>
              ) : (
                availableResponders.slice(0, 4).map((responder) => {
                  const alreadyActive = activeTeamAssignments.some(
                    (assignment) => assignment.responder.id === responder.id,
                  )
                  return (
                    <div
                      key={responder.id}
                      className="flex items-center justify-between gap-2 rounded-control border border-card-line bg-card px-3 py-2 text-left text-xs font-bold text-foreground"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{responder.full_name}</span>
                        <span className="block text-[11px] font-semibold text-muted-foreground">
                          {responder.responder_unit || "responder"} · on duty
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={assigningResponderId !== null || alreadyActive}
                          onClick={() => void assignResponder(responder)}
                          className="rounded-control px-2 py-1 text-brand-orange hover:bg-brand-orange-soft disabled:text-muted-foreground"
                        >
                          {assigningResponderId === responder.id
                            ? "Adding"
                            : alreadyActive
                              ? "Assigned"
                              : "Add"}
                        </button>
                        {!alreadyActive && activeTeamAssignments.length ? (
                          <button
                            type="button"
                            disabled={assigningResponderId !== null}
                            onClick={() => {
                              setTeamAction({ kind: "replace", responder })
                              setTeamReason("")
                            }}
                            className="rounded-control px-2 py-1 text-brand-navy hover:bg-tint"
                          >
                            Replace
                          </button>
                        ) : null}
                      </span>
                    </div>
                  )
                })
              )}
            </div>

            {teamAction ? (
              <div className="mt-3 rounded-control border border-severity-moderate bg-severity-moderate-surface p-3">
                <p className="text-xs font-bold text-severity-moderate-ink">
                  {teamAction.kind === "replace"
                    ? `Replace the active response team with ${teamAction.responder.full_name}?`
                    : `Remove ${teamAction.responderName} from this response?`}
                </p>
                <label
                  className="mt-2 block text-[11px] font-bold text-severity-moderate-ink"
                  htmlFor={`team-reason-${currentEmergency.id}`}
                >
                  Operational reason
                </label>
                <textarea
                  id={`team-reason-${currentEmergency.id}`}
                  value={teamReason}
                  onChange={(event) => setTeamReason(event.target.value)}
                  maxLength={255}
                  rows={2}
                  placeholder="Explain why this assignment is changing"
                  className="mt-1 w-full resize-none rounded-control border border-card-line bg-card px-3 py-2 text-xs text-foreground outline-none focus:border-brand-orange"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={teamBusy}
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
                    disabled={teamBusy || teamReason.trim().length < 5}
                    onClick={() => void confirmTeamAction()}
                    className="bg-brand-navy text-white hover:bg-brand-navy/90"
                  >
                    {teamBusy ? "Updating" : "Confirm change"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ),
    })

    sections.push({
      key: "emergency-timeline",
      title: "Incident timeline",
      badge: String(fullEmergency.status_events.length),
      content: (
        <div className="grid gap-0">
          {fullEmergency.status_events.length ? (
            fullEmergency.status_events.slice(-8).map((event, index, events) => (
              <div key={event.id} className="relative grid grid-cols-[18px_1fr] gap-2 pb-3 last:pb-0">
                {index < events.length - 1 ? (
                  <span className="absolute left-[6px] top-3 h-full w-px bg-card-line" />
                ) : null}
                <span className="relative mt-1 size-3 rounded-full border-2 border-card bg-brand-navy ring-1 ring-card-line" />
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <p className="text-xs font-bold capitalize text-foreground">
                      {event.status.replace(/_/g, " ")}
                    </p>
                    <time className="text-[10px] font-semibold text-muted-foreground">
                      {formatTime(event.created_at)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold leading-4 text-muted-foreground">
                    {event.note || `Status updated by ${event.actor?.full_name || "system"}.`}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">No lifecycle events recorded.</p>
          )}
        </div>
      ),
    })

    if (fullEmergency.media.length) {
      sections.push({
        key: "emergency-evidence",
        title: "Protected evidence",
        badge: String(fullEmergency.media.length),
        content: (
          <div className="grid grid-cols-2 gap-2">
            {fullEmergency.media.map((media) => (
              <button
                key={media.id}
                type="button"
                onClick={() => void openAuthenticatedMedia(media.raw_url, media.original_filename)}
                className="overflow-hidden rounded-control border border-card-line bg-canvas text-left"
              >
                {media.mime_type.startsWith("image/") ? (
                  <AuthenticatedMediaImage
                    src={media.preview_url || media.raw_url}
                    alt={media.original_filename}
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  <span className="flex h-24 items-center justify-center px-2 text-center text-xs font-bold text-brand-navy">
                    Open video evidence
                  </span>
                )}
                <span className="block truncate px-2 py-2 text-[10px] font-bold text-foreground">
                  {media.original_filename}
                </span>
              </button>
            ))}
          </div>
        ),
      })
    }

    if (fullEmergency.escalations.length) {
      sections.push({
        key: "emergency-escalations",
        title: "Escalation history",
        badge: String(fullEmergency.escalations.length),
        defaultOpen: true,
        content: (
          <div className="grid gap-2">
            {fullEmergency.escalations.map((escalation) => (
              <div
                key={escalation.id}
                className="text-xs font-semibold leading-5 text-severity-moderate-ink"
              >
                <span className="font-bold">{formatTime(escalation.created_at)}</span> ·{" "}
                {escalation.reason}
                {escalation.escalated_to ? ` · Routed to ${escalation.escalated_to.full_name}` : ""}
              </div>
            ))}
          </div>
        ),
      })
    }

    sections.push({
      key: "emergency-witness",
      title: "Nearby resident notification",
      content: fullEmergency.witness_notification_summary?.triggered ? (
        <div className="grid gap-1 text-xs font-semibold leading-5 text-foreground">
          <p>
            Selected <strong>{fullEmergency.witness_notification_summary.recipient_count}</strong>{" "}
            verified nearby resident
            {fullEmergency.witness_notification_summary.recipient_count === 1 ? "" : "s"};{" "}
            <strong>{fullEmergency.witness_notification_summary.in_app_delivered_count}</strong>{" "}
            received an in-app notice and{" "}
            <strong>{fullEmergency.witness_notification_summary.read_count}</strong> opened it.
          </p>
          <p>
            <strong>{fullEmergency.witness_notification_summary.push_delivered_count}</strong>{" "}
            browser push deliver
            {fullEmergency.witness_notification_summary.push_delivered_count === 1 ? "y" : "ies"}
            {fullEmergency.witness_notification_summary.push_failure_count
              ? `; ${fullEmergency.witness_notification_summary.push_failure_count} push attempt${
                  fullEmergency.witness_notification_summary.push_failure_count === 1 ? "" : "s"
                } failed`
              : ""}
            .
          </p>
        </div>
      ) : (
        <p className="text-xs font-semibold text-muted-foreground">
          No nearby-resident safety notification was triggered.
        </p>
      ),
    })
  }

  sections.push({
    key: "emergency-chat",
    title: "Group chat",
    content: (
      <EmergencyChatPanel
        alertId={emergency.id}
        open
        theme="light"
        participantHint={
          activeTeamAssignments.length
            ? `Group · resident + ${activeTeamAssignments.length} responder${
                activeTeamAssignments.length === 1 ? "" : "s"
              }`
            : emergency.current_assignment
              ? `Group · resident + ${emergency.current_assignment.responder.full_name}`
              : "Group chat opens after a responder is assigned"
        }
        disabled={
          !emergency.current_assignment ||
          emergency.status === "cancelled" ||
          emergency.status === "resolved" ||
          emergency.status === "false_alarm" ||
          emergency.status === "invalid"
        }
        className="min-h-[320px]"
      />
    ),
  })

  // Ordered so the first entry is the single thing to do next: assign when
  // nobody has it, close it out when somebody does.
  const actions: RecordAction[] = [
    emergency.current_assignment
      ? {
          key: "resolve",
          label: "Mark resolved",
          tone: "primary",
          onSelect: () => void resolveSelected(),
        }
      : {
          key: "assign",
          label: "Assign a responder",
          tone: "primary",
          disabled: availableResponders.length === 0,
          disabledReason: "No on-duty responders are available right now",
          onSelect: () =>
            document
              .getElementById("record-section-emergency-team")
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        },
    {
      key: "open-ops",
      label: "Open in Emergency Ops",
      onSelect: () => navigate(`/dashboard/emergencies?alert=${emergency.id}`),
    },
    { key: "copy", label: "Copy summary", onSelect: () => void copySummary() },
  ]

  // The live-map row carries only a subset of EmergencyAlert, so the full
  // record is preferred once it loads — it is what supplies assignments, media
  // and witness counts. Until then the adapter runs on the subset and simply
  // renders fewer facts.
  const source: EmergencyAlert =
    fullEmergency ??
    ({
      ...currentEmergency,
      public_id: "",
      reporter_phone: "",
      note: currentEmergency.note ?? "",
      location_source: "gps",
      location_accuracy: null,
      media_warnings: [],
      media: [],
      assignments: [],
      status_events: [],
      appeals: [],
      escalations: [],
      witness_notification_summary: null,
      routed_at: null,
    } as unknown as EmergencyAlert)

  const record = toEmergencyRecordView(source, {
    now,
    distanceLabel: route ? `${formatDistance(route.distance_meters ?? null)} away` : null,
    etaLabel: route ? formatEta(route.eta_seconds ?? null) : null,
    actions,
    sections,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Alert details
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-control p-1 text-muted-foreground transition hover:bg-tint"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {detailError ? (
        <div className="rounded-panel border border-severity-critical bg-severity-critical-surface p-3">
          <p className="text-xs font-bold text-severity-critical-ink">{detailError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDetailRefreshKey((value) => value + 1)}
            className="mt-2"
          >
            Retry details
          </Button>
        </div>
      ) : null}

      {detailLoading && !fullEmergency ? (
        <div className="flex items-center gap-2 rounded-panel border border-card-line bg-tint px-3 py-2.5 text-xs font-bold text-foreground">
          <LoaderCircleIcon className="size-4 animate-spin text-brand-navy" />
          Loading complete incident record…
        </div>
      ) : null}

      <RecordDetail record={record} />
    </div>
  )
}
