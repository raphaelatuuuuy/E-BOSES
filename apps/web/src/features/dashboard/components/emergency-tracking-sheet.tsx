import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  FootprintsIcon,
  InfoIcon,
  LocateFixedIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
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
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { buildEmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline-lib"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import type { ConcernTimelineEntry } from "@/features/dashboard/components/concerns/concern-timeline-lib"
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
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import {
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import {
  StreetViewModal,
  type StreetViewCoord,
} from "@/features/dashboard/components/map/street-view"
import {
  SheetDialog,
  SheetIconButton,
} from "@/features/dashboard/components/sheet-dialog"

import type leaflet from "leaflet"

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

const RESPONDER_STATUS_HEADLINES: Record<string, string> = {
  assigned: "Responder is assigned to your location",
  acknowledged: "Responder is preparing to respond",
  en_route: "Responder is on the way",
  nearby: "Responder is almost there",
  arrived: "Responder has arrived",
  assisting: "Responder is assisting at your location",
}

function hasActiveResponder(alert: EmergencyAlert) {
  return Boolean(activeResponderAssignment(alert))
}

function activeResponderAssignment(alert: EmergencyAlert) {
  const assignments = [
    alert.current_assignment,
    ...(alert.active_assignments ?? []),
    ...(alert.assignments ?? []),
  ]
  return (
    assignments.find(
      (assignment) =>
        assignment && ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)
    ) ?? null
  )
}

function responderStatusHeadline(alert: EmergencyAlert) {
  const assignment = activeResponderAssignment(alert)
  return assignment
    ? RESPONDER_STATUS_HEADLINES[assignment.status] ??
        "Responder is assigned to your location"
    : null
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

function statusText(alert: EmergencyAlert) {
  switch (alert.status) {
    case "submitted":
      return "Your emergency has been received."
    case "routing":
      return "The system is finding the appropriate response unit."
    case "routed":
      return "Responder is assigned to your location"
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

function pinIcon(L: typeof leaflet, color: string = MAP_COLORS.you, size = 32) {
  return L.divIcon({
    className: "eboses-emergency-pin",
    html: glyphPinHtml({
      paths: GLYPHS.emergency,
      color,
      size,
      tint: true,
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

function tipDistanceLabel(meters: number | null | undefined) {
  if (meters == null) return "Route unavailable"
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function tipEtaLabel(seconds: number | null | undefined) {
  if (seconds == null) return "ETA unavailable"
  return `ETA ${Math.max(1, Math.round(seconds / 60))} min`
}

function EmergencyTrackingMap({
  alert,
  wide,
  onBack,
  className,
}: {
  alert: EmergencyAlert
  wide: boolean
  onBack: () => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const responderMarkerRefs = useRef<Map<number, leaflet.Marker>>(new Map())
  const responderTipRefs = useRef<Map<number, leaflet.Tooltip>>(new Map())
  const focusResponderRef = useRef<((id: number) => void) | null>(null)
  const routeRef = useRef<RouteLayers | null>(null)
  const routeSigRef = useRef("")
  const fittedRef = useRef(false)
  const recenterRef = useRef<(() => void) | null>(null)
  const [mapReady, setMapReady] = useState(0)
  const [streetView, setStreetView] = useState<StreetViewCoord | null>(null)
  const [streetViewBottom, setStreetViewBottom] = useState<number | null>(null)
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
      void apiRequest<{ boundary: { geometry: unknown | null } }>(
        "/locations/map-context/"
      )
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
      const incidentMarker = L.marker(
        [Number(incidentLatitude), Number(incidentLongitude)],
        {
          icon: pinIcon(L, MAP_COLORS.emergency),
          zIndexOffset: 500,
        }
      ).addTo(map)
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
      const centerView = () => {
        map?.setView(
          [Number(incidentLatitude), Number(incidentLongitude)],
          18,
          { animate: false }
        )
      }
      recenterRef.current = centerView
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
      recenterRef.current = null
      focusResponderRef.current = null
      responderMarkers.forEach((marker) => marker.remove())
      responderMarkers.clear()
      responderTipRefs.current.forEach((tip) => tip.remove())
      responderTipRefs.current.clear()
      routeRef.current?.remove()
      routeRef.current = null
    }
  }, [
    alert.id,
    incidentCreatedAt,
    incidentExcerpt,
    incidentLatitude,
    incidentLongitude,
    incidentPreview,
    incidentTitle,
  ])

  useEffect(() => {
    mapRef.current?.invalidateSize()
    window.setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [wide])

  useEffect(() => {
    if (!streetView) {
      return
    }

    const visibleSheet = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-sheet-dialog="true"]')
      ).find((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }) ?? null

    const updateOverlayBounds = () => {
      const sheet = visibleSheet()
      const sheetTop = sheet?.getBoundingClientRect().top ?? window.innerHeight
      const sheetCornerOverlap = 28
      setStreetViewBottom(
        Math.max(
          0,
          Math.round(window.innerHeight - sheetTop - sheetCornerOverlap)
        )
      )
    }

    updateOverlayBounds()
    const sheet = visibleSheet()
    const observer = sheet ? new ResizeObserver(updateOverlayBounds) : null
    if (sheet && observer) observer.observe(sheet)
    window.addEventListener("resize", updateOverlayBounds)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", updateOverlayBounds)
    }
  }, [streetView])

  useEffect(() => {
    const onFocusResponder = (event: Event) => {
      const id = (event as CustomEvent<{ assignmentId?: number }>).detail
        ?.assignmentId
      if (id == null) return
      focusResponderRef.current?.(id)
    }
    window.addEventListener("eboses:focus-responder", onFocusResponder)
    return () =>
      window.removeEventListener("eboses:focus-responder", onFocusResponder)
  }, [])

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
      const tipRoute =
        assignment.route ??
        (assignment.id === activeAssignments[0]?.id ? alert.route : null)
      const tipLabel = tipRoute?.geometry
        ? `${tipDistanceLabel(tipRoute.distance_meters)} · ${tipEtaLabel(tipRoute.eta_seconds)}`
        : (ASSIGNMENT_STATUS_LABELS[assignment.status] ??
          assignment.status.replace(/_/g, " "))
      const existingMarker = responderMarkerRefs.current.get(assignment.id)
      if (existingMarker) existingMarker.setLatLng(responderLatLng)
      else {
        const marker = L.marker(responderLatLng, {
          icon: responderIcon(L),
          zIndexOffset: 1000,
        }).addTo(map)
        marker.on("click", () => {
          map.flyTo(marker.getLatLng(), 17, { animate: true })
        })
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
      const existingTip = responderTipRefs.current.get(assignment.id)
      if (existingTip) {
        existingTip.setLatLng(responderLatLng)
        existingTip.setContent(tipLabel)
      } else {
        const tip = L.tooltip({
          permanent: true,
          direction: "top",
          offset: [0, -18],
          className: "eboses-responder-eta-tip",
          interactive: false,
        })
          .setLatLng(responderLatLng)
          .setContent(tipLabel)
          .addTo(map)
        responderTipRefs.current.set(assignment.id, tip)
      }
    }
    for (const [id, tip] of responderTipRefs.current) {
      if (!activeAssignments.some((item) => item.id === id)) {
        tip.remove()
        responderTipRefs.current.delete(id)
      }
    }
    focusResponderRef.current = (id: number) => {
      const target = responderMarkerRefs.current.get(id)
      if (!mapRef.current || !target) return
      mapRef.current.flyTo(target.getLatLng(), 17, { animate: true })
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
    const focusMapAboveSheet = () => {
      if (!mapRef.current) return
      map.invalidateSize({ pan: false })
      const offset = Math.min(280, Math.round(map.getSize().y * 0.36))
      if (offset > 0) map.panBy([0, offset], { animate: false })
    }
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
    map.setView(destination, 17, { animate: false })
    requestAnimationFrame(focusMapAboveSheet)
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
    <>
      <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full bg-tint" />
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        title="Back"
        className="absolute top-3 left-3 z-10 flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-md transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none"
      >
        <ArrowLeftIcon className="size-5" strokeWidth={2} />
      </button>
      <div className="absolute top-3 right-3 z-10">
        <MapControlStack tone="light">
          <MapControlButton
            tone="light"
            label="Recenter emergency pin"
            onClick={() => recenterRef.current?.()}
          >
            <LocateFixedIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label="Open Street View at emergency pin"
            onClick={() =>
              setStreetView({
                lat: Number(incidentLatitude),
                lng: Number(incidentLongitude),
              })
            }
          >
            <FootprintsIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
        </MapControlStack>
      </div>
      {streetView ? (
        <div
          className="pointer-events-auto absolute inset-x-0 top-0 z-[1000]"
          style={{ bottom: `${streetViewBottom ?? 0}px` }}
        >
          <StreetViewModal
            coord={streetView}
            onMove={(next) => setStreetView(next)}
            onClose={() => setStreetView(null)}
          />
        </div>
      ) : null}
      </div>
      <style>{`
        .eboses-responder-eta-tip {
          background: #111111;
          color: #ffffff;
          border: none;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 10px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          white-space: nowrap;
        }
        .eboses-responder-eta-tip::before {
          display: none;
        }
      `}</style>
    </>
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
  // EmergencyTimelineCard's real event data is rendered with the report
  // timeline surface so both sheets share one status design.
  const intakeEventIds = new Set(
    (alert.status_events ?? [])
      .filter((event) => event.event_key.startsWith("received_"))
      .map((event) => String(event.id))
  )
  const items: ConcernTimelineEntry[] = alert.status_events?.length
    ? buildEmergencyTimeline(alert)
        .filter(
          (item) =>
            !intakeEventIds.has(item.id) && item.badge !== "Emergency received"
        )
        .map((item) => ({
          id: item.id,
          badge: item.badge,
          time: item.time,
          content: item.content ?? null,
          state: item.state as ConcernTimelineEntry["state"],
          accent: item.accent as ConcernTimelineEntry["accent"],
          icon: item.icon as ConcernTimelineEntry["icon"],
          actor: item.actor,
          actorUser: item.actorUser,
        }))
    : []

  return (
    <div>
      <h3 className="sr-only">Updates</h3>
      <ConcernTimeline items={items} collapsibleHistory large />
    </div>
  )
}

function DetailsColumn({
  alert,
  canAppeal,
  appealReason,
  setAppealReason,
  appealBusy,
  submitAppeal,
  appealHistory,
}: {
  alert: EmergencyAlert
  canAppeal: boolean
  appealReason: string
  setAppealReason: (v: string) => void
  appealBusy: boolean
  submitAppeal: () => void
  appealHistory: EmergencyAlert["appeals"]
}) {
  const live = isEmergencyActive(alert.status)
  const description =
    alert.display_description?.trim() || alert.note?.trim() || statusText(alert)
  const [lightbox, setLightbox] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const mediaItems: MediaPreviewItem[] = (alert.media ?? []).map((media) =>
    toMediaPreviewItem(media.raw_url, media.original_filename, media.mime_type)
  )

  return (
    <div className="flex flex-col pb-0">
      <div
        className={cn(
          "flex w-full flex-col gap-3 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
          live
            ? "bg-severity-critical-surface text-sos"
            : "bg-neutral-100 text-neutral-700"
        )}
      >
        <div className="flex w-full items-start gap-2">
          <TriangleAlertIcon
            className={cn(
              "mt-[2px] size-5 shrink-0",
              live ? "text-sos" : "text-neutral-600"
            )}
            strokeWidth={1.9}
            aria-hidden
          />
          <p className="min-w-0 flex-1 text-[15px] leading-relaxed font-normal break-words whitespace-pre-wrap">
            {description}
          </p>
        </div>
        {(alert.media ?? []).length > 0 ? (
          <div className="w-full border-t border-neutral-200 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {(alert.media ?? []).map((media, mediaIndex) =>
                media.mime_type.startsWith("image/") ? (
                  <button
                    key={media.id}
                    type="button"
                    className="overflow-hidden rounded-xl border border-neutral-200 text-left"
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
                    className="flex h-24 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-700"
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
          </div>
        ) : null}
      </div>

      <section className="mt-5">
        <p className="mb-2 text-[15px] font-bold tracking-tight text-neutral-900">
          Status
        </p>
        <StatusTimeline alert={alert} />
      </section>

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
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  )
  const [alert, setAlert] = useState<EmergencyAlert | null>(initialAlert)
  const alertRef = useRef<EmergencyAlert | null>(initialAlert)
  const [appealReason, setAppealReason] = useState("")
  const [appealBusy, setAppealBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<
    "connecting" | "live" | "degraded"
  >(
    initialAlert && isEmergencyActive(initialAlert.status)
      ? "connecting"
      : "live"
  )
  const [chatMessage, setChatMessage] = useState<EmergencyChatMessage | null>(
    null
  )
  const [chatView, setChatView] = useState(false)
  const [callingResponder, setCallingResponder] = useState(false)
  const [responderContact, setResponderContact] = useState<{
    key: string
    phone: string | null
    error: boolean
  } | null>(null)
  const responderContactKeyRef = useRef<string | null>(null)

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
      setChatMessage(null)
      setChatView(false)
    } else if (typeof window !== "undefined") {
      setWide(window.innerWidth >= 1024)
    }
  }

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia === "undefined"
    )
      return
    const mq = window.matchMedia("(min-width: 1024px)")
    const handler = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Stable primitives for the polling/websocket effects: the alert object is
  // replaced on every live update, and reconnecting the socket just because it
  // changed would fight the update channel itself.
  const alertId = alert?.id
  const alertStatus = alert?.status
  const responderAssignment = alert
    ? activeResponderAssignment(alert)
    : null
  const responderAssignmentId = responderAssignment?.id ?? null
  const inlineResponderPhone =
    responderAssignment?.responder.phone_number?.trim() || ""
  const responderContactKey =
    alertId && responderAssignmentId
      ? `${alertId}:${responderAssignmentId}`
      : null

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

  useEffect(() => {
    const contactKey =
      alertId && responderAssignmentId
        ? `${alertId}:${responderAssignmentId}`
        : null
    if (
      !open ||
      !alertId ||
      !alertStatus ||
      !isEmergencyActive(alertStatus) ||
      !contactKey
    ) return
    if (responderContact?.key === contactKey) return
    if (responderContactKeyRef.current === contactKey) return
    responderContactKeyRef.current = contactKey

    if (inlineResponderPhone) return

    let cancelled = false
    void revealResponderContact(alertId)
      .then(({ phone_number }) => {
        if (cancelled) return
        const phone = phone_number.trim()
        setResponderContact({ key: contactKey, phone: phone || null, error: !phone })
      })
      .catch(() => {
        if (!cancelled)
          setResponderContact({ key: contactKey, phone: null, error: true })
      })

    return () => {
      cancelled = true
      if (responderContactKeyRef.current === contactKey)
        responderContactKeyRef.current = null
    }
  }, [
    open,
    alertId,
    alertStatus,
    responderAssignmentId,
    inlineResponderPhone,
    responderContact,
  ])

  if (!open || !alert || typeof document === "undefined") return null

  const isLive = isEmergencyActive(alert.status)
  const pendingAppeal = alert.appeals?.find((a) => a.status === "submitted")
  const canAppeal = Boolean(
    alert && !isEmergencyActive(alert.status) && !pendingAppeal
  )
  const appealHistory = alert.appeals ?? []
  const responderPhone =
    inlineResponderPhone ||
    (responderContact?.key === responderContactKey
      ? responderContact.phone
      : null)
  const responderPhoneLoading = Boolean(
    responderContactKey &&
      !inlineResponderPhone &&
      responderContact?.key !== responderContactKey
  )

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
      const phone = phone_number.trim()
      if (!phone)
        throw new Error("No contact number is on file for this responder.")
      setResponderContact({
        key: responderContactKey ?? `${alert.id}:${responderAssignment?.id ?? ""}`,
        phone,
        error: false,
      })
      window.location.href = `tel:${phone}`
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
      canAppeal={canAppeal}
      appealReason={appealReason}
      setAppealReason={setAppealReason}
      appealBusy={appealBusy}
      submitAppeal={() => void submitAppeal()}
      appealHistory={appealHistory}
    />
  )

  const chatAvailable =
    hasActiveResponder(alert) && alert.status !== "submitted"
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

  return (
    <SheetDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={
        chatView
          ? "Chat"
          : isLive
            ? responderStatusHeadline(alert) ?? "Live alert"
            : "Emergency alert"
      }
      titleClassName={
        !chatView && isLive && responderStatusHeadline(alert)
          ? "text-center text-[18px] font-medium leading-snug"
          : undefined
      }
      headerTop={
        alert.address?.split(",")[0]?.trim() || alert.barangay ? (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {alert.address?.split(",")[0]?.trim() || alert.barangay}
            </span>
          </span>
        ) : undefined
      }
      size="wide"
      backdrop={
        <EmergencyTrackingMap
          alert={alert}
          wide={wide}
          onBack={() =>
            chatView ? setChatView(false) : onOpenChange(false)
          }
        />
      }
      backdropScrim={false}
      backdropInteractive
      showClose={false}
      className={cn(
        "bg-white text-neutral-900",
        chatView
          ? "h-[min(760px,72dvh)] max-h-[min(760px,72dvh)] sm:h-[min(760px,82vh)] sm:max-h-[min(760px,82vh)]"
          : "h-auto max-h-[min(760px,72dvh)] sm:max-h-[min(760px,82vh)]"
      )}
      bodyClassName={cn(
        "min-h-0 flex flex-col px-5",
        chatView ? "flex-1 pb-5" : "flex-1 pb-0"
      )}
      actions={
        chatView ? (
          <SheetIconButton
            label="Show emergency details"
            onClick={() => setChatView(false)}
          >
            <InfoIcon className="size-[22px]" strokeWidth={2} />
          </SheetIconButton>
        ) : undefined
      }
      footer={
        !chatView && isLive ? (
          <div className="space-y-3">
            {responderAssignment ? (
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("eboses:focus-responder", {
                        detail: { assignmentId: responderAssignment.id },
                      })
                    )
                  }
                  title="Show responder on map"
                  aria-label="Show responder on map"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                >
                  <UserAvatar user={responderAssignment.responder} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-neutral-900">
                      {responderAssignment.responder.full_name}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-neutral-600">
                      {responderPhoneLoading
                        ? "Loading phone…"
                        : responderPhone || "Phone unavailable"}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void callResponder()}
                  disabled={callingResponder}
                  aria-label="Call responder"
                  title="Call responder"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-normal text-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <PhoneIcon className="size-4 text-neutral-500" aria-hidden />
                  <span>Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatView(true)}
                  aria-label="Chat"
                  title="Chat"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <MessageCircleIcon className="size-4" aria-hidden />
                  <span>Chat</span>
                </button>
              </div>
            ) : null}
            <p className="text-center text-[11px] text-neutral-400">
              {hasActiveResponder(alert)
                ? "In case of changes or new details, contact the response team in chat."
                : hadResponderAssignment(alert)
                  ? "In case of changes, keep this page open while a new responder is assigned."
                  : "In case of changes or new details, keep this page open for updates."
              }
            </p>
          </div>
        ) : undefined
      }
    >
      {chatView && chatAvailable ? chatPanel : details}
    </SheetDialog>
  )
}
