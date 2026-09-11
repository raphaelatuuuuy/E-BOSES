import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CheckIcon,
  InfoIcon,
  MessageCircleIcon,
  PhoneIcon,
  PlayIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import { drawCoverage } from "@/features/dashboard/components/map/coverage-layer"
import {
  GLYPHS,
  MAP_COLORS,
  glyphPinHtml,
} from "@/features/dashboard/components/map/markers"
import { apiRequest, websocketTicket, websocketUrl } from "@/lib/api"
import {
  bindHoverCard,
  closeHoverCardsOnLeave,
} from "@/features/dashboard/components/map/photo-tooltip"
import {
  createEmergencyAppeal,
  getEmergency,
  isNewerEmergencyAlert,
  normalizeEmergencyAlert,
  revealResponderContact,
  type EmergencyAlert,
  type EmergencyChatMessage,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { EmergencyTimelineCard } from "@/features/dashboard/components/emergencies/emergency-timeline-card"
import { buildEmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline-lib"
import {
  drawRoute,
  routeRenderGeometry,
  type RouteLayers,
} from "@/features/dashboard/lib/route-line"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { isEmergencyActive } from "@/features/dashboard/components/record/status"
import { formatClock } from "@/features/dashboard/lib/responder-format"
import { initialsFor, roleLabel } from "@/features/dashboard/lib/people"

import type leaflet from "leaflet"

/**
 * Resident-facing pipeline.
 * No “barangay desk / manual review” step — after send, system auto-routes
 * to the nearest available responder for this emergency type.
 */
type TimelineRow = {
  key: string
  status: EmergencyStatus
  label: string
  note: string
  time: string | null
  state: "done" | "current" | "pending" | "cancelled"
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set([
  "assigned",
  "acknowledged",
  "en_route",
  "arrived",
  "assisting",
])

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  acknowledged: "Preparing",
  en_route: "On the way",
  nearby: "Nearby",
  arrived: "On scene",
  assisting: "Assisting",
  cancelled: "Cancelled",
  declined: "Reassigned",
  resolved: "Completed",
}

function hasActiveResponder(alert: EmergencyAlert) {
  if (
    alert.current_assignment &&
    ACTIVE_ASSIGNMENT_STATUSES.has(alert.current_assignment.status)
  ) {
    return true
  }
  return (alert.assignments ?? []).some((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)
  )
}

function hadResponderAssignment(alert: EmergencyAlert) {
  return (
    (alert.assignments?.length ?? 0) > 0 ||
    (alert.escalations ?? []).some((item) => item.previous_assignment != null)
  )
}

function assignedUnitName(alert: EmergencyAlert) {
  return (
    alert.responding_unit?.short_name ||
    alert.responding_unit?.name ||
    "Response unit"
  )
}

function assignedUnitWaitingText(alert: EmergencyAlert) {
  return `${assignedUnitName(alert)} is responsible for this emergency.`
}

const PIPELINE: Array<{
  status: EmergencyStatus
  eventKeys: string[]
  label: string
  pendingHint: (alert: EmergencyAlert) => string
}> = [
  {
    status: "submitted",
    eventKeys: [
      "received_app",
      "received_sms",
      "received_call",
      "escalated_from_concern",
    ],
    label: "Emergency Received",
    pendingHint: () => "Waiting to send",
  },
  {
    status: "routed",
    eventKeys: ["responder_assigned", "responder_reassigned"],
    label: "Assigned unit",
    pendingHint: assignedUnitWaitingText,
  },
  {
    status: "en_route",
    eventKeys: ["responder_en_route"],
    label: "Responder En Route",
    pendingHint: () => "Responder is preparing to travel",
  },
  {
    status: "nearby",
    eventKeys: ["responder_nearby"],
    label: "Responder Nearby",
    pendingHint: () => "Almost there",
  },
  {
    status: "arrived",
    eventKeys: ["responder_arrived"],
    label: "Responder Arrived",
    pendingHint: () => "Waiting for arrival",
  },
  {
    status: "resolved",
    eventKeys: ["resolved"],
    label: "Emergency Resolved",
    pendingHint: () => "Closes when help finishes",
  },
]

function buildStatusTimeline(alert: EmergencyAlert): TimelineRow[] {
  const timeline = alert.timeline?.length
    ? alert.timeline
    : (alert.status_events ?? []).map((event) => ({
        event_key: event.event_key,
        title: event.label,
        description: event.note,
        at: event.created_at,
      }))
  const byKey = new Map<
    string,
    { title: string; description: string; at: string }
  >()
  for (const entry of timeline) {
    if (!byKey.has(entry.event_key)) {
      byKey.set(entry.event_key, {
        title: entry.title,
        description: entry.description,
        at: entry.at,
      })
    }
  }

  const hitFor = (keys: string[]) => {
    for (const key of keys) {
      const found = byKey.get(key)
      if (found) return found
    }
    return null
  }

  const reachedIndex = PIPELINE.reduce(
    (highest, step, index) => (hitFor(step.eventKeys) ? index : highest),
    -1
  )

  const rows: TimelineRow[] = PIPELINE.map((step, index) => {
    const hit = hitFor(step.eventKeys)
    let state: TimelineRow["state"]

    if (!isEmergencyActive(alert.status)) {
      state = "done"
    } else if (index < reachedIndex) {
      state = "done"
    } else if (index === reachedIndex) {
      state = "current"
    } else {
      state = "pending"
    }

    return {
      key: step.status,
      status: step.status,
      label: hit?.title || step.label,
      note:
        hit?.description ||
        (state === "pending" ? step.pendingHint(alert) : step.label),
      time:
        hit?.at ??
        (index === 0 && state !== "pending" ? alert.created_at : null),
      state,
    }
  })

  // Legacy records may still carry escalation_required. Treat them as the
  // automated responder-search state; the server retries these records without
  // handing them back to an official.
  if (alert.status === "escalation_required") {
    for (const row of rows) {
      row.state = row.status === "submitted" ? "done" : "pending"
    }
    const routingRow = rows.find((row) => row.status === "routed")
    if (routingRow) {
      routingRow.label = "Response unit assigned"
      routingRow.note = assignedUnitWaitingText(alert)
      routingRow.time = alert.updated_at
      routingRow.state = "current"
    }
  }

  const cancelHit = byKey.get("cancelled") ?? byKey.get("false_alarm")
  if (alert.status === "cancelled" || alert.status === "false_alarm") {
    rows.push({
      key: "cancelled",
      status: "cancelled",
      label: cancelHit?.title || "Emergency Cancelled",
      note: cancelHit?.description || "This emergency was closed.",
      time: cancelHit?.at ?? alert.updated_at,
      state: "cancelled",
    })
  }

  return rows
}

function statusText(alert: EmergencyAlert) {
  switch (alert.status) {
    case "submitted":
      return "Your emergency has been received."
    case "routing":
      return "The system is finding the appropriate response unit."
    case "routed":
      return "A responder has been assigned to your location."
    case "awaiting_acknowledgment":
      return assignedUnitWaitingText(alert)
    case "acknowledged":
      return assignedUnitWaitingText(alert)
    case "en_route":
      return "Responder is on the way."
    case "nearby":
      return "Responder is near your location."
    case "arrived":
      return "Responder has arrived."
    case "resident_safe":
      return "You reported that you are safe. The barangay is confirming with the responder."
    case "backup_requested":
      return "Extra help is being arranged for your emergency."
    case "backup_assigned":
      return "A backup responder has been assigned."
    case "in_progress":
      return "Responders are on the scene handling your emergency."
    case "transfer_required":
      return "Your case is being handed to a different response unit."
    case "escalation_required":
      return assignedUnitWaitingText(alert)
    case "resolved":
      return "Emergency has been resolved."
    case "closed":
      return "This alert was closed by the barangay after review."
    case "invalid":
      return "This alert was marked invalid after review."
    case "false_alarm":
      return "This alert was marked as a false alarm."
    case "cancelled":
      return "Emergency was cancelled."
    default:
      return "Your emergency alert is being handled."
  }
}

function headline(alert: EmergencyAlert) {
  if (["en_route", "nearby", "arrived"].includes(alert.status))
    return "Help is on the way"
  if (alert.status === "submitted" || alert.status === "routing")
    return "Finding a response unit"
  if (
    alert.status === "routed" ||
    alert.status === "awaiting_acknowledgment" ||
    alert.status === "acknowledged"
  )
    return "Responder assigned"
  if (alert.status === "backup_requested" || alert.status === "backup_assigned")
    return "Extra help on the way"
  if (alert.status === "in_progress") return "Response in progress"
  if (alert.status === "transfer_required") return "Transferring response"
  if (alert.status === "escalation_required") {
    return "Response unit assigned"
  }
  if (alert.status === "resident_safe") return "You reported safe"
  if (alert.status === "resolved") return "Emergency resolved"
  if (alert.status === "closed" || alert.status === "cancelled")
    return "Alert closed"
  if (alert.status === "false_alarm") return "False alarm"
  if (alert.status === "invalid") return "Invalid alert"
  return "Emergency active"
}

function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const earth = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number) {
  if (meters < 1000)
    return `${Math.max(20, Math.round(meters / 10) * 10)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function formatEta(meters: number) {
  const minutes = Math.max(1, Math.ceil(meters / 250))
  return `ETA ${minutes} min`
}

function pinIcon(L: typeof leaflet, color: string = MAP_COLORS.you, size = 32) {
  return L.divIcon({
    className: "eboses-emergency-pin",
    html: glyphPinHtml({
      paths: GLYPHS.userResident,
      color,
      size,
      label: "You",
      className: "is-you",
    }),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function responderIcon(L: typeof leaflet, size = 30) {
  return L.divIcon({
    className: "",
    html: glyphPinHtml({
      paths: GLYPHS.userResponder,
      color: MAP_COLORS.responder,
      size,
      tone: "light",
      tint: true,
    }),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function EmergencyTrackingMap({
  alert,
  wide,
  className,
}: {
  alert: EmergencyAlert
  wide: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const responderMarkerRefs = useRef<Map<number, leaflet.Marker>>(new Map())
  const routeRef = useRef<RouteLayers | null>(null)
  const routeSigRef = useRef("")
  const fittedRef = useRef(false)
  const [mapReady, setMapReady] = useState(0)
  const isLive = isEmergencyActive(alert.status)
  const incidentLatitude = alert.latitude
  const incidentLongitude = alert.longitude
  const incidentTitle = headline(alert)
  const incidentExcerpt = alert.address || alert.barangay || "Reported area"
  const incidentCreatedAt = alert.created_at
  const incidentPreview = alert.media?.[0]?.preview_url ?? null

  useEffect(() => {
    let cancelled = false

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, {
        center: [Number(incidentLatitude), Number(incidentLongitude)],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      })
      mapRef.current = map

      addBaseTiles(L, map, "light", {
        maxZoom: 19,
      })
      const coverageGroup = L.layerGroup().addTo(map)
      void apiRequest<{ boundary: { geometry: unknown | null } }>("/locations/map-context/")
        .then((ctx) => {
          if (cancelled || !ctx?.boundary?.geometry) return
          drawCoverage(L, coverageGroup, {
            boundary: ctx.boundary.geometry as never,
            showBoundary: false,
            showZone: false,
            boundaryStyle: "quiet",
          })
        })
        .catch(() => undefined)
      closeHoverCardsOnLeave(map)
      const incidentMarker = L.marker([Number(incidentLatitude), Number(incidentLongitude)], {
        icon: pinIcon(L),
        zIndexOffset: 500,
      }).addTo(map)
      bindHoverCard(
        L,
        map,
        incidentMarker,
        {
          title: incidentTitle,
          excerpt: incidentExcerpt,
          date: incidentCreatedAt,
          image: incidentPreview,
        },
        32
      )
      routeSigRef.current = ""
      fittedRef.current = false
      setMapReady((value) => value + 1)
      requestAnimationFrame(() => map?.invalidateSize())
      window.setTimeout(() => map?.invalidateSize(), 400)
    }

    const responderMarkers = responderMarkerRefs.current

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      responderMarkers.forEach((marker) => marker.remove())
      responderMarkers.clear()
      routeRef.current?.remove()
      routeRef.current = null
    }
  }, [alert.id, incidentCreatedAt, incidentExcerpt, incidentLatitude, incidentLongitude, incidentPreview, incidentTitle])

  useEffect(() => {
    mapRef.current?.invalidateSize()
    window.setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [wide])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L) return

    const assignments = alert.assignments ?? []
    const current = alert.current_assignment
    const locatedAssignments =
      current && !assignments.some((a) => a.id === current.id)
        ? [current, ...assignments]
        : assignments
    const activeAssignments = isLive
      ? locatedAssignments.filter((a) =>
          [
            "assigned",
            "acknowledged",
            "en_route",
            "arrived",
            "assisting",
          ].includes(a.status)
        )
      : locatedAssignments

    for (const assignment of activeAssignments) {
      const lastLocation = assignment.last_location
      if (!lastLocation) continue
      const responderLatLng: leaflet.LatLngTuple = [
        Number(lastLocation.latitude),
        Number(lastLocation.longitude),
      ]
      const existingMarker = responderMarkerRefs.current.get(assignment.id)
      if (existingMarker) existingMarker.setLatLng(responderLatLng)
      else {
        const marker = L.marker(responderLatLng, {
          icon: responderIcon(L),
          zIndexOffset: 1000,
        }).addTo(map)
        bindHoverCard(
          L,
          map,
          marker,
          {
            title: assignment.responder.full_name,
            meta: assignment.assigned_unit?.name || "Responder",
            excerpt:
              ASSIGNMENT_STATUS_LABELS[assignment.status] ??
              assignment.status.replace(/_/g, " "),
            date: assignment.assigned_at,
          },
          30
        )
        responderMarkerRefs.current.set(assignment.id, marker)
      }
    }

    const signature = `${isLive ? "live" : "done"}|${activeAssignments
      .map(
        (a) =>
          `${a.id}:${a.last_location?.latitude ?? ""},${a.last_location?.longitude ?? ""}`
      )
      .join("|")}|${alert.route ? JSON.stringify(alert.route.geometry) : ""}`
    if (signature === routeSigRef.current) return
    routeSigRef.current = signature

    routeRef.current?.remove()
    const destination: leaflet.LatLngTuple = [
      Number(alert.latitude),
      Number(alert.longitude),
    ]
    const primary =
      activeAssignments.find((item) => item.last_location)?.last_location ??
      null
    const { road, approach, connectors } = routeRenderGeometry(alert.route, {
      origin: primary
        ? [Number(primary.latitude), Number(primary.longitude)]
        : null,
      destination,
    })
    routeRef.current = drawRoute(L, map, {
      road,
      approach,
      connectors,
      live: isLive,
    })

    if (fittedRef.current) return
    fittedRef.current = true
    if (routeRef.current) {
      map.fitBounds(L.latLngBounds(routeRef.current.points), {
        padding: [44, 44],
        maxZoom: 17,
      })
    } else if (!isLive && activeAssignments.length === 0) {
      map.fitBounds(L.latLngBounds([destination]), {
        padding: [44, 44],
        maxZoom: 17,
      })
    }
  }, [
    alert.id,
    alert.latitude,
    alert.longitude,
    alert.assignments,
    alert.current_assignment,
    alert.route,
    isLive,
    mapReady,
  ])

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full bg-tint" />
    </div>
  )
}

/**
 * The body of the tracking sheet.
 *
 * One continuous surface: sections are separated by a hairline and introduced
 * by a small-caps label, rather than each sitting in its own bordered card.
 * Seven nested boxes inside a sheet that is already a box read as furniture,
 * and pushed the timeline — the thing a waiting resident actually watches —
 * halfway down the scroll.
 */

function Section({
  label,
  children,
  className,
}: {
  label?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mt-6 flex flex-col first-of-type:mt-0", className)}>
      {label ? (
        <p className="text-[12px] font-semibold text-neutral-500">{label}</p>
      ) : null}
      <div className={cn("flex min-h-0 flex-col", label ? "mt-3" : undefined)}>
        {children}
      </div>
    </section>
  )
}

function StatusTimeline({ alert }: { alert: EmergencyAlert }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">Updates</h3>
      <p className="mb-4 mt-1 text-xs text-neutral-500">Every status change and update on this emergency.</p>
      <EmergencyTimelineCard items={buildEmergencyTimeline(alert)} />
    </div>
  )
}

const MILESTONE_STATUSES: Array<{ status: EmergencyStatus; short: string }> = [
  { status: "submitted", short: "Received" },
  { status: "routed", short: "Assigned" },
  { status: "en_route", short: "On the way" },
  { status: "nearby", short: "Nearby" },
  { status: "arrived", short: "Arrived" },
]

/**
 * Compact horizontal progress tracker for the expanded two-column layout.
 * Shows the five main stages at a glance (vertical timeline stays for the
 * dock/mobile layouts) with the current stage's note underneath.
 */
function MilestoneStepper({ alert }: { alert: EmergencyAlert }) {
  const rows = buildStatusTimeline(alert)
  const milestones = MILESTONE_STATUSES.map(({ status, short }) => {
    const row = rows.find((row) => row.status === status)
    return row ? { ...row, short } : null
  }).filter((row): row is TimelineRow & { short: string } => Boolean(row))
  const reachedCount = milestones.filter(
    (row) => row.state !== "pending"
  ).length

  return (
    <div>
      <div className="relative">
        <div className="absolute top-[9px] right-[10%] left-[10%] h-0.5 rounded-full bg-neutral-200" />
        <div
          className="absolute top-[9px] left-[10%] h-0.5 rounded-full bg-brand-navy transition-all duration-500"
          style={{
            width: `calc(80% * ${Math.max(0, reachedCount - 1) / Math.max(1, milestones.length - 1)})`,
          }}
        />
        <div className="relative z-[1] flex w-full">
          {milestones.map((row) => (
            <span key={row.key} className="flex flex-1 justify-center">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full",
                  row.state === "done" && "bg-brand-navy text-white",
                  row.state === "current" &&
                    "sos-timeline__now bg-brand-orange",
                  row.state === "pending" &&
                    "border-2 border-neutral-200 bg-white",
                  row.state === "cancelled" && "bg-sos text-white"
                )}
                aria-hidden
              >
                {row.state === "done" ? (
                  <CheckIcon className="size-2.5" strokeWidth={3.5} />
                ) : row.state === "current" ? (
                  <span className="size-1 rounded-full bg-brand-orange" />
                ) : row.state === "cancelled" ? (
                  <XIcon className="size-2.5" strokeWidth={3} />
                ) : null}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex w-full justify-between">
        {milestones.map((row) => (
          <span
            key={row.key}
            className="flex flex-1 flex-col items-center gap-0.5 text-center"
          >
            <span
              className={cn(
                "text-[10px] leading-4 font-medium",
                row.state === "current"
                  ? "font-semibold text-neutral-900"
                  : row.state === "pending"
                    ? "text-neutral-400"
                    : "text-neutral-600"
              )}
            >
              {row.short}
            </span>
            <span className="block h-3 text-[9px] leading-3 text-neutral-400 tabular-nums">
              {row.time && row.state !== "pending" ? formatClock(row.time) : ""}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function DetailsColumn({
  alert,
  connectionState,
  distance,
  canAppeal,
  appealReason,
  setAppealReason,
  appealBusy,
  submitAppeal,
  appealHistory,
  callResponder,
  callingResponder,
  milestoneMode,
}: {
  alert: EmergencyAlert
  connectionState: "connecting" | "live" | "degraded"
  distance: number | null
  canAppeal: boolean
  appealReason: string
  setAppealReason: (v: string) => void
  appealBusy: boolean
  submitAppeal: () => void
  appealHistory: EmergencyAlert["appeals"]
  callResponder: () => void
  callingResponder: boolean
  /** Expanded two-column layout: compact horizontal tracker instead of the vertical timeline. */
  milestoneMode?: boolean
}) {
  const live = isEmergencyActive(alert.status)
  const settled = !isEmergencyActive(alert.status)
  const address = alert.address?.trim() || alert.barangay || "Pinned location"
  const responderAssignment =
    alert.current_assignment ?? alert.active_assignments?.[0] ?? null
  const reach =
    distance !== null
      ? live
        ? `${formatDistance(distance)} · ${formatEta(distance)}`
        : `${formatDistance(distance)} · last position`
      : null
  const connection = live
    ? connectionState === "live"
      ? "Live updates"
      : connectionState === "connecting"
        ? "Connecting…"
        : "Polling for updates"
    : "Final status"
  const [lightbox, setLightbox] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const mediaItems: MediaPreviewItem[] = (alert.media ?? []).map((media) =>
    toMediaPreviewItem(media.raw_url, media.original_filename, media.mime_type)
  )

  return (
    <div className="flex flex-1 flex-col pb-2">
      <div className="pb-4">
        <p className="line-clamp-2 min-h-6 text-base leading-6 font-semibold text-neutral-900">
          {statusText(alert)}
        </p>
        <p className="mt-1 truncate text-[13px] leading-5 text-neutral-500">
          {address}
        </p>
        <div className="mt-2 flex min-h-5 flex-nowrap items-center text-[13px] whitespace-nowrap">
          {reach ? (
            <span className="shrink-0 text-neutral-600 tabular-nums">
              {reach}
            </span>
          ) : null}
          {reach ? (
            <span aria-hidden className="mx-2 text-neutral-300">
              ·
            </span>
          ) : null}
          <span className="min-w-0 truncate text-neutral-500">
            {connection}
          </span>
        </div>
      </div>

      {milestoneMode && !settled ? (
        <Section label="Status">
          <MilestoneStepper alert={alert} />
        </Section>
      ) : (
        <Section label="Status">
          <StatusTimeline alert={alert} />
        </Section>
      )}

      {responderAssignment ? (
        <Section label="Responder" className="mt-auto pt-6">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>
                {initialsFor(responderAssignment.responder)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-neutral-900">
                {responderAssignment.responder.full_name}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                {responderAssignment.assigned_unit?.short_name ||
                  roleLabel(responderAssignment.responder)}
                {" · "}
                {ASSIGNMENT_STATUS_LABELS[responderAssignment.status] ??
                  responderAssignment.status.replace(/_/g, " ")}
              </p>
            </div>
            <time className="shrink-0 text-[11px] text-neutral-400 tabular-nums">
              {formatClock(responderAssignment.assigned_at)}
            </time>
            {live ? (
              <button
                type="button"
                onClick={() => void callResponder()}
                disabled={callingResponder}
                aria-label="Call responder"
                title="Call responder"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 disabled:opacity-50"
              >
                <PhoneIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </Section>
      ) : null}

      {(alert.media ?? []).length > 0 ? (
        <Section label="Evidence">
          <div className="grid grid-cols-2 gap-2">
            {(alert.media ?? []).map((media, mediaIndex) =>
              media.mime_type.startsWith("image/") ? (
                <button
                  key={media.id}
                  type="button"
                  className="overflow-hidden rounded-[18px] border border-neutral-200 text-left"
                  onClick={() =>
                    setLightbox({ items: mediaItems, index: mediaIndex })
                  }
                >
                  <AuthenticatedMediaImage
                    src={media.preview_url}
                    alt={media.original_filename}
                    className="h-24 w-full object-cover"
                  />
                </button>
              ) : (
                <button
                  key={media.id}
                  type="button"
                  className="flex h-24 items-center justify-center gap-2 rounded-[18px] border border-neutral-200 bg-neutral-100 text-[12px] font-semibold text-neutral-700 transition-colors hover:border-neutral-300"
                  onClick={() =>
                    setLightbox({ items: mediaItems, index: mediaIndex })
                  }
                >
                  <PlayIcon className="size-4" />
                  Video evidence
                </button>
              )
            )}
          </div>
        </Section>
      ) : null}

      {appealHistory?.length ? (
        <Section label="Review history">
          <div className="space-y-3">
            {appealHistory.map((appeal) => (
              <div key={appeal.id} className="text-[12px] leading-5">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-neutral-900">
                    Review {appeal.status}
                  </span>
                  <span className="text-neutral-400">
                    {formatClock(appeal.decided_at || appeal.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-neutral-600">{appeal.reason}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {canAppeal ? (
        <Section label="Request a review">
          <p className="text-[12px] leading-5 text-neutral-500">
            Use only if this emergency was resolved or recorded incorrectly.
          </p>
          <textarea
            value={appealReason}
            onChange={(e) => setAppealReason(e.target.value)}
            placeholder="Explain what should be reviewed"
            className="mt-3 min-h-20 w-full resize-none rounded-[18px] border-[1.5px] border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
          />
          <Button
            type="button"
            disabled={appealBusy || !appealReason.trim()}
            onClick={() => void submitAppeal()}
            className="mt-3 h-11 w-full rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong"
          >
            {appealBusy ? "Submitting" : "Submit review request"}
          </Button>
        </Section>
      ) : null}

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

export function EmergencyTrackingSheet({
  initialAlert,
  open,
  onOpenChange,
  onAlertChange,
}: {
  initialAlert: EmergencyAlert | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAlertChange?: (alert: EmergencyAlert) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(false)
  const [alert, setAlert] = useState<EmergencyAlert | null>(initialAlert)
  const alertRef = useRef<EmergencyAlert | null>(initialAlert)
  const [appealReason, setAppealReason] = useState("")
  const [appealBusy, setAppealBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<
    "connecting" | "live" | "degraded"
  >(initialAlert && isEmergencyActive(initialAlert.status) ? "connecting" : "live")
  const [chatMessage, setChatMessage] = useState<EmergencyChatMessage | null>(
    null
  )
  const [chatView, setChatView] = useState(false)
  const [callingResponder, setCallingResponder] = useState(false)

  const adoptAlert = useCallback(
    (nextAlert: EmergencyAlert) => {
      if (!isNewerEmergencyAlert(alertRef.current, nextAlert)) return
      const normalized = normalizeEmergencyAlert(nextAlert)
      alertRef.current = normalized
      setAlert(normalized)
      onAlertChange?.(normalized)
    },
    [onAlertChange]
  )

  // Reset transient sheet state when the sheet closes, and adopt a newly
  // selected alert — render-adjust instead of sync setStates inside effects.
  const [prevInitialAlert, setPrevInitialAlert] = useState(initialAlert)
  if (prevInitialAlert !== initialAlert) {
    const switchedAlert = prevInitialAlert?.id !== initialAlert?.id
    setPrevInitialAlert(initialAlert)
    setAlert(initialAlert)
    if (switchedAlert) setChatView(false)
  }

  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setWide(false)
      setChatMessage(null)
      setChatView(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const el = panelRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setWide(width >= 760)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])

  // Stable primitives for the polling/websocket effects: the alert object is
  // replaced on every live update, and reconnecting the socket just because it
  // changed would fight the update channel itself.
  const alertId = alert?.id
  const alertStatus = alert?.status

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !isEmergencyActive(alertStatus))
      return
    const refreshAlert = async () => {
      try {
        const nextAlert = await getEmergency(alertId)
        adoptAlert(nextAlert)
      } catch {
        /* keep last */
      }
    }
    void refreshAlert()
    const interval = window.setInterval(
      () => void refreshAlert(),
      connectionState === "live" ? 15000 : 5000
    )
    window.addEventListener("focus", refreshAlert)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshAlert)
    }
  }, [open, alertId, alertStatus, adoptAlert, connectionState])

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !isEmergencyActive(alertStatus))
      return
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closedByComponent = false
    let reconnectAttempts = 0

    async function connect() {
      if (!alertId) return
      setConnectionState("connecting")
      try {
        const ticket = await websocketTicket()
        if (closedByComponent) return
        socket = new WebSocket(
          websocketUrl(
            `/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`
          )
        )
      } catch {
        setConnectionState("degraded")
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(30_000, 1500 * 2 ** reconnectAttempts)
        )
        return
      }
      socket.onopen = () => {
        reconnectAttempts = 0
        setConnectionState("live")
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string
            payload?: EmergencyAlert | EmergencyChatMessage
          }
          if (message.type === "emergency.chat" && message.payload) {
            setChatMessage(message.payload as EmergencyChatMessage)
            return
          }
          if (message.type !== "emergency.update" || !message.payload) return
          adoptAlert(message.payload as EmergencyAlert)
        } catch {
          /* ignore */
        }
      }
      socket.onclose = () => {
        setConnectionState("degraded")
        if (!closedByComponent) {
          reconnectAttempts += 1
          reconnectTimer = window.setTimeout(
            () => void connect(),
            Math.min(30_000, 1500 * 2 ** reconnectAttempts)
          )
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closedByComponent = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [open, alertId, alertStatus, adoptAlert])

  if (!open || !alert || typeof document === "undefined") return null

  const isLive = isEmergencyActive(alert.status)
  const settled = !isEmergencyActive(alert.status)
  const lastLocation = isLive
    ? (alert.current_assignment?.last_location ?? null)
    : (alert.assignments?.[0]?.last_location ?? null)
  const distance = lastLocation
    ? distanceMeters(
        {
          lat: Number(lastLocation.latitude),
          lng: Number(lastLocation.longitude),
        },
        { lat: Number(alert.latitude), lng: Number(alert.longitude) }
      )
    : null
  const pendingAppeal = alert.appeals?.find((a) => a.status === "submitted")
  const canAppeal = Boolean(alert && !isEmergencyActive(alert.status) && !pendingAppeal)
  const appealHistory = alert.appeals ?? []

  async function submitAppeal() {
    if (!alert || !appealReason.trim()) return
    setAppealBusy(true)
    try {
      await createEmergencyAppeal(alert.id, appealReason.trim())
      const nextAlert = await getEmergency(alert.id)
      adoptAlert(nextAlert)
      setAppealReason("")
      toast.success("Review request submitted")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not submit review request."
      )
    } finally {
      setAppealBusy(false)
    }
  }

  async function callResponder() {
    if (!alert || callingResponder) return
    setCallingResponder(true)
    try {
      const { phone_number } = await revealResponderContact(alert.id)
      window.location.href = `tel:${phone_number}`
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not get the responder's number."
      )
    } finally {
      setCallingResponder(false)
    }
  }

  const details = (
    <DetailsColumn
      alert={alert}
      connectionState={connectionState}
      distance={distance}
      canAppeal={canAppeal}
      appealReason={appealReason}
      setAppealReason={setAppealReason}
      appealBusy={appealBusy}
      submitAppeal={() => void submitAppeal()}
      appealHistory={appealHistory}
      callResponder={() => void callResponder()}
      callingResponder={callingResponder}
      milestoneMode={wide}
    />
  )

  const chatAvailable =
    hasActiveResponder(alert) && alert.status !== "submitted"
  const chatPaneLabel = (
    <p className="pb-3 text-[15px] leading-5 font-bold text-neutral-900">
      Chat
    </p>
  )
  const chatPanel = (
    <EmergencyChatPanel
      alertId={alert.id}
      open={open}
      disabled={!isEmergencyActive(alert.status)}
      incomingMessage={chatMessage}
      realtime={false}
      theme="light"
      variant="modern"
      className="h-full"
    />
  )

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end justify-center lg:items-center">
      <button
        type="button"
        aria-label="Close tracking"
        onClick={() => onOpenChange(false)}
        className="motion-safe:animate-in motion-safe:fade-in absolute inset-0 bg-black/50 motion-safe:duration-200"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Emergency tracking"
        className={cn(
          "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white text-neutral-900 shadow-2xl",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-auto max-lg:h-[92dvh] max-lg:rounded-t-[28px]",
          "lg:absolute lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
          "lg:h-[min(88dvh,820px)] lg:max-h-[92dvh] lg:w-[min(920px,92vw)] lg:max-w-[94vw]",
          "lg:min-h-[380px] lg:min-w-[420px] lg:rounded-[28px] lg:border lg:border-neutral-200",
          "dialog-resize-grip lg:resize lg:overflow-auto",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
        )}
      >
        <div className="flex shrink-0 flex-col items-center px-5 pt-2 lg:hidden">
          <span aria-hidden className="h-1.5 w-11 rounded-full bg-neutral-300" />
        </div>
        <div className="flex shrink-0 items-start gap-2 px-5 pt-1 pb-3 lg:pt-5">
          <div className="min-w-0 flex-1 pt-0.5">
            <p
              className={cn(
                "text-[11px] font-bold tracking-wide uppercase",
                isLive
                  ? "text-sos"
                  : settled
                    ? "text-neutral-500"
                    : "text-neutral-500"
              )}
            >
              {isLive
                ? "Live · Alert"
                : alert.status === "resolved"
                  ? "Resolved"
                  : "Closed"}
            </p>
            <h2 className="mt-0.5 truncate text-[22px] leading-[1.2] font-bold tracking-tight text-neutral-900">
              {headline(alert)}
            </h2>
          </div>
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            {chatAvailable ? (
              <button
                type="button"
                onClick={() => setChatView((v) => !v)}
                aria-pressed={chatView}
                aria-label={chatView ? "Show emergency details" : "Open chat"}
                title={chatView ? "Show emergency details" : "Open chat"}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                {chatView ? (
                  <InfoIcon className="size-[22px]" strokeWidth={2} />
                ) : (
                  <MessageCircleIcon className="size-[22px]" strokeWidth={2} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <XIcon className="size-6" strokeWidth={2} />
            </button>
          </div>
        </div>

        {wide ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,4fr)] px-5 pb-4">
            <div className="relative mr-4 min-h-0 overflow-hidden rounded-[18px] border border-neutral-200">
              <EmergencyTrackingMap alert={alert} wide={wide} />
            </div>
            {chatView && chatAvailable ? (
              <div className="flex min-h-0 flex-col pr-1">
                {chatPaneLabel}
                <div className="min-h-0 flex-1">{chatPanel}</div>
              </div>
            ) : (
              <div className="scrollbar-hide min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
                <div className="flex min-h-full flex-col">{details}</div>
              </div>
            )}
          </div>
        ) : chatView && chatAvailable ? (
          <div className="flex min-h-0 flex-1 flex-col px-5 pb-2">
            {chatPaneLabel}
            <div className="min-h-0 flex-1">{chatPanel}</div>
          </div>
        ) : (
          <div className="scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-1">
            <div className="relative mb-2 h-[min(48vh,420px)] shrink-0 overflow-hidden rounded-[18px] border border-neutral-200">
              <EmergencyTrackingMap alert={alert} wide={wide} />
            </div>
            <div className="flex flex-col">{details}</div>
          </div>
        )}

        <div className="shrink-0 border-t border-neutral-200 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-12 flex-1 rounded-full bg-brand-orange text-[15px] font-semibold text-white transition-all hover:bg-brand-orange-strong active:scale-[0.99]"
            >
              Close tracking
            </button>
          </div>
          {isLive && hasActiveResponder(alert) ? (
            <p className="mt-2 text-center text-[11px] text-neutral-400">
              A responder is already handling this alert. Contact them in chat
              if circumstances change.
            </p>
          ) : isLive &&
            ["routing", "escalation_required"].includes(alert.status) ? (
            <p className="mt-2 text-center text-[11px] text-neutral-500">
              {hadResponderAssignment(alert)
                ? "Keep this page open. Chat will reopen when a new responder is assigned."
                : "Keep this page open. Updates will appear when a response team is assigned."}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
