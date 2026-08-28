import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PlayIcon,
  UserIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import type { LiveMapEmergency, LiveMapPerson, LiveMapSnapshot } from "@/features/dashboard/api"
import { EmergencyCommunityComments } from "@/features/dashboard/components/emergencies/community-comments"
import { EmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline"

import {
  getEmergency,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import {
  ResponderAssignment,
  type AssignableResponder,
} from "@/features/dashboard/components/emergencies/responder-assignment"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { RecordDetail } from "@/features/dashboard/components/record/record-detail"
import { toEmergencyRecordView } from "@/features/dashboard/components/record/emergency-adapter"
import type { RecordAction, RecordSection } from "@/features/dashboard/components/record/types"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { looksLikeCoordinates } from "@/features/dashboard/lib/location-text"
import { PanelShell, InfoRow } from "./panel-shell"
import { formatDistance, formatEta, formatTime, type Selection } from "./lib"

/**
 * A location that reads as an incident location, not a bare place name.
 *
 * When only the barangay is known, "Marikina Heights" alone looks like a
 * heading; "In Marikina Heights" reads as where the thing is. A specific street
 * address always wins over the contextual fallback.
 */
function locationLabel(address: string | null | undefined, barangay: string | null | undefined) {
  const street = address?.trim()
  // Never a coordinate string: "Pinned coordinates: 14.6, 121.1" is not a place.
  if (street && !looksLikeCoordinates(street)) return street
  const area = barangay?.trim()
  return area ? `In ${area}` : null
}

export function DetailPanel({
  selected,
  snapshot,
  onEmergencyUpdated,
}: {
  selected: Selection
  snapshot: LiveMapSnapshot
  onEmergencyUpdated: (emergency: LiveMapEmergency) => void
}) {
  const navigate = useNavigate()
  const [emergencyDetail, setEmergencyDetail] = useState<EmergencyAlert | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  // Severity depends on elapsed time, so the panel needs a clock rather than
  // a render-time Date.now(). 30s is well under the tightest ack target (2min).
  const [now, setNow] = useState(() => Date.now())
  const [evidencePreview, setEvidencePreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const selectedEmergency = selected?.kind === "emergency"
    ? snapshot.emergencies.find((item) => item.id === selected.id) ?? null
    : null
  const selectedEmergencyId = selectedEmergency?.id ?? null
  const selectedEmergencyUpdatedAt = selectedEmergency?.updated_at ?? null
  // Only an open emergency needs a clock, and severity moves on the minute, so
  // this used to re-render the whole panel — timeline, chat and all — twice a
  // minute for a person or concern that has no elapsed-time reading at all.
  useEffect(() => {
    if (!selectedEmergencyId) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [selectedEmergencyId])

  // A responder in motion republishes the emergency every 15s, which bumps
  // `updated_at` and used to trigger a full detail refetch each time. The delay
  // coalesces a burst of pings into one request.
  const detailDebounceMs = emergencyDetail ? 4000 : 0
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
    }, detailDebounceMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `detailDebounceMs` is derived from emergencyDetail and only widens the
    // window once the first load has landed; including it would refire the
    // effect from inside its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmergencyId, selectedEmergencyUpdatedAt, detailRefreshKey])

  if (!selected) return null
  if (selected.kind === "concern") {
    const concern = snapshot.concerns.find((item) => item.id === selected.id)
    if (!concern) return null
    // Labels, not raw enums: the resident-facing status word and the category
    // name, so this panel says the same thing as the Concerns console for the
    // same report rather than showing "public_safety" / "in_progress".
    return (
      <PanelShell title={concern.title}>
        <InfoRow icon={<UserIcon className="size-4" />} label="Reported by" value={concern.reporter.full_name} />
        <InfoRow icon={<AlertTriangleIcon className="size-4" />} label="Category" value={concernCategoryLabel(concern)} />
        <InfoRow
          icon={<AlertTriangleIcon className="size-4" />}
          label="Priority"
          value={concern.priority === "high" ? "High" : "Normal"}
        />
        <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={locationLabel(concern.address, concern.barangay)} />
        <p className="text-xs font-semibold leading-5 text-foreground">{concern.description || "No description provided."}</p>
        {concern.preview_url ? (
          <button
            type="button"
            onClick={() =>
              setEvidencePreview({
                items: [toMediaPreviewItem(concern.preview_url, concern.title, "image/jpeg")],
                index: 0,
              })
            }
            className="overflow-hidden rounded-control border border-card-line"
          >
            <AuthenticatedMediaImage
              src={concern.preview_url}
              alt={`${concern.title} evidence photo`}
              className="h-32 w-full object-cover"
            />
          </button>
        ) : null}
        <Button type="button" onClick={() => navigate(`/dashboard/reports/${concern.id}`)} className="w-full bg-brand-navy text-white hover:bg-brand-navy/90">View full details</Button>
      </PanelShell>
    )
  }
  const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
  if (!emergency) return null
  const currentEmergency = emergency
  const fullEmergency = emergencyDetail?.id === emergency.id ? emergencyDetail : null
  const activeTeamAssignments = (fullEmergency?.assignments ?? []).filter(
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
  function toAssignable(person: LiveMapPerson): AssignableResponder {
    return {
      id: person.id,
      full_name: person.full_name,
      responder_unit: person.responder_unit || null,
      is_on_duty: person.is_on_duty,
      latitude: person.latitude,
      longitude: person.longitude,
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
    const emergencyMedia = fullEmergency.media ?? []
    const emergencyEscalations = fullEmergency.escalations ?? []
    sections.push({
      key: "emergency-team",
      title: "Response team",
      badge: String(activeTeamAssignments.length),
      defaultOpen: true,
      content: (
        <ResponderAssignment
          alert={fullEmergency}
          responders={availableResponders.map(toAssignable)}
          onChanged={patchFromEmergencyAlert}
          maxResponders={4}
        />
      ),
    })

    sections.push({
      key: "emergency-community",
      title: "Community updates",
      content: (
        <EmergencyCommunityComments
          alertId={fullEmergency.id}
          acceptsComments={
            fullEmergency.status !== "cancelled" && fullEmergency.status !== "false_alarm"
          }
        />
      ),
    })

    sections.push({
      key: "emergency-timeline",
      title: "Status and Timeline",
      badge: String(fullEmergency.timeline?.length ?? 0),
      content: <EmergencyTimeline entries={fullEmergency.timeline ?? []} showNotes />,
    })

    if (emergencyMedia.length) {
      const evidenceItems: MediaPreviewItem[] = emergencyMedia.map((media) =>
        toMediaPreviewItem(mediaDisplaySource(media), media.original_filename, media.mime_type),
      )
      sections.push({
        key: "emergency-evidence",
        title: "Protected evidence",
        badge: String(emergencyMedia.length),
        content: (
          <div className="grid grid-cols-2 gap-2">
            {emergencyMedia.map((media, mediaIndex) => (
              <button
                key={media.id}
                type="button"
                onClick={() => setEvidencePreview({ items: evidenceItems, index: mediaIndex })}
                className="overflow-hidden rounded-control border border-card-line bg-canvas text-left"
              >
                {media.mime_type.startsWith("image/") ? (
                  <AuthenticatedMediaImage
                    src={mediaDisplaySource(media)}
                    alt={`${media.original_filename} evidence photo`}
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  <span className="flex h-24 items-center justify-center gap-2 px-2 text-center text-xs font-bold text-brand-navy">
                    <PlayIcon className="size-4" />
                    Preview video
                  </span>
                )}
              </button>
            ))}
          </div>
        ),
      })
    }

    if (emergencyEscalations.length) {
      sections.push({
        key: "emergency-escalations",
        title: "Escalation history",
        badge: String(emergencyEscalations.length),
        defaultOpen: true,
        content: (
          <div className="grid gap-2">
            {emergencyEscalations.map((escalation) => (
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

  }

  sections.push({
    key: "emergency-chat",
    title: "Group chat",
    content: (
      <EmergencyChatPanel
        alertId={emergency.id}
        open
        theme="light"
        disabled={
          !emergency.current_assignment ||
          emergency.status === "cancelled" ||
          emergency.status === "resolved" ||
          emergency.status === "false_alarm" ||
          emergency.status === "invalid"
        }
        className="h-[min(320px,52svh)]"
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
    <div className="space-y-3 px-3 pb-3 pt-2">
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

      <RecordDetail record={record} embedded />

      {evidencePreview ? (
        <MediaLightbox
          items={evidencePreview.items}
          index={evidencePreview.index}
          onClose={() => setEvidencePreview(null)}
        />
      ) : null}
    </div>
  )
}
