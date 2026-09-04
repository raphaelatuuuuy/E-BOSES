import { useEffect, useMemo, useRef, useState } from "react"
import {
  FileIcon,
  LocateFixedIcon,
  LoaderCircleIcon,
  PhoneIcon,
  PlayIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "lucide-react"

import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { fullTimestamp } from "@/features/dashboard/components/record/emergency-adapter"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import {
  GLYPHS,
  glyphPinHtml,
  glyphPinSize,
  MAP_COLORS,
} from "@/features/dashboard/components/map/markers"
import { lucideIconPaths } from "@/features/dashboard/components/map/lucide-glyphs"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
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
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"
import { EmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline"
import { formatEventMoment } from "@/features/dashboard/lib/emergency-timeline-format"
import {
  Band,
  Fact,
  FactRow,
  Surface,
} from "@/features/dashboard/components/workspace/band"
import {
  getEmergencyRoute,
  sendEmergencyLocationPing,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import type leaflet from "leaflet"
import {
  formatTime,
  emergencyResponderAssignments,
  readableLocation,
  responderName,
  unitLabel,
} from "./lib"

import { streetOnly } from "@/features/dashboard/lib/location-text"

function coord(lat?: string | number | null, lng?: string | number | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function readCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    })
  })
}

export function IncidentMap({
  alert,
  viewerId = null,
}: {
  alert: EmergencyAlert
  viewerId?: number | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const boundsPointsRef = useRef<leaflet.LatLngTuple[]>([])
  const routeLayersRef = useRef<RouteLayers[]>([])
  const responderMarkerRef = useRef<leaflet.Marker | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const assignment = alert.current_assignment
  const settled = !isActiveEmergency(alert)
  const responderAssignments = useMemo(
    () => emergencyResponderAssignments(alert),
    [alert]
  )
  const mapAssignments = useMemo(
    () =>
      settled
        ? responderAssignments
        : assignment
          ? [assignment]
          : responderAssignments.slice(0, 1),
    [assignment, responderAssignments, settled]
  )
  const primaryAssignment = mapAssignments[0] ?? null
  const incident = coord(alert.latitude, alert.longitude)
  const responder = coord(
    primaryAssignment?.last_location?.latitude,
    primaryAssignment?.last_location?.longitude
  )

  const routeIsLive = isActiveEmergency(alert)

  const locationLabel =
    streetOnly(
      readableLocation(
        alert.display_location,
        alert.resolved_location,
        alert.reported_area,
        alert.address,
        alert.barangay
      )
    ) || "Location pinned on the map"

  const signature = [
    alert.latitude,
    alert.longitude,
    locationLabel,
    mapAssignments
      .map((item) =>
        [
          item.id,
          item.last_location?.latitude ?? "",
          item.last_location?.longitude ?? "",
          item.route?.status ?? "",
          item.route?.summary ?? "",
          item.location_history?.length ?? 0,
        ].join(":")
      )
      .join(";"),
  ].join("|")

  useEffect(() => {
    if (!containerRef.current || !incident) return
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || !incident) return
      leafletRef.current = L

      map = L.map(containerRef.current, {
        center: incident,
        zoom: 18,
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
      containerRef.current.classList.add("eboses-emergency-map")

      addBaseTiles(L, map, "light", {
        maxZoom: 19,
        className: "eboses-emergency-map-tiles",
      })

      const BASE_SIZE = 26
      const pinSize = glyphPinSize(BASE_SIZE, !settled)
      const emergencyPaths = lucideIconPaths("triangle-alert") ?? [
        "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
        "M12 9v4",
        "M12 17h.01",
      ]
      L.marker(incident, {
        icon: L.divIcon({
          className: "eboses-emergency-pin",
          html: `<div style="position:relative;width:${pinSize}px;height:${pinSize}px">${glyphPinHtml(
            {
              paths: emergencyPaths,
              content: undefined,
              color: settled ? MAP_COLORS.resolved : "#dc2626",
              size: BASE_SIZE,
              selected: !settled,
              tone: "light",
              tint: settled,
              idleNeutral: settled,
              className: settled ? "is-settled" : undefined,
            }
          )}</div>`,
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        title: locationLabel,
        zIndexOffset: 900,
      }).addTo(map)

      // Fit the view to whatever is on screen: incident + responder + the
      // drawn route. Centring on the incident at a fixed zoom clipped any
      // route longer than a couple of blocks, which made it look broken.
      const routePoints: leaflet.LatLngTuple[] = []
      for (const mapAssignment of mapAssignments) {
        const assignmentResponder = coord(
          mapAssignment.last_location?.latitude,
          mapAssignment.last_location?.longitude
        )
        const history = (mapAssignment.location_history ?? [])
          .map((ping) => coord(ping.latitude, ping.longitude))
          .filter((point): point is leaflet.LatLngTuple => point != null)
        if (history.length > 1) {
          L.polyline(history, {
            color: settled
              ? "var(--color-map-route-idle)"
              : "var(--color-map-trail)",
            weight: settled ? 2.5 : 2,
            opacity: settled ? 0.7 : 0.5,
            interactive: false,
          }).addTo(map)
        }

        const assignmentRoute =
          mapAssignment.route ??
          (mapAssignment.id === assignment?.id ? alert.route : null)
        if (
          assignmentRoute &&
          assignmentRoute.status !== "unavailable" &&
          assignmentRoute.geometry
        ) {
          const { road, approach, connectors } = routeRenderGeometry(
            assignmentRoute,
            { origin: assignmentResponder, destination: incident }
          )
          const layers = drawRoute(L, map, {
            road,
            approach,
            connectors,
            live: routeIsLive,
          })
          if (layers) {
            routeLayersRef.current.push(layers)
            routePoints.push(...layers.points)
          }
        }

        if (!assignmentResponder || !mapAssignment.responder) continue
        const responderPinSize = 26
        const marker = L.marker(assignmentResponder, {
          icon: L.divIcon({
            className: "eboses-emergency-pin",
            iconSize: [responderPinSize, responderPinSize],
            iconAnchor: [responderPinSize / 2, responderPinSize / 2],
            html: glyphPinHtml({
              paths: GLYPHS.userResponder,
              color: MAP_COLORS.responder,
              size: responderPinSize,
              label:
                viewerId != null && mapAssignment.responder.id === viewerId
                  ? "You"
                  : undefined,
            }),
          }),
        }).addTo(map)
        if (mapAssignment.id === primaryAssignment?.id) {
          responderMarkerRef.current = marker
        }
        routePoints.push(assignmentResponder)
      }
      const boundsPoints = [incident, responder, ...routePoints].filter(
        (point): point is leaflet.LatLngTuple => point != null
      )
      boundsPointsRef.current = boundsPoints
      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), {
          padding: [28, 28],
          maxZoom: 17,
          animate: false,
        })
      } else {
        map.setView(incident, 18)
      }

      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        map?.invalidateSize({ animate: false })
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(() => map?.invalidateSize({ animate: false }))
    }

    void init()
    return () => {
      cancelled = true
      resizeRef.current?.disconnect()
      resizeRef.current = null
      routeLayersRef.current.forEach((layer) => layer.remove())
      routeLayersRef.current = []
      responderMarkerRef.current = null
      mapRef.current = null
      leafletRef.current = null
      boundsPointsRef.current = []
      map?.remove()
    }
  }, [
    signature,
    alert.route,
    assignment?.id,
    mapAssignments,
    incident,
    locationLabel,
    primaryAssignment?.id,
    responder,
    routeIsLive,
    settled,
    viewerId,
  ])

  const reroute = () => {
    const map = mapRef.current
    if (map && boundsPointsRef.current.length > 1) {
      map.fitBounds(boundsPointsRef.current, {
        padding: [28, 28],
        maxZoom: 17,
        animate: true,
      })
    } else if (map && incident) {
      map.setView(incident, 18, { animate: true })
    }
    if (routeBusy || !primaryAssignment) return
    setRouteBusy(true)
    void (async () => {
      const isAssignedViewer =
        viewerId != null && primaryAssignment.responder?.id === viewerId
      let currentResponder = responder
      try {
        if (isAssignedViewer && navigator.geolocation) {
          try {
            const position = await readCurrentPosition()
            currentResponder = [
              position.coords.latitude,
              position.coords.longitude,
            ]
            await sendEmergencyLocationPing(alert.id, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
            }).catch(() => {})
          } catch {
            currentResponder = responder
          }
        }

        const next = await getEmergencyRoute(alert.id, {
          refresh: isAssignedViewer,
        })
        const currentMap = mapRef.current
        const L = leafletRef.current
        if (!currentMap || !L || !incident) return

        if (currentResponder && primaryAssignment.responder) {
          const responderPinSize = 26
          const icon = L.divIcon({
            className: "eboses-emergency-pin",
            iconSize: [responderPinSize, responderPinSize],
            iconAnchor: [responderPinSize / 2, responderPinSize / 2],
            html: glyphPinHtml({
              paths: GLYPHS.userResponder,
              color: MAP_COLORS.responder,
              size: responderPinSize,
              label: isAssignedViewer ? "You" : undefined,
            }),
          })
          if (responderMarkerRef.current) {
            responderMarkerRef.current.setLatLng(currentResponder)
            responderMarkerRef.current.setIcon(icon)
          } else {
            responderMarkerRef.current = L.marker(currentResponder, {
              icon,
            }).addTo(currentMap)
          }
        }

        if (!next?.geometry) {
          const points = [incident, currentResponder].filter(
            (point): point is leaflet.LatLngTuple => point != null
          )
          boundsPointsRef.current = points
          if (points.length > 1) {
            currentMap.fitBounds(points, {
              padding: [28, 28],
              maxZoom: 17,
              animate: true,
            })
          }
          return
        }

        const geometry = routeRenderGeometry(next, {
          origin: currentResponder,
          destination: incident,
        })
        routeLayersRef.current.forEach((layer) => layer.remove())
        const layers = drawRoute(L, currentMap, {
          ...geometry,
          live: routeIsLive,
        })
        routeLayersRef.current = layers ? [layers] : []
        const points = [
          incident,
          currentResponder,
          ...(layers?.points ?? []),
        ].filter((point): point is leaflet.LatLngTuple => point != null)
        boundsPointsRef.current = points
        if (points.length > 1) {
          currentMap.fitBounds(points, {
            padding: [28, 28],
            maxZoom: 17,
            animate: true,
          })
        }
      } catch {
        return
      } finally {
        setRouteBusy(false)
      }
    })()
  }

  if (!incident) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-[16px] bg-neutral-100 text-[13px] text-neutral-400">
        No coordinates on this alert.
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[16px] bg-tint">
      <div
        ref={containerRef}
        className="eboses-emergency-map pointer-events-auto absolute inset-0 z-0 h-full w-full"
      />
      <button
        type="button"
        onClick={reroute}
        disabled={routeBusy}
        title="Follow responder route"
        aria-label="Follow responder route"
        className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-md transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {routeBusy ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <LocateFixedIcon className="size-4.5" strokeWidth={1.9} />
        )}
      </button>
      <style>{`
        .eboses-emergency-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8eef5;
          font: inherit;
        }
        .eboses-emergency-map .leaflet-tile-pane {
          filter: saturate(0.85);
        }
        .eboses-emergency-map .leaflet-tile {
          outline: none;
          transition: filter 150ms ease;
        }
        .eboses-emergency-pin {
          background: transparent !important;
          border: none !important;
        }
        .eboses-emergency-map .eboses-pin__disc {
          background: color-mix(in srgb, var(--pin) 16%, white) !important;
          color: var(--pin) !important;
          border: 2px solid #fff !important;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15) !important;
        }
        .eboses-emergency-map .eboses-pin--glyph.is-settled .eboses-pin__disc {
          background: #eef1f4 !important;
          color: #6b7280 !important;
          border-color: #fff !important;
          box-shadow: 0 2px 7px rgba(71, 85, 105, 0.14) !important;
        }
        .eboses-emergency-map .eboses-pin__disc svg {
          display: block;
        }
        .eboses-emergency-map .eboses-pin__core {
          border: none !important;
        }
      `}</style>
    </div>
  )
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "Not closed yet"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function routeLabel(alert: EmergencyAlert) {
  const route = alert.current_assignment?.route ?? alert.route
  if (!route || route.status === "unavailable") return "Route unavailable"
  const distance =
    route.distance_meters == null
      ? "unknown distance"
      : route.distance_meters < 1000
        ? `${Math.round(route.distance_meters)} m`
        : `${(route.distance_meters / 1000).toFixed(1)} km`
  const eta =
    route.eta_seconds == null
      ? "ETA unavailable"
      : `${Math.max(1, Math.round(route.eta_seconds / 60))} min ETA`
  return `${distance} · ${eta}`
}

function elapsedSince(iso: string | null | undefined, now: number) {
  if (!iso) return null
  const ms = now - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? `${hours}h ${minutes % 60}m`
    : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function ResponseBand({
  alert,
  team,
}: {
  alert: EmergencyAlert
  team: EmergencyAlert["assignments"]
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const roster = team ?? []
  const hasContact = Boolean(alert.reporter_phone?.trim())

  const { busy: dialBusy, call: callResident } = useReporterPhone(alert)
  const unacknowledged = roster.filter(
    (assignment) => !assignment.acknowledged_at
  )
  const waiting = elapsedSince(alert.routed_at, now)
  const pings = alert.current_assignment?.location_history?.length ?? 0

  return (
    <Band
      label={
        roster.length > 0
          ? `Response · ${roster.length} unit${roster.length === 1 ? "" : "s"}`
          : "Response"
      }
      action={
        hasContact ? (
          <button
            type="button"
            onClick={() => void callResident()}
            disabled={dialBusy}
            className="inline-flex items-center gap-1.5 rounded-control bg-brand-orange px-2.5 py-1 text-[12px] font-semibold text-brand-orange-ink transition-colors hover:bg-brand-orange-strong disabled:opacity-60"
          >
            {dialBusy ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <PhoneIcon className="size-3.5" aria-hidden />
            )}
            {dialBusy ? "Opening…" : "Call resident"}
          </button>
        ) : (
          <span className="text-[12px] text-subtle-foreground">
            Contact withheld
          </span>
        )
      }
    >
      {roster.length === 0 ? (
        <p className="rounded-control bg-status-open-surface px-3 py-2 text-[12px] font-semibold text-status-open-ink">
          {alert.responding_unit
            ? `${alert.responding_unit.short_name || alert.responding_unit.name} — awaiting a responder`
            : "No unit answers this emergency type yet"}
          {waiting ? ` · routed ${waiting} ago` : ""}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {roster.map((assignment) => {
            const ack = assignment.acknowledged_at
            const arrived = assignment.arrived_at
            return (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
              >
                <UserCheckIcon
                  className="size-4 shrink-0 text-subtle-foreground"
                  aria-hidden
                />
                <span className="text-sm font-semibold text-foreground">
                  {responderName(assignment.responder)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {unitLabel(assignment.responder.responder_unit)}
                  {}
                  {assignment.source === "escalation" ? " · escalated" : ""}
                </span>
                <span
                  className="ml-auto text-[12px] font-semibold text-muted-foreground tabular-nums"
                  title={fullTimestamp(
                    arrived ?? ack ?? assignment.assigned_at
                  )}
                >
                  {arrived
                    ? formatTime(arrived)
                    : ack
                      ? formatTime(ack)
                      : (elapsedSince(assignment.assigned_at, now) ?? "")}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {roster.length > 0 && unacknowledged.length > 0 ? (
        <p className="mt-2 text-[12px] font-semibold text-severity-critical">
          {unacknowledged.length} unit{unacknowledged.length === 1 ? "" : "s"}{" "}
          have not acknowledged.
        </p>
      ) : null}

      <FactRow className="mt-3.5 border-t border-card-line pt-3">
        <Fact
          label="Road route"
          value={routeLabel(alert)}
          hint={
            pings
              ? `${pings} responder pings saved`
              : "Waiting for responder GPS"
          }
        />
        <Fact
          label="Response time"
          value={formatDuration(alert.response_duration_seconds)}
          hint={
            alert.resolved_at
              ? `Closed ${formatTime(alert.resolved_at)}`
              : "Stops on final disposition"
          }
        />
      </FactRow>
    </Band>
  )
}

function IncidentChronology({ alert }: { alert: EmergencyAlert }) {
  const logs = alert.assignment_logs ?? []
  const [showInternal, setShowInternal] = useState(false)

  if ((alert.timeline ?? []).length === 0) return null

  return (
    <Band label="Status and Timeline">
      <EmergencyTimeline
        entries={alert.timeline ?? []}
        showControls
        showNotes
      />

      {logs.length ? (
        <div className="mt-4 border-t border-card-line pt-3">
          <button
            type="button"
            onClick={() => setShowInternal((value) => !value)}
            aria-expanded={showInternal}
            className="text-micro font-semibold text-subtle-foreground transition-colors hover:text-foreground"
          >
            {showInternal ? "Hide" : "Show"} internal dispatch log (
            {logs.length})
          </button>
          {showInternal ? (
            <ul className="mt-2 space-y-1.5">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="text-[12px] leading-5 text-subtle-foreground"
                >
                  <span className="font-semibold text-muted-foreground">
                    {internalActionLabel(log.action)}
                  </span>
                  {log.responder?.full_name
                    ? ` — ${log.responder.full_name}`
                    : ""}
                  {log.note ? ` — ${log.note}` : ""}
                  <span className="block text-faint-foreground">
                    {formatEventMoment(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Band>
  )
}

function internalActionLabel(action: string) {
  const words = action.replaceAll("_", " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function EmergencyMediaGrid({
  media: alertMedia,
}: {
  media: EmergencyAlert["media"]
}) {
  const [lightbox, setLightbox] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const media = alertMedia ?? []
  const items: MediaPreviewItem[] = media.map((item) =>
    toMediaPreviewItem(
      mediaDisplaySource(item),
      item.original_filename,
      item.mime_type
    )
  )

  if (!media.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-panel border border-dashed border-card-line text-label text-subtle-foreground">
        No media attached
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {media.map((item, index) =>
        item.mime_type.startsWith("image/") ? (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightbox({ items, index })}
            className="overflow-hidden rounded-control border border-card-line bg-canvas text-left transition hover:border-brand-orange"
          >
            <AuthenticatedMediaImage
              src={item.preview_url}
              alt={`${item.original_filename} evidence photo`}
              className="h-28 w-full object-cover"
            />
          </button>
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightbox({ items, index })}
            className="flex h-28 items-center justify-center gap-2 rounded-control border border-card-line bg-canvas px-3 text-center text-[12px] font-semibold text-muted-foreground transition-colors hover:border-brand-orange hover:text-foreground"
          >
            {item.mime_type.startsWith("video/") ? (
              <>
                <PlayIcon className="size-5" /> Preview video
              </>
            ) : (
              <>
                <FileIcon className="size-5" /> Preview file
              </>
            )}
          </button>
        )
      )}
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

const IDENTITY_CAUTION: Record<string, string> = {
  unverified:
    "This number is not registered to any resident account, so the caller's identity is unconfirmed.",
  needs_review:
    "The number partly matches a resident account. Confirm who you are speaking to.",
}

function ReporterBand({ alert }: { alert: EmergencyAlert }) {
  const bySms =
    alert.location_source === "sms" || alert.location_source === "sms_landmark"

  const name =
    alert.reporter_display ||
    (alert.reporter_is_anonymous_intake
      ? "Unidentified caller"
      : "Unknown reporter")
  const caution = IDENTITY_CAUTION[alert.reporter_verification ?? ""]

  return (
    <Band label="Reported by">
      <p className="text-heading text-foreground">{name}</p>
      {}
      <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
        {bySms ? "Sent by text message." : "Sent from the E-Boses app."}
        {caution ? ` ${caution}` : ""}
      </p>
    </Band>
  )
}

function IncidentBand({ alert }: { alert: EmergencyAlert }) {
  const unresolved = alert.unresolved_fields ?? []

  return (
    <Band label="Location">
      {alert.location_confidence &&
      alert.location_confidence !== "confirmed" ? (
        <p className="text-[12px] text-severity-moderate-ink">
          {alert.location_confidence === "outside_area"
            ? "This location is outside the barangay service area."
            : "This location has not been confirmed."}
        </p>
      ) : null}

      {alert.category_needs_confirmation ? (
        <p className="mt-1 text-[12px] text-severity-moderate-ink">
          The emergency category was guessed and needs confirming.
        </p>
      ) : null}

      {unresolved.length ? (
        <p className="mt-1 text-[12px] text-severity-moderate-ink">
          Still to confirm: {unresolved.join(", ")}.
        </p>
      ) : null}
    </Band>
  )
}

export function IncidentBoard({ alert }: { alert: EmergencyAlert | null }) {
  const [recordTab, setRecordTab] = useState("details")

  if (!alert) {
    return (
      <section className="flex min-h-[520px] items-center justify-center rounded-panel border border-dashed border-card-line bg-card p-8 text-center">
        <div>
          <ShieldCheckIcon className="mx-auto size-10 text-brand-navy" />
          <p className="mt-3 text-sm font-semibold text-brand-navy">
            Select an emergency
          </p>
          <p className="mt-1 text-xs text-subtle-foreground">
            Review location, timeline, assignment, and response status.
          </p>
        </div>
      </section>
    )
  }

  const activeTeam =
    alert.assignments?.filter(
      (assignment) =>
        !["cancelled", "declined", "resolved"].includes(assignment.status)
    ) ?? []

  const detailsContent = (
    <div className="space-y-4">
      <Surface>
        <IncidentBand alert={alert} />
        <Band className="p-0">
          <IncidentMap alert={alert} />
        </Band>
        <ReporterBand alert={alert} />
        <ResponseBand alert={alert} team={activeTeam} />
        <IncidentChronology alert={alert} />
      </Surface>
    </div>
  )

  const chatContent = (
    <EmergencyChatPanel
      alertId={alert.id}
      open
      theme="light"
      disabled={alert.status === "cancelled" || alert.status === "resolved"}
      className="h-[min(320px,70svh)]"
    />
  )

  return (
    <section>
      <OpsTabs
        value={recordTab}
        onValueChange={setRecordTab}
        tabs={[
          { id: "details", label: "Details", content: detailsContent },
          { id: "chat", label: "Chat", content: chatContent },
          {
            id: "photos",
            label: "Photos",
            count: (alert.media ?? []).length,
            content: <EmergencyMediaGrid media={alert.media} />,
          },
        ]}
      />
    </section>
  )
}
