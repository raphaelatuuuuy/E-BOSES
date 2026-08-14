import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CheckIcon,
  CircleDotIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  RadioIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { websocketTicket, websocketUrl } from "@/lib/api"
import {
  cancelEmergency,
  createEmergencyAppeal,
  getEmergency,
  type EmergencyAlert,
  type EmergencyChatMessage,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
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
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"
import { formatClock } from "@/features/dashboard/lib/responder-format"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"

import type leaflet from "leaflet"



/**
 * Resident-facing pipeline.
 * No “barangay desk / manual review” step — after send, system auto-routes
 * to the nearest on-duty responder for this emergency type.
 */
type TimelineRow = {
  key: string
  status: EmergencyStatus
  label: string
  note: string
  time: string | null
  state: "done" | "current" | "pending" | "cancelled"
}

const PIPELINE: Array<{
  status: EmergencyStatus
  eventKeys: string[]
  label: string
  pendingHint: (alert: EmergencyAlert) => string
}> = [
  {
    status: "submitted",
    eventKeys: ["received_app", "received_sms", "received_call", "escalated_from_concern"],
    label: "Emergency Received",
    pendingHint: () => "Waiting to send",
  },
  {
    status: "routed",
    eventKeys: ["responder_assigned", "responder_reassigned"],
    label: "Responder Assigned",
    pendingHint: (alert) =>
      `Finding the nearest on-duty responder from the configured response unit for this ${alert.type.replace(/_/g, " ")} case...`,
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
  const timeline = alert.timeline ?? []
  const byKey = new Map<string, { title: string; description: string; at: string }>()
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
    -1,
  )

  const rows: TimelineRow[] = PIPELINE.map((step, index) => {
    const hit = hitFor(step.eventKeys)
    let state: TimelineRow["state"]

    if (alert.status === "resolved" || alert.status === "false_alarm") {
      state = "done"
    } else if (alert.status === "cancelled") {
      state = index <= Math.max(0, reachedIndex) ? "done" : "pending"
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
      note: hit?.description || (state === "pending" ? step.pendingHint(alert) : step.label),
      time: hit?.at ?? (index === 0 && state !== "pending" ? alert.created_at : null),
      state,
    }
  })

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
  const caseName = `this ${alert.type.replace(/_/g, " ")} case`
  switch (alert.status) {
    case "submitted":
      return `Finding the nearest responder for ${caseName}.`
    case "routing":
      return `Finding the nearest responder for ${caseName}.`
    case "routed":
      return "A responder has been assigned to your location."
    case "awaiting_acknowledgment":
      return "A responder is assigned - waiting for them to confirm."
    case "acknowledged":
      return "A responder is on the way to your location."
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
      return "The barangay is arranging another responder for your emergency."
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
  if (["en_route", "nearby", "arrived"].includes(alert.status)) return "Help is on the way"
  if (alert.status === "submitted" || alert.status === "routing") return "Finding your responder"
  if (alert.status === "awaiting_acknowledgment" || alert.status === "acknowledged") return "Responder assigned"
  if (alert.status === "backup_requested" || alert.status === "backup_assigned") return "Extra help on the way"
  if (alert.status === "in_progress") return "Response in progress"
  if (alert.status === "transfer_required") return "Transferring response"
  if (alert.status === "escalation_required") return "Arranging another responder"
  if (alert.status === "resident_safe") return "You reported safe"
  if (alert.status === "resolved") return "Emergency resolved"
  if (alert.status === "closed" || alert.status === "cancelled") return "Alert closed"
  if (alert.status === "false_alarm") return "False alarm"
  if (alert.status === "invalid") return "Invalid alert"
  return "Emergency active"
}

function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earth = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(20, Math.round(meters / 10) * 10)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function formatEta(meters: number) {
  const minutes = Math.max(1, Math.ceil(meters / 250))
  return `ETA ${minutes} min`
}


function EmergencyTrackingMap({
  alert,
  expanded,
  className,
}: {
  alert: EmergencyAlert
  expanded: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const responderMarkerRefs = useRef<Map<number, leaflet.Marker>>(new Map())
  const routeRef = useRef<RouteLayers | null>(null)
  const [mapReady, setMapReady] = useState(0)
  const isLive = ACTIVE_EMERGENCY_STATUSES.has(alert.status)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, {
        center: [Number(alert.latitude), Number(alert.longitude)],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      })
      mapRef.current = map

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map)

      const residentIcon = L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:999px;background:#2b7fff;border:3px solid white;box-shadow:0 2px 10px rgba(37,99,235,.45),0 0 0 8px rgba(43,127,255,.18)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })
      L.marker([Number(alert.latitude), Number(alert.longitude)], { icon: residentIcon }).addTo(map)
      setMapReady((value) => value + 1)
      requestAnimationFrame(() => map?.invalidateSize())
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
  }, [alert.id, alert.latitude, alert.longitude])

  useEffect(() => {
    mapRef.current?.invalidateSize()
    window.setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [expanded])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L) return

    const assignments = alert.assignments ?? []
    const activeAssignments = isLive
      ? assignments.filter((a) =>
          ["assigned", "acknowledged", "en_route", "arrived", "assisting"].includes(a.status),
        )
      : assignments

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
          icon: L.divIcon({
            className: "",
            html: `<div style="width:22px;height:22px;border-radius:999px;background:#07145f;border:3px solid white;box-shadow:0 4px 10px rgba(7,20,95,.35)"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(map)
        responderMarkerRefs.current.set(assignment.id, marker)
      }
    }

    routeRef.current?.remove()
    const destination: leaflet.LatLngTuple = [Number(alert.latitude), Number(alert.longitude)]
    const primary = activeAssignments.find((item) => item.last_location)?.last_location ?? null
    const { road, approach, connectors } = routeRenderGeometry(alert.route, {
      origin: primary
        ? [Number(primary.latitude), Number(primary.longitude)]
        : null,
      destination,
    })
    routeRef.current = drawRoute(L, map, { road, approach, connectors, live: isLive })

    if (routeRef.current) {
      map.fitBounds(L.latLngBounds(routeRef.current.points), { padding: [44, 44], maxZoom: 17 })
    } else if (!isLive && activeAssignments.length === 0) {
      map.fitBounds(L.latLngBounds([destination]), { padding: [44, 44], maxZoom: 17 })
    }
  }, [
    alert.id,
    alert.latitude,
    alert.longitude,
    alert.assignments,
    alert.route,
    isLive,
    mapReady,
  ])

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full bg-tint" />
      {/* The wheel stays bound to the sheet's scroll, so these buttons are the
          only way to zoom. */}
      <div className="absolute bottom-3 right-3 z-[600]">
        <MapControlStack className="border-black/10 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.18)]">
          <MapStackButton
            label="Zoom in"
            onClick={() => mapRef.current?.zoomIn()}
            className="text-neutral-800 hover:bg-black/5 hover:text-black"
          >
            <PlusIcon className="size-5" />
          </MapStackButton>
          <MapStackDivider className="bg-black/10" />
          <MapStackButton
            label="Zoom out"
            onClick={() => mapRef.current?.zoomOut()}
            className="text-neutral-800 hover:bg-black/5 hover:text-black"
          >
            <MinusIcon className="size-5" />
          </MapStackButton>
        </MapControlStack>
      </div>
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
    <section className={cn("-mx-4 flex flex-col border-t border-white/10 px-4", className)}>
      {label ? (
        <p className="text-[12px] font-semibold text-white/60">{label}</p>
      ) : null}
      <div className={cn("flex min-h-0 flex-col", label ? "mt-3" : undefined)}>{children}</div>
    </section>
  )
}

function StatusTimeline({ alert }: { alert: EmergencyAlert }) {
  const rows = buildStatusTimeline(alert)
  return (
    <ol className="sos-timeline relative">
      {rows.map((row, index) => {
        const next = rows[index + 1]
        const isLast = index === rows.length - 1
        // The connector belongs to the gap below this node, so it reads the
        // next row's state, not this one's. Solid up to and including the
        // active node — the responder has already travelled that stretch —
        // and dotted from there on.
        const filled = next ? next.state !== "pending" : false
        return (
          <li key={row.key} className="sos-timeline__row relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-0 left-[11px] top-7 w-px",
                  filled ? "bg-brand-orange/55" : "sos-timeline__ahead",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]",
                row.state === "done" && "bg-brand-navy text-white",
                row.state === "current" && "sos-timeline__now bg-brand-orange text-white",
                row.state === "pending" && "border-2 border-white/25 bg-transparent text-white/40",
                row.state === "cancelled" && "bg-sos text-white",
              )}
              aria-hidden
            >
              {row.state === "done" ? (
                <CheckIcon className="size-3.5" strokeWidth={3} />
              ) : row.state === "current" ? (
                <RadioIcon className="size-3.5" strokeWidth={2.5} />
              ) : row.state === "cancelled" ? (
                <XIcon className="size-3.5" strokeWidth={3} />
              ) : (
                <CircleDotIcon className="size-3 opacity-50" />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    row.state === "pending" ? "text-white/45" : "text-white",
                  )}
                >
                  {row.label}
                  {row.state === "current" ? (
                    <span className="ml-2 text-[10px] font-bold text-brand-orange">
                      Now
                    </span>
                  ) : null}
                </p>
                {row.time ? (
                  <time className="shrink-0 text-[11px] tabular-nums text-white/50">
                    {formatClock(row.time)}
                  </time>
                ) : row.state === "pending" ? (
                  <span className="shrink-0 text-[11px] text-white/30">Pending</span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-0.5 text-[12px] leading-5",
                  row.state === "pending" ? "text-white/35" : "text-white/70",
                )}
              >
                {row.note}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const MILESTONE_STATUSES: EmergencyStatus[] = [
  "submitted",
  "routed",
  "en_route",
  "nearby",
  "arrived",
]

/**
 * Compact horizontal progress tracker for the expanded two-column layout.
 * Shows the five main stages at a glance (vertical timeline stays for the
 * dock/mobile layouts) with the current stage's note underneath.
 */
function MilestoneStepper({ alert }: { alert: EmergencyAlert }) {
  const rows = buildStatusTimeline(alert)
  const milestones = MILESTONE_STATUSES.map((status) =>
    rows.find((row) => row.status === status),
  ).filter((row): row is TimelineRow => Boolean(row))
  const currentRow =
    milestones.find((row) => row.state === "current") ??
    [...milestones].reverse().find((row) => row.state === "done")
  const reachedCount = milestones.filter((row) => row.state !== "pending").length

  return (
    <div>
      <div className="relative">
        {/* Track spans the node centers: nodes sit centered in their
            flex-1 columns at 10%, 30%, 50%, 70%, 90% of the width. */}
        <div className="absolute left-[10%] right-[10%] top-[9px] h-0.5 rounded-full bg-white/15" />
        <div
          className="absolute left-[10%] top-[9px] h-0.5 rounded-full bg-brand-navy/80 transition-all duration-500"
          style={{ width: `calc(80% * ${Math.max(0, reachedCount - 1) / Math.max(1, milestones.length - 1)})` }}
        />
        <div className="relative z-[1] flex w-full">
          {milestones.map((row) => (
            <span key={row.key} className="flex flex-1 justify-center">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border-2 bg-brand-navy",
                  row.state === "done" && "border-neutral-300 bg-brand-navy text-white",
                  row.state === "current" && "sos-timeline__now border-brand-orange bg-brand-orange text-white",
                  row.state === "pending" && "border-white/25 text-transparent",
                  row.state === "cancelled" && "border-sos bg-sos text-white",
                )}
                aria-hidden
              >
                {row.state === "done" ? (
                  <CheckIcon className="size-3" strokeWidth={3} />
                ) : row.state === "current" ? (
                  <RadioIcon className="size-3" strokeWidth={2.5} />
                ) : row.state === "cancelled" ? (
                  <XIcon className="size-3" strokeWidth={3} />
                ) : null}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex w-full justify-between">
        {milestones.map((row) => (
          <span
            key={row.key}
            className={cn(
              "flex-1 text-center text-[10px] font-semibold leading-4",
              row.state === "pending" ? "text-white/45" : "text-white/80",
            )}
          >
            {row.label}
          </span>
        ))}
      </div>
      {currentRow?.note ? (
        <p className="mt-3 border-t border-white/10 pt-3 text-[12px] leading-5 text-white/70">
          {currentRow.note}
        </p>
      ) : null}
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
  chatOpen,
  chatMessage,
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
  chatOpen: boolean
  chatMessage: EmergencyChatMessage | null
  /** Expanded two-column layout: compact horizontal tracker instead of the vertical timeline. */
  milestoneMode?: boolean
}) {
  const live = ACTIVE_EMERGENCY_STATUSES.has(alert.status)
  const address = alert.address?.trim() || alert.barangay || "Pinned location"
  const hasResponder = (alert.assignments?.length ?? 0) > 0 || Boolean(alert.current_assignment)
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
  const [lightbox, setLightbox] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const mediaItems: MediaPreviewItem[] = alert.media.map((media) =>
    toMediaPreviewItem(media.raw_url, media.original_filename, media.mime_type),
  )

  return (
    <div className="flex flex-1 flex-col pb-2">
      <div className="pb-4">
        <p className="text-base font-semibold leading-6 text-white">{statusText(alert)}</p>
        <p className="mt-1 text-[13px] leading-5 text-white/70">{address}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          {reach ? <span className="tabular-nums text-white/80">{reach}</span> : null}
          {reach ? (
            <span aria-hidden className="text-white/30">
              ·
            </span>
          ) : null}
          <span className="text-white/60">{connection}</span>
        </div>
      </div>

      {milestoneMode ? (
        <Section label="Status">
          <MilestoneStepper alert={alert} />
        </Section>
      ) : (
        <Section label="Status">
          <StatusTimeline alert={alert} />
        </Section>
      )}

      <Section label="Chat">
        {hasResponder && alert.status !== "submitted" ? (
          <EmergencyChatPanel
            alertId={alert.id}
            open={chatOpen}
            disabled={alert.status === "cancelled" || alert.status === "resolved"}
            incomingMessage={chatMessage}
            realtime={false}
            bare
          />
        ) : (
          <div className="flex min-h-[140px] items-center justify-center">
            <p className="text-[12px] leading-5 text-white/55">
              Chat opens once a responder is assigned to this emergency.
            </p>
          </div>
        )}
      </Section>

      {alert.media.length > 0 ? (
        <Section label="Evidence">
          <div className="grid grid-cols-2 gap-2">
            {alert.media.map((media, mediaIndex) =>
              media.mime_type.startsWith("image/") ? (
                <button
                  key={media.id}
                  type="button"
                  className="overflow-hidden rounded-lg border border-white/15 text-left"
                  onClick={() => setLightbox({ items: mediaItems, index: mediaIndex })}
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
                  className="flex h-24 items-center justify-center gap-2 rounded-lg border border-white/15 bg-black/20 text-[12px] font-semibold text-white/85 transition-colors hover:border-white/30"
                  onClick={() => setLightbox({ items: mediaItems, index: mediaIndex })}
                >
                  <PlayIcon className="size-4" />
                  Video evidence
                </button>
              ),
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
                  <span className="font-semibold text-white">Review {appeal.status}</span>
                  <span className="text-white/50">
                    {formatClock(appeal.decided_at || appeal.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-white/70">{appeal.reason}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {canAppeal ? (
        <Section label="Request a review">
          <p className="text-[12px] leading-5 text-white/65">
            Use only if this emergency was resolved or recorded incorrectly.
          </p>
          <textarea
            value={appealReason}
            onChange={(e) => setAppealReason(e.target.value)}
            placeholder="Explain what should be reviewed"
            className="mt-3 min-h-20 w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-brand-orange"
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
  const isDesktop = useIsDesktop()
  const [expanded, setExpanded] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [alert, setAlert] = useState<EmergencyAlert | null>(initialAlert)
  const [appealReason, setAppealReason] = useState("")
  const [appealBusy, setAppealBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelBusy, setCancelBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "degraded">(
    initialAlert && ACTIVE_EMERGENCY_STATUSES.has(initialAlert.status) ? "connecting" : "live"
  )
  const [chatMessage, setChatMessage] = useState<EmergencyChatMessage | null>(null)

  // Reset transient sheet state when the sheet closes, and adopt a newly
  // selected alert — render-adjust instead of sync setStates inside effects.
  const [prevInitialAlert, setPrevInitialAlert] = useState(initialAlert)
  if (prevInitialAlert !== initialAlert) {
    setPrevInitialAlert(initialAlert)
    setAlert(initialAlert)
  }

  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setExpanded(false)
      setDetailsExpanded(false)
      setChatMessage(null)
      setCancelOpen(false)
      setCancelReason("")
    }
  }

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
    if (!open || !alertId || !alertStatus || !ACTIVE_EMERGENCY_STATUSES.has(alertStatus) || connectionState !== "degraded") return
    const interval = window.setInterval(async () => {
      try {
        const nextAlert = await getEmergency(alertId)
        setAlert(nextAlert)
        onAlertChange?.(nextAlert)
      } catch {
        /* keep last */
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [open, alertId, alertStatus, connectionState, onAlertChange])

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !ACTIVE_EMERGENCY_STATUSES.has(alertStatus)) return
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
          websocketUrl(`/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        setConnectionState("degraded")
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(30_000, 1500 * 2 ** reconnectAttempts),
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
          setAlert(message.payload as EmergencyAlert)
          onAlertChange?.(message.payload as EmergencyAlert)
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
            Math.min(30_000, 1500 * 2 ** reconnectAttempts),
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
  }, [open, alertId, alertStatus, onAlertChange])

  if (!open || !alert || typeof document === "undefined") return null

  const isLive = ACTIVE_EMERGENCY_STATUSES.has(alert.status)
  const lastLocation = isLive
    ? alert.current_assignment?.last_location ?? null
    : alert.assignments?.[0]?.last_location ?? null
  const distance =
    lastLocation
      ? distanceMeters(
          { lat: Number(lastLocation.latitude), lng: Number(lastLocation.longitude) },
          { lat: Number(alert.latitude), lng: Number(alert.longitude) },
        )
      : null
  const pendingAppeal = alert.appeals?.find((a) => a.status === "submitted")
  const canAppeal = Boolean(alert && ["resolved", "cancelled"].includes(alert.status) && !pendingAppeal)
  const appealHistory = alert.appeals ?? []
  const canCancel = ["submitted", "routing", "routed", "awaiting_acknowledgment"].includes(alert.status)

  async function submitCancellation() {
    const reason = cancelReason.trim()
    if (!alert || reason.length < 10) return
    setCancelBusy(true)
    try {
      const nextAlert = await cancelEmergency(alert.id, reason)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      setCancelOpen(false)
      setCancelReason("")
      toast.success("Emergency alert cancelled")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel this emergency alert.")
    } finally {
      setCancelBusy(false)
    }
  }

  async function submitAppeal() {
    if (!alert || !appealReason.trim()) return
    setAppealBusy(true)
    try {
      await createEmergencyAppeal(alert.id, appealReason.trim())
      const nextAlert = await getEmergency(alert.id)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      setAppealReason("")
      toast.success("Review request submitted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit review request.")
    } finally {
      setAppealBusy(false)
    }
  }

  // One chip: what state this alert is in. Distance, connection and the
  // resident's address all read once, in the sheet header below.
  const mapOverlay = (
    <div className="pointer-events-none absolute left-3 top-3 z-[500]">
      {isLive ? (
        <span className="w-fit rounded-full bg-sos px-2.5 py-1 text-[10px] font-bold tracking-wide text-white shadow-md">
          Live · Alert
        </span>
      ) : alert.status === "resolved" ? (
        <span className="w-fit rounded-full bg-brand-navy px-2.5 py-1 text-[10px] font-bold tracking-wide text-white shadow-md">
          Resolved
        </span>
      ) : alert.status === "cancelled" ? (
        <span className="w-fit rounded-full bg-neutral-600 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white shadow-md">
          Closed
        </span>
      ) : null}
    </div>
  )

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
      chatOpen={open}
      chatMessage={chatMessage}
      milestoneMode={isDesktop && expanded}
    />
  )

  const toggleDetails = () => setDetailsExpanded((v) => !v)

  return createPortal(
    <div className="fixed inset-0 z-[260]">
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/60",
          isDesktop && !expanded && "bg-black/45",
        )}
        aria-label="Close tracking"
        onClick={() => onOpenChange(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Emergency tracking"
        className={cn(
          "z-10 flex flex-col overflow-hidden bg-brand-navy text-white",
          !isDesktop && "fixed inset-0 h-full w-full",
          isDesktop && !expanded &&
            "fixed bottom-6 right-6 max-h-[min(720px,calc(100dvh-2rem))] w-[min(400px,calc(100vw-2.5rem))] rounded-2xl border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.45)]",
          isDesktop && expanded &&
            "fixed left-1/2 top-1/2 max-h-[min(calc(100dvh-3rem),880px)] w-[min(calc(100vw-3rem),1080px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
        )}
      >
        <header className="flex shrink-0 items-center gap-2 bg-sos px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold sm:text-base">{headline(alert)}</h2>
          </div>
          {isDesktop ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-brand-navy">
          {isDesktop && expanded ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
              <div className="relative min-h-[min(420px,60vh)] border-r border-white/10">
                <EmergencyTrackingMap alert={alert} expanded={expanded} />
                {mapOverlay}
              </div>
              <div className="scrollbar-hide min-h-0 overflow-y-auto overscroll-contain px-4">
                <div className="ops-pane-fade flex min-h-full flex-col">{details}</div>
              </div>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "relative shrink-0 border-b border-white/10",
                  isDesktop ? "h-[250px]" : detailsExpanded ? "h-[min(35vh,200px)]" : "h-[65vh]",
                )}
              >
                <EmergencyTrackingMap alert={alert} expanded={expanded} />
                {mapOverlay}
              </div>
              {!isDesktop && !detailsExpanded ? (
                <button
                  type="button"
                  onClick={toggleDetails}
                  className="flex shrink-0 flex-col items-center gap-1 bg-nav-bg py-2"
                >
                  <span className="h-1 w-10 rounded-full bg-white/30" />
                  <span className="text-[11px] font-semibold text-white/60">Show details</span>
                </button>
              ) : null}
              {!isDesktop && detailsExpanded ? (
                <button
                  type="button"
                  onClick={toggleDetails}
                  className="flex shrink-0 flex-col items-center gap-1 bg-nav-bg py-2"
                >
                  <span className="h-1 w-10 rounded-full bg-white/30" />
                  <span className="text-[11px] font-semibold text-white/60">Hide details</span>
                </button>
              ) : null}
              <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
                <div className="ops-pane-fade flex min-h-full flex-col">{details}</div>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-nav-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {cancelOpen && canCancel ? (
            <div className="mb-3 rounded-xl border border-sos/30/25 bg-sos/10 p-3">
              <label htmlFor="emergency-cancel-reason" className="text-[13px] font-semibold text-white">
                Why are you cancelling?
              </label>
              <p className="mt-1 text-[11px] leading-4 text-white/55">
                Assigned responders will see this reason. Enter at least 10 characters.
              </p>
              <textarea
                id="emergency-cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value.slice(0, 500))}
                placeholder="Example: Sent by accident; everyone here is safe."
                className="mt-2 min-h-20 w-full resize-none rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-sos/30"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCancelOpen(false)
                    setCancelReason("")
                  }}
                  className="h-10 flex-1 rounded-lg border border-white/15 text-[13px] font-semibold text-white hover:bg-white/10"
                >
                  Keep alert
                </button>
                <button
                  type="button"
                  disabled={cancelBusy || cancelReason.trim().length < 10}
                  onClick={() => void submitCancellation()}
                  className="h-10 flex-1 rounded-lg bg-sos text-[13px] font-semibold text-white hover:bg-sos disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {cancelBusy ? "Cancelling…" : "Confirm cancel"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            {canCancel && !cancelOpen ? (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="h-11 flex-1 rounded-full border border-sos/30/40 text-[14px] font-semibold text-sos hover:bg-sos/15"
              >
                Cancel alert
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-11 flex-1 rounded-full bg-brand-orange text-[14px] font-semibold text-white hover:bg-brand-orange-strong"
            >
              Close tracking
            </button>
          </div>
          {isLive && !canCancel ? (
            <p className="mt-2 text-center text-[11px] text-white/50">
              A responder is already handling this alert. Contact them in chat if circumstances change.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}