import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  FileIcon,
  FootprintsIcon,
  LocateFixedIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  NavigationIcon,
  PhoneIcon,
  PlayIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { fullTimestamp } from "@/features/dashboard/components/record/emergency-adapter"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import {
  glyphPinHtml,
  glyphPinSize,
  reportDotHtml,
  MAP_COLORS,
} from "@/features/dashboard/components/map/markers"
import { lucideIconPaths } from "@/features/dashboard/components/map/lucide-glyphs"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import { useMapFullscreen } from "@/features/dashboard/components/map/use-map-fullscreen"
import {
  StreetViewModal,
  type StreetViewCoord,
} from "@/features/dashboard/components/map/street-view"
import {
  drawRoute,
  routeRenderGeometry,
  routeStartPoint,
  type RouteLayers,
} from "@/features/dashboard/lib/route-line"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { ReportPhotoPreview } from "@/features/dashboard/components/concerns/resolved-photo"
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
  type EmergencyRoute,
} from "@/features/dashboard/emergency-api"
import {
  formatDistance,
  formatEta,
} from "@/features/dashboard/components/alerts-map/lib"
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
  onBack,
  onFullscreenChange,
}: {
  alert: EmergencyAlert
  viewerId?: number | null
  onBack?: () => void
  onFullscreenChange?: (full: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const { wrapRef, fullView, toggleFullscreen, expandStyle } =
    useMapFullscreen(
      () => mapRef.current?.invalidateSize(),
      onFullscreenChange
    )
  const boundsPointsRef = useRef<leaflet.LatLngTuple[]>([])
  const routeLayersRef = useRef<RouteLayers[]>([])
  const assignmentMarkersRef = useRef<Map<number, leaflet.Marker>>(new Map())
  const fittedKeyRef = useRef("")
  const officialLayersRef = useRef<RouteLayers | null>(null)
  const officialMarkerRef = useRef<leaflet.Marker | null>(null)
  const officialPosRef = useRef<leaflet.LatLngTuple | null>(null)
  const lastOfficialRouteRef = useRef<EmergencyRoute | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastNavFetchRef = useRef(0)
  const lastNavPingRef = useRef(0)
  const navigatingRef = useRef(false)
  const [navigating, setNavigating] = useState(false)
  const [navBusy, setNavBusy] = useState(false)
  const [mapReady, setMapReady] = useState(0)
  const [streetView, setStreetView] = useState<StreetViewCoord | null>(null)
  const [centerEta, setCenterEta] = useState<{
    distance: number | null
    eta: number | null
  } | null>(null)
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
  const incident = useMemo(
    () => coord(alert.latitude, alert.longitude),
    [alert.latitude, alert.longitude]
  )
  const incidentKey = `${alert.latitude ?? ""},${alert.longitude ?? ""}`

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

  const mapAssignmentsRef = useRef(mapAssignments)
  useEffect(() => {
    mapAssignmentsRef.current = mapAssignments
  })
  const assignmentId = assignment?.id ?? null

  const mapSig = mapAssignments
    .map((item) =>
      [
        item.id,
        item.status,
        item.last_location?.latitude ?? "",
        item.last_location?.longitude ?? "",
        item.route?.status ?? "",
        item.route?.geometry ? JSON.stringify(item.route.geometry) : "",
        item.location_history?.length ?? 0,
      ].join(":")
    )
    .join(";")
  const fitKey = `${settled}|${incidentKey}|${mapAssignments.map((item) => item.id).join(",")}`

  useEffect(() => {
    if (!containerRef.current || !incident) return
    let cancelled = false
    let map: leaflet.Map | null = null
    let settleTimer: number | undefined

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
              color: settled ? MAP_COLORS.resolved : MAP_COLORS.emergency,
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

      const frameMap = () => {
        if (cancelled || !containerRef.current) return
        const box = containerRef.current.getBoundingClientRect()
        if (!box.width || !box.height) return
        map?.invalidateSize({ animate: false })
        const bounds = boundsPointsRef.current
        if (bounds.length > 1) {
          map?.fitBounds(L.latLngBounds(bounds), {
            padding: [28, 28],
            maxZoom: 17,
            animate: false,
          })
        } else if (incident) {
          map?.setView(incident, 18)
        }
        if (navigatingRef.current && officialPosRef.current) {
          drawOfficialPreview(
            officialPosRef.current,
            lastOfficialRouteRef.current,
            false
          )
        }
      }
      frameMap()

      const observer = new ResizeObserver(() => {
        frameMap()
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(frameMap)
      settleTimer = window.setTimeout(frameMap, 250)
      setMapReady((value) => value + 1)
    }

    void init()
    return () => {
      cancelled = true
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      resizeRef.current?.disconnect()
      resizeRef.current = null
      routeLayersRef.current.forEach((layer) => layer.remove())
      routeLayersRef.current = []
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      watchIdRef.current = null
      officialLayersRef.current?.remove()
      officialLayersRef.current = null
      officialMarkerRef.current?.remove()
      officialMarkerRef.current = null
      assignmentMarkersRef.current.clear()
      fittedKeyRef.current = ""
      mapRef.current = null
      leafletRef.current = null
      boundsPointsRef.current = []
      map?.remove()
    }
  }, [incident, incidentKey, settled, locationLabel])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !incident) return
    const items = mapAssignmentsRef.current
    const origins = new Map<number, leaflet.LatLngTuple>()

    for (const mapAssignment of items) {
      if (!mapAssignment.responder) continue
      const assignmentRoute =
        mapAssignment.route ??
        (mapAssignment.id === assignmentId ? alert.route : null)
      const liveAt = coord(
        mapAssignment.last_location?.latitude,
        mapAssignment.last_location?.longitude
      )
      const at = liveAt ?? routeStartPoint(assignmentRoute)
      if (!at) continue
      origins.set(mapAssignment.id, at)
      const existing = assignmentMarkersRef.current.get(mapAssignment.id)
      if (existing) {
        existing.setLatLng(at)
        continue
      }
      const own =
        viewerId != null && mapAssignment.responder.id === viewerId
      const dotSize = own ? 14 : 12
      const marker = L.marker(at, {
        icon: L.divIcon({
          className: "",
          iconSize: [dotSize, dotSize],
          iconAnchor: [dotSize / 2, dotSize / 2],
          html: reportDotHtml(MAP_COLORS.responder, dotSize),
        }),
        keyboard: false,
      }).addTo(map)
      marker.on("click", () => {
        map.flyTo(marker.getLatLng(), 17, { animate: true })
      })
      assignmentMarkersRef.current.set(mapAssignment.id, marker)
    }
    for (const [id, marker] of assignmentMarkersRef.current) {
      if (!items.some((item) => item.id === id)) {
        marker.remove()
        assignmentMarkersRef.current.delete(id)
      }
    }

    routeLayersRef.current.forEach((layer) => layer.remove())
    routeLayersRef.current = []
    const routePoints: leaflet.LatLngTuple[] = []
    for (const mapAssignment of items) {
      const assignmentResponder =
        coord(
          mapAssignment.last_location?.latitude,
          mapAssignment.last_location?.longitude
        ) ?? origins.get(mapAssignment.id) ?? null
      const history = (mapAssignment.location_history ?? [])
        .map((ping) => coord(ping.latitude, ping.longitude))
        .filter((point): point is leaflet.LatLngTuple => point != null)
      if (history.length > 1) {
        const trail = L.polyline(history, {
          color: settled
            ? "var(--color-map-route-idle)"
            : "var(--color-map-trail)",
          weight: settled ? 2.5 : 2,
          opacity: settled ? 0.7 : 0.5,
          interactive: false,
        }).addTo(map)
        routeLayersRef.current.push({
          points: history,
          remove: () => trail.remove(),
        })
      }
      const assignmentRoute =
        mapAssignment.route ??
        (mapAssignment.id === assignmentId ? alert.route : null)
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
      if (assignmentResponder) routePoints.push(assignmentResponder)
    }
    const bounds: leaflet.LatLngTuple[] = [incident]
    for (const marker of assignmentMarkersRef.current.values()) {
      const at = marker.getLatLng()
      bounds.push([at.lat, at.lng])
    }
    boundsPointsRef.current = [...bounds, ...routePoints]
    if (fittedKeyRef.current !== fitKey) {
      fittedKeyRef.current = fitKey
      if (boundsPointsRef.current.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPointsRef.current), {
          padding: [28, 28],
          maxZoom: 17,
          animate: false,
        })
      } else {
        map.setView(incident, 18)
      }
    }
  }, [mapSig, fitKey, mapReady, viewerId, routeIsLive, assignmentId, settled])

  const drawOfficialPreview = (
    pos: leaflet.LatLngTuple,
    route: EmergencyRoute | null | undefined,
    fit = true
  ) => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !incident) return
    officialPosRef.current = pos
    lastOfficialRouteRef.current = route ?? null
    const icon = L.divIcon({
      className: "",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      html: reportDotHtml(MAP_COLORS.responder, 12),
    })
    if (officialMarkerRef.current) {
      officialMarkerRef.current.setLatLng(pos)
      officialMarkerRef.current.setIcon(icon)
    } else {
      officialMarkerRef.current = L.marker(pos, {
        icon,
        zIndexOffset: 1100,
      }).addTo(map)
    }
    officialLayersRef.current?.remove()
    officialLayersRef.current = null
    if (route?.geometry) {
      const geometry = routeRenderGeometry(route, {
        origin: pos,
        destination: incident,
      })
      officialLayersRef.current = drawRoute(L, map, {
        ...geometry,
        live: routeIsLive,
      })
      setCenterEta({
        distance: route.distance_meters,
        eta: route.eta_seconds,
      })
    } else {
      setCenterEta(null)
    }
    if (fit) {
      map.fitBounds(L.latLngBounds([pos, incident]), {
        padding: [28, 28],
        maxZoom: 17,
        animate: true,
      })
    }
  }

  const stopNavigation = () => {
    navigatingRef.current = false
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    watchIdRef.current = null
    officialLayersRef.current?.remove()
    officialLayersRef.current = null
    officialMarkerRef.current?.remove()
    officialMarkerRef.current = null
    officialPosRef.current = null
    lastOfficialRouteRef.current = null
    setCenterEta(null)
    setNavigating(false)
    setNavBusy(false)
  }

  const toggleNavigation = () => {
    if (navigatingRef.current) {
      stopNavigation()
      return
    }
    if (!incident) return
    if (!navigator.geolocation) {
      toast.error("Location is unavailable on this device.")
      return
    }
    navigatingRef.current = true
    setNavigating(true)
    setNavBusy(true)
    void (async () => {
      let position: GeolocationPosition
      try {
        position = await readCurrentPosition()
      } catch {
        navigatingRef.current = false
        setNavigating(false)
        setNavBusy(false)
        toast.error("Allow location access to navigate to this emergency.")
        return
      }
        if (!navigatingRef.current) return
        const pos: leaflet.LatLngTuple = [
          position.coords.latitude,
          position.coords.longitude,
        ]
        let route: EmergencyRoute | null = null
        try {
          route =
            (await getEmergencyRoute(alert.id, {
              origin: { latitude: pos[0], longitude: pos[1] },
            })) ?? null
        } catch {
          route = null
        }
        if (!navigatingRef.current) return
        drawOfficialPreview(pos, route)
        if (!route?.geometry) {
          toast.error("Currently experiencing issue, try again.")
        }
        setNavBusy(false)
        lastNavFetchRef.current = Date.now()
        lastNavPingRef.current = Date.now()
        void sendEmergencyLocationPing(alert.id, {
          latitude: pos[0],
          longitude: pos[1],
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }).catch(() => {})
        watchIdRef.current = navigator.geolocation.watchPosition(
          (fix) => {
            if (!navigatingRef.current) return
            const next: leaflet.LatLngTuple = [
              fix.coords.latitude,
              fix.coords.longitude,
            ]
            officialPosRef.current = next
            officialMarkerRef.current?.setLatLng(next)
            const now = Date.now()
            if (now - lastNavFetchRef.current > 12000) {
              lastNavFetchRef.current = now
              void (async () => {
                try {
                  const fresh = await getEmergencyRoute(alert.id, {
                    origin: { latitude: next[0], longitude: next[1] },
                  })
                  if (navigatingRef.current)
                    drawOfficialPreview(next, fresh ?? null, false)
                } catch {
                  if (navigatingRef.current)
                    drawOfficialPreview(
                      next,
                      lastOfficialRouteRef.current,
                      false
                    )
                }
              })()
            }
            if (now - lastNavPingRef.current > 15000) {
              lastNavPingRef.current = now
              void sendEmergencyLocationPing(alert.id, {
                latitude: next[0],
                longitude: next[1],
                accuracy: fix.coords.accuracy,
                timestamp: fix.timestamp,
              }).catch(() => {})
            }
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        )
        setNavBusy(false)
    })()
  }

  const assignmentRoute =
    mapAssignments[0]?.route ??
    (mapAssignments[0] && mapAssignments[0].id === assignmentId
      ? alert.route
      : null)
  const pillEta =
    centerEta ??
    (fullView && assignmentRoute?.geometry
      ? {
          distance: assignmentRoute.distance_meters,
          eta: assignmentRoute.eta_seconds,
        }
      : null)

  if (!incident) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-[16px] bg-neutral-100 text-[13px] text-neutral-400">
        No coordinates on this alert.
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      style={expandStyle}
      className="relative h-full w-full overflow-hidden rounded-[16px] bg-tint"
    >
      <div
        ref={containerRef}
        className="eboses-emergency-map pointer-events-auto absolute inset-0 z-0 h-full w-full"
      />
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="absolute top-3 left-3 z-10 flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-md transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-5" strokeWidth={2} />
        </button>
      ) : null}
      <div className="absolute top-3 right-3 z-10">
        <MapControlStack tone="light">
          <MapControlButton
            tone="light"
            label="Center on pin"
            onClick={() => {
              if (incident) mapRef.current?.setView(incident, 18, { animate: true })
            }}
          >
            <LocateFixedIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label="Open Street View at emergency pin"
            onClick={() => setStreetView({ lat: incident[0], lng: incident[1] })}
          >
            <FootprintsIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label={
              navigating
                ? "Stop navigation to emergency"
                : "Navigate to emergency"
            }
            active={navigating}
            onClick={toggleNavigation}
            loading={navBusy}
          >
            {navBusy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <NavigationIcon className="size-5" strokeWidth={1.9} />
            )}
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label={fullView ? "Exit full map view" : "View full map"}
            active={fullView}
            onClick={toggleFullscreen}
          >
            {fullView ? (
              <Minimize2Icon className="size-5" strokeWidth={1.9} />
            ) : (
              <Maximize2Icon className="size-5" strokeWidth={1.9} />
            )}
          </MapControlButton>
        </MapControlStack>
      </div>
      {pillEta ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
          <div className="flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
            <span className="text-[16px] leading-none font-semibold text-neutral-900">
              {`${formatEta(pillEta.eta)} · ${formatDistance(pillEta.distance)}`}
            </span>
            <span className="mt-1.5 text-[14px] leading-snug font-medium text-neutral-500">
              On the way
            </span>
          </div>
        </div>
      ) : null}
      {streetView ? (
        <StreetViewModal
          coord={streetView}
          onClose={() => setStreetView(null)}
        />
      ) : null}
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
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15) !important;
        }
        .eboses-emergency-map .eboses-pin--glyph.is-settled .eboses-pin__disc {
          background: #eef1f4 !important;
          color: #6b7280 !important;
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
            const etaRoute = assignment.route
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
                {etaRoute?.geometry ? (
                  <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-white">
                    {`${formatDistance(etaRoute.distance_meters)} · ${formatEta(etaRoute.eta_seconds)}`}
                  </span>
                ) : null}
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
  const items: MediaPreviewItem[] = media.map((item) => ({
    ...toMediaPreviewItem(
      mediaDisplaySource(item),
      item.original_filename,
      item.mime_type
    ),
    badge: "Reported issue",
  }))

  if (!media.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-panel border border-dashed border-card-line text-label text-subtle-foreground">
        No media attached
      </div>
    )
  }

  return (
    <>
      {(() => {
        const imageIndex = media.findIndex((item) =>
          item.mime_type.startsWith("image/")
        )
        const displayIndex = imageIndex >= 0 ? imageIndex : 0
        const display = media[displayIndex]
        if (!display) return null
        const openAt = () => setLightbox({ items, index: displayIndex })
        return display.mime_type.startsWith("image/") ? (
          <ReportPhotoPreview
            originalSrc={mediaDisplaySource(display)}
            alt={`${display.original_filename} evidence photo`}
            onOpen={openAt}
          />
        ) : (
          <button
            type="button"
            onClick={openAt}
            className="flex h-24 w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 text-center text-[12px] font-semibold text-neutral-700"
          >
            {display.mime_type.startsWith("video/") ? (
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
      })()}
      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          simpleCounter
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
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
      disabled={!isActiveEmergency(alert)}
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
