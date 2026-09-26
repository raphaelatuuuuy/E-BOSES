import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CircleCheck,
  FootprintsIcon,
  InfoIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MapPinIcon,
  Maximize2Icon,
  MessageCircleIcon,
  Minimize2Icon,
  NavigationIcon,
  PhoneIcon,
  PlayIcon,
  ScaleIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useAuthSession } from "@/features/auth/auth-session"
import { shouldSkipPoll } from "@/features/dashboard/lib/visible-poll"

import { cn } from "@workspace/ui/lib/utils"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import { drawCoverage } from "@/features/dashboard/components/map/coverage-layer"
import {
  GLYPHS,
  MAP_COLORS,
  glyphPinHtml,
  reportDotHtml,
} from "@/features/dashboard/components/map/markers"
import { apiRequest, websocketTicket, websocketUrl } from "@/lib/api"
import { useApiReachability } from "@/lib/api-reachability"
import {
  canUseSmsInbox,
  requestSmsUpdate,
} from "@/lib/native-sms-inbox"
import {
  isGatewaySender,
  parseSmsUpdate,
  type SmsUpdateStage,
} from "@/features/dashboard/lib/sms-update-parser"
import {
  listSmsUpdates,
  saveSmsUpdate,
  type StoredSmsUpdate,
} from "@/features/dashboard/lib/sms-updates-store"
import { SOS_SMS_NUMBER } from "@/features/dashboard/components/sos/offline-sos-config"
import {
  bindHoverCard,
  closeHoverCardsOnLeave,
} from "@/features/dashboard/components/map/photo-tooltip"
import {
  createEmergencyAppeal,
  getEmergency,
  getEmergencyRoute,
  isNewerEmergencyAlert,
  normalizeEmergencyAlert,
  revealResponderContact,
  type EmergencyAlert,
  type EmergencyChatMessage,
  type EmergencyRoute,
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { buildEmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline-lib"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { ReportPhotoPreview } from "@/features/dashboard/components/concerns/resolved-photo"
import type { ConcernTimelineEntry } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  drawRoute,
  routeRenderGeometry,
  routeStartPoint,
  type RouteLayers,
} from "@/features/dashboard/lib/route-line"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import {
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { isEmergencyActive } from "@/features/dashboard/components/record/status"
import {
  formatClock,
  formatResolvedOn,
} from "@/features/dashboard/lib/responder-format"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
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

const RESPONDER_STATUS_HEADLINES: Record<string, string> = {
  assigned: "Responder is assigned to your location",
  acknowledged: "Responder is preparing to respond",
  en_route: "Responder is on the way",
  nearby: "Responder is almost there",
  arrived: "Responder has arrived",
  assisting: "Responder is assisting at your location",
}

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  acknowledged: "Responding",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "On scene",
  assisting: "Assisting",
  in_progress: "In progress",
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

function responderContactAssignment(alert: EmergencyAlert) {
  const active = activeResponderAssignment(alert)
  if (active) return active
  const historical = [
    alert.current_assignment,
    ...(alert.active_assignments ?? []),
    ...(alert.assignments ?? []),
  ].filter(Boolean)
  return historical[historical.length - 1] ?? null
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

function readResidentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    })
  })
}

function EmergencyTrackingMap({
  alert,
  wide,
  onBack,
  className,
  onFullscreenChange,
}: {
  alert: EmergencyAlert
  wide: boolean
  onBack: () => void
  className?: string
  onFullscreenChange?: (full: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const { wrapRef, fullView, toggleFullscreen, expandStyle } =
    useMapFullscreen(
      () => mapRef.current?.invalidateSize(),
      onFullscreenChange
    )
  const responderMarkerRefs = useRef<Map<number, leaflet.Marker>>(new Map())
  const focusResponderRef = useRef<((id: number) => void) | null>(null)
  const navLayersRef = useRef<RouteLayers | null>(null)
  const navMarkerRef = useRef<leaflet.Marker | null>(null)
  const navPosRef = useRef<leaflet.LatLngTuple | null>(null)
  const lastNavRouteRef = useRef<EmergencyRoute | null>(null)
  const navWatchIdRef = useRef<number | null>(null)
  const lastNavFetchRef = useRef(0)
  const navigatingRef = useRef(false)
  const [navigating, setNavigating] = useState(false)
  const [navBusy, setNavBusy] = useState(false)
  const [centerEta, setCenterEta] = useState<{
    distance: number | null
    eta: number | null
  } | null>(null)
  const routeRef = useRef<RouteLayers | null>(null)
  const routeSigRef = useRef("")
  const fittedRef = useRef(false)
  const recenterRef = useRef<(() => void) | null>(null)
  const frameViewRef = useRef<(() => void) | null>(null)
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
      frameViewRef.current = centerView
      routeSigRef.current = ""
      fittedRef.current = false
      setMapReady((value) => value + 1)
      requestAnimationFrame(() => {
        map?.invalidateSize()
        frameViewRef.current?.()
      })
      window.setTimeout(() => {
        if (!mapRef.current) return
        mapRef.current.invalidateSize()
        frameViewRef.current?.()
      }, 400)
    }

    const responderMarkers = responderMarkerRefs.current

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      recenterRef.current = null
      frameViewRef.current = null
      focusResponderRef.current = null
      if (navWatchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(navWatchIdRef.current)
      }
      navWatchIdRef.current = null
      navigatingRef.current = false
      navLayersRef.current?.remove()
      navLayersRef.current = null
      navMarkerRef.current?.remove()
      navMarkerRef.current = null
      responderMarkers.forEach((marker) => marker.remove())
      responderMarkers.clear()
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
    if (!mapRef.current) return
    mapRef.current.invalidateSize()
    frameViewRef.current?.()
    window.setTimeout(() => {
      if (!mapRef.current) return
      mapRef.current.invalidateSize()
      frameViewRef.current?.()
    }, 200)
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

  const drawResidentPreview = (
    pos: leaflet.LatLngTuple,
    route: EmergencyRoute | null | undefined,
    fit = true
  ) => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L) return
    const destination: leaflet.LatLngTuple = [
      Number(incidentLatitude),
      Number(incidentLongitude),
    ]
    navPosRef.current = pos
    lastNavRouteRef.current = route ?? null
    const size = 26
    const icon = L.divIcon({
      className: "eboses-emergency-pin",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: glyphPinHtml({
        paths: GLYPHS.userResident,
        color: MAP_COLORS.you,
        size,
        label: "You",
      }),
    })
    if (navMarkerRef.current) {
      navMarkerRef.current.setLatLng(pos)
      navMarkerRef.current.setIcon(icon)
    } else {
      navMarkerRef.current = L.marker(pos, {
        icon,
        zIndexOffset: 1100,
      }).addTo(map)
    }
    navLayersRef.current?.remove()
    navLayersRef.current = null
    if (route?.geometry) {
      const geometry = routeRenderGeometry(route, {
        origin: pos,
        destination,
      })
      navLayersRef.current = drawRoute(L, map, {
        ...geometry,
        live: isLive,
      })
      setCenterEta({
        distance: route.distance_meters,
        eta: route.eta_seconds,
      })
    } else {
      setCenterEta(null)
    }
    if (fit) {
      map.fitBounds(L.latLngBounds([pos, destination]), {
        padding: [28, 28],
        maxZoom: 17,
        animate: true,
      })
    }
  }

  const stopResidentNav = () => {
    navigatingRef.current = false
    if (navWatchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(navWatchIdRef.current)
    }
    navWatchIdRef.current = null
    navLayersRef.current?.remove()
    navLayersRef.current = null
    navMarkerRef.current?.remove()
    navMarkerRef.current = null
    navPosRef.current = null
    lastNavRouteRef.current = null
    setCenterEta(null)
    setNavigating(false)
    setNavBusy(false)
  }

  const toggleResidentNav = () => {
    if (navigatingRef.current) {
      stopResidentNav()
      return
    }
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
        position = await readResidentPosition()
      } catch {
        navigatingRef.current = false
        setNavigating(false)
        setNavBusy(false)
        toast.error("Allow location access to navigate to your pin.")
        return
      }
        if (!navigatingRef.current) return
        const pos: leaflet.LatLngTuple = [
          position.coords.latitude,
          position.coords.longitude,
        ]
        let route: EmergencyRoute | null
        try {
          route =
            (await getEmergencyRoute(alert.id, {
              origin: { latitude: pos[0], longitude: pos[1] },
            })) ?? null
        } catch {
          route = null
        }
        if (!navigatingRef.current) return
        drawResidentPreview(pos, route)
        if (!route?.geometry) {
          toast.error("Currently experiencing issue, try again.")
        }
        setNavBusy(false)
        lastNavFetchRef.current = Date.now()
        navWatchIdRef.current = navigator.geolocation.watchPosition(
          (fix) => {
            if (!navigatingRef.current) return
            const next: leaflet.LatLngTuple = [
              fix.coords.latitude,
              fix.coords.longitude,
            ]
            navPosRef.current = next
            navMarkerRef.current?.setLatLng(next)
            if (Date.now() - lastNavFetchRef.current > 12000) {
              lastNavFetchRef.current = Date.now()
              void (async () => {
                try {
                  const fresh = await getEmergencyRoute(alert.id, {
                    origin: { latitude: next[0], longitude: next[1] },
                  })
                  if (navigatingRef.current)
                    drawResidentPreview(next, fresh ?? null, false)
                } catch {
                  if (navigatingRef.current)
                    drawResidentPreview(next, lastNavRouteRef.current, false)
                }
              })()
            }
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        )
        setNavBusy(false)
    })()
  }

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
      const liveLat = Number(lastLocation?.latitude)
      const liveLng = Number(lastLocation?.longitude)
      const responderLatLng: leaflet.LatLngTuple | null =
        lastLocation && Number.isFinite(liveLat) && Number.isFinite(liveLng)
          ? [liveLat, liveLng]
          : routeStartPoint(
              assignment.route ??
                (assignment.id === activeAssignments[0]?.id
                  ? alert.route
                  : null)
            )
      if (!responderLatLng) continue
      const existingMarker = responderMarkerRefs.current.get(assignment.id)
      if (existingMarker) existingMarker.setLatLng(responderLatLng)
      else {
        const marker = L.marker(responderLatLng, {
          icon: L.divIcon({
            className: "",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            html: reportDotHtml(MAP_COLORS.responder, 12),
          }),
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(map)
        marker.on("click", () => {
          map.flyTo(marker.getLatLng(), 17, { animate: true })
        })
        responderMarkerRefs.current.set(assignment.id, marker)
      }
    }
    for (const [id, marker] of responderMarkerRefs.current) {
      if (!activeAssignments.some((item) => item.id === id)) {
        marker.remove()
        responderMarkerRefs.current.delete(id)
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
      map.invalidateSize()
      map.setView(destination, 17, { animate: false })
      const offset = Math.min(280, Math.round(map.getSize().y * 0.36))
      if (offset > 0) map.panBy([0, offset], { animate: false })
    }
    frameViewRef.current = () => {
      if (!mapRef.current) return
      map.setView(destination, 17, { animate: false })
      requestAnimationFrame(focusMapAboveSheet)
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

  const pillAssignment =
    alert.current_assignment ?? (alert.assignments ?? [])[0] ?? null
  const pillRoute = pillAssignment?.route ?? alert.route
  const pillEta =
    centerEta ??
    (fullView && pillRoute?.geometry
      ? { distance: pillRoute.distance_meters, eta: pillRoute.eta_seconds }
      : null)

  return (
    <>
      <div
        ref={wrapRef}
        style={expandStyle}
        className={cn("relative h-full w-full", className)}
      >
      <div ref={containerRef} className="h-full w-full bg-ink" />
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
          <MapControlButton
            tone="light"
            divider
            label={
              navigating ? "Stop navigation to pin" : "Navigate to pin"
            }
            active={navigating}
            onClick={toggleResidentNav}
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
              {`${pillEta.eta == null ? "ETA unavailable" : `ETA ${Math.max(1, Math.round(pillEta.eta / 60))} min`} · ${pillEta.distance == null ? "" : pillEta.distance < 1000 ? `${Math.round(pillEta.distance)} m` : `${(pillEta.distance / 1000).toFixed(1)} km`}`}
            </span>
            <span className="mt-1.5 text-[14px] leading-snug font-medium text-neutral-500">
              Help is on the way
            </span>
          </div>
        </div>
      ) : null}
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
    <section className={cn("flex flex-col", className)}>
      {label ? (
        <p className="text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
          {label}
        </p>
      ) : null}
      <div className={cn("flex min-h-0 flex-col", label ? "mt-2" : undefined)}>
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
      <ConcernTimeline
        items={items}
        collapsibleHistory
        large
        trackingId={alert.tracking_id || alert.public_id}
      />
    </div>
  )
}

const SMS_STAGE_META: Record<
  SmsUpdateStage,
  { badge: string; accent: "info" | "warning" | "brand" | "success"; icon: "inbox" | "clock" | "hardhat" | "check" }
> = {
  received: { badge: "Received", accent: "info", icon: "inbox" },
  en_route: { badge: "Responder en route", accent: "warning", icon: "clock" },
  nearby: { badge: "Responder nearby", accent: "warning", icon: "clock" },
  arrived: { badge: "Responder arrived", accent: "brand", icon: "hardhat" },
  resolved: { badge: "Resolved", accent: "success", icon: "check" },
}

const SERVER_STATUS_TO_STAGE: Record<string, SmsUpdateStage> = {
  submitted: "received",
  routing: "received",
  routed: "received",
  awaiting_acknowledgment: "received",
  acknowledged: "received",
  en_route: "en_route",
  nearby: "nearby",
  arrived: "arrived",
  in_progress: "arrived",
  resolved: "resolved",
  closed: "resolved",
}

function smsEntryToTimelineItem(
  entry: StoredSmsUpdate
): ConcernTimelineEntry {
  const meta = SMS_STAGE_META[entry.stage]
  return {
    id: `sms-${entry.stage}-${entry.receivedAt}`,
    badge: meta.badge,
    time: entry.receivedAt,
    state: "done",
    accent: meta.accent,
    icon: meta.icon,
    actor: "via SMS",
    actorUser: null,
    content: null,
  }
}

function SmsBackedStatusTimeline({ alert }: { alert: EmergencyAlert }) {
  const { user } = useAuthSession()
  return (
    <SmsTimelineBody
      key={`${user?.id ?? "guest"}:${alert.id}`}
      alert={alert}
      userId={user?.id}
    />
  )
}

function SmsTimelineBody({
  alert,
  userId,
}: {
  alert: EmergencyAlert
  userId: number | undefined
}) {
  const apiOnline = useApiReachability()
  const [smsEntries, setSmsEntries] = useState<StoredSmsUpdate[]>(() =>
    listSmsUpdates(userId, alert.id)
  )
  const [checking, setChecking] = useState(false)
  const autoChecked = useRef(false)

  const checkMessages = useCallback(async () => {
    if (checking || !canUseSmsInbox()) return
    setChecking(true)
    try {
      const message = await requestSmsUpdate(SOS_SMS_NUMBER)
      if (
        message &&
        isGatewaySender(message.sender, SOS_SMS_NUMBER)
      ) {
        const stage = parseSmsUpdate(message.body)
        if (stage) {
          setSmsEntries(
            saveSmsUpdate(userId, alert.id, {
              stage,
              body: message.body.trim(),
              receivedAt: new Date().toISOString(),
            })
          )
        }
      }
    } finally {
      setChecking(false)
    }
  }, [alert.id, checking, userId])

  useEffect(() => {
    if (
      !autoChecked.current &&
      !apiOnline &&
      canUseSmsInbox() &&
      isEmergencyActive(alert.status)
    ) {
      autoChecked.current = true
      void checkMessages()
    }
  }, [apiOnline, alert.status, checkMessages])

  if (!smsEntries.length) return <StatusTimeline alert={alert} />

  const covered = new Set(
    (alert.status_events ?? []).map(
      (event) => SERVER_STATUS_TO_STAGE[event.status] ?? event.status
    )
  )
  const extra = smsEntries.filter((entry) => !covered.has(entry.stage))
  const showSmsButton =
    canUseSmsInbox() && isEmergencyActive(alert.status)
  if (!extra.length) {
    return (
      <div>
        <StatusTimeline alert={alert} />
        {showSmsButton ? (
          <button
            type="button"
            onClick={() => void checkMessages()}
            disabled={checking}
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            {checking ? "Waiting for message…" : "Check Messages for updates"}
          </button>
        ) : null}
      </div>
    )
  }

  const serverItems: ConcernTimelineEntry[] =
    alert.status_events?.length
      ? buildEmergencyTimeline(alert).map((item) => ({
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
  const merged = [...serverItems, ...extra.map(smsEntryToTimelineItem)]
    .sort(
      (a, b) =>
        new Date(a.time ?? 0).getTime() - new Date(b.time ?? 0).getTime()
    )
    .map((item, index, list) => ({
      ...item,
      state: (index === list.length - 1
        ? "current"
        : "done") as ConcernTimelineEntry["state"],
    }))

  return (
    <div>
      <h3 className="sr-only">Updates</h3>
      <ConcernTimeline
        items={merged}
        collapsibleHistory
        large
        trackingId={alert.tracking_id || alert.public_id}
      />
      {canUseSmsInbox() && isEmergencyActive(alert.status) ? (
        <button
          type="button"
          onClick={() => void checkMessages()}
          disabled={checking}
          className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          {checking ? "Waiting for message…" : "Check Messages for updates"}
        </button>
      ) : null}
    </div>
  )
}

function DetailsColumn({
  alert,
  showAppealHistory,
  appealHistory,
}: {
  alert: EmergencyAlert
  showAppealHistory: boolean
  appealHistory: EmergencyAlert["appeals"]
}) {
  const live = isEmergencyActive(alert.status)
  const resolved = alert.status === "resolved"
  const displayText =
    alert.display_description?.trim() ||
    alert.note?.trim() ||
    statusText(alert)
  const rawNote = alert.note?.trim() || ""
  const showRawNote = Boolean(rawNote && rawNote !== displayText)
  const [lightbox, setLightbox] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const submittedMedia = (alert.media ?? []).map((media) => ({
    key: `submitted-${media.id}`,
    preview: media.preview_url,
    raw: media.raw_url,
    filename: media.original_filename,
    mime: media.mime_type,
  }))
  const resolvedMedia = (alert.resolution_evidence ?? []).map((item) => ({
    key: `resolved-${item.id}`,
    preview: item.preview_url || item.raw_url,
    raw: item.raw_url || item.preview_url,
    filename: item.original_filename,
    mime: item.mime_type,
  }))
  const submittedItems = submittedMedia.map((media) => ({
    ...toMediaPreviewItem(media.raw, media.filename, media.mime),
    badge: "Reported issue",
  }))
  const resolvedItems = resolvedMedia.map((media) => ({
    ...toMediaPreviewItem(media.raw, media.filename, media.mime),
    badge: "Resolved case",
  }))
  const allItems = [...submittedItems, ...resolvedItems]
  const renderMediaGrid = (
    items: { key: string; preview: string; filename: string; mime: string }[],
    offset: number
  ) => {
    const imageIndex = items.findIndex((media) =>
      media.mime.startsWith("image/")
    )
    const displayIndex = imageIndex >= 0 ? imageIndex : 0
    const display = items[displayIndex]
    if (!display) return null
    if (display.mime.startsWith("image/")) {
      return (
        <ReportPhotoPreview
          originalSrc={display.preview}
          alt={display.filename}
          onOpen={() =>
            setLightbox({ items: allItems, index: offset + displayIndex })
          }
        />
      )
    }
    return (
      <button
        type="button"
        className="flex h-24 w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-700"
        onClick={() =>
          setLightbox({ items: allItems, index: offset + displayIndex })
        }
      >
        <PlayIcon className="size-4" />
        Video evidence
      </button>
    )
  }

  return (
    <div className="flex flex-col space-y-5 pb-4">
      <div
        className={cn(
          "flex w-full flex-col gap-3 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
          live
            ? "bg-severity-critical-surface text-sos"
            : resolved
              ? "bg-emerald-50 text-emerald-900"
              : "bg-neutral-100 text-neutral-700"
        )}
      >
        <div className="flex w-full items-start gap-2">
          {resolved ? (
            <CircleCheck
              className="mt-[2px] size-5 shrink-0 text-emerald-600"
              strokeWidth={2.2}
              aria-hidden
            />
          ) : (
            <TriangleAlertIcon
              className={cn(
                "mt-[2px] size-5 shrink-0",
                live ? "text-sos" : "text-neutral-600"
              )}
              strokeWidth={1.9}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-relaxed font-normal break-words whitespace-pre-wrap">
              {displayText}
            </p>
            {showRawNote ? (
              <p className="mt-2 border-l-2 border-current/20 py-1 pl-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {rawNote}
              </p>
            ) : null}
            {submittedMedia.length || resolvedMedia.length ? (
              <div className="mt-2 space-y-3 border-l-2 border-current/20 py-1 pl-3">
                {submittedMedia.length ? (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold opacity-70">
                      Submitted photos
                    </p>
                    {renderMediaGrid(submittedMedia, 0)}
                  </div>
                ) : null}
                {resolvedMedia.length ? (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold opacity-70">
                      Resolved photos
                    </p>
                    {renderMediaGrid(resolvedMedia, submittedItems.length)}
                  </div>
                ) : null}
              </div>
            ) : null}
            {resolved && alert.resolved_at ? (
              <p className="mt-2 text-[12px] font-normal">
                This issue was resolved on {formatResolvedOn(alert.resolved_at)}.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[17px] font-bold tracking-tight text-neutral-900">
            Status
          </p>
          <p className="text-[12px] font-normal text-neutral-500">
            Track the process
          </p>
        </div>
        <SmsBackedStatusTimeline alert={alert} />
      </section>

      {showAppealHistory && appealHistory?.length ? (
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

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          simpleCounter
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

function AppealForm({
  appealReason,
  setAppealReason,
  appealBusy,
  submitAppeal,
}: {
  appealReason: string
  setAppealReason: (v: string) => void
  appealBusy: boolean
  submitAppeal: () => void
}) {
  return (
    <div className="flex flex-col pb-0">
      <p className="text-[12px] leading-5 text-neutral-500">
        Use only if this emergency was resolved or recorded incorrectly.
      </p>
      <textarea
        value={appealReason}
        onChange={(e) => setAppealReason(e.target.value)}
        placeholder="Explain what should be reviewed"
        className="mt-3 min-h-20 w-full resize-none rounded-[18px] border-[1.5px] border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
      />
      <button
        type="button"
        disabled={appealBusy || !appealReason.trim()}
        onClick={() => void submitAppeal()}
        className="mt-3 h-11 w-full rounded-full bg-brand-orange text-white transition-colors hover:bg-brand-orange-strong disabled:opacity-60"
      >
        {appealBusy ? "Submitting" : "Submit review request"}
      </button>
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
  const [mapFull, setMapFull] = useState(false)
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
  const [appealView, setAppealView] = useState(false)
  const { user: sessionUser } = useAuthSession()
  const [callingResponder, setCallingResponder] = useState(false)
  const [responderContact, setResponderContact] = useState<{
    key: string
    phone: string | null
    error: boolean
  } | null>(null)
  const responderContactKeyRef = useRef<string | null>(null)
  const [responderIndex, setResponderIndex] = useState(0)

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
    if (switchedAlert) setAppealView(false)
    if (switchedAlert) setResponderIndex(0)
  }

  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {    setPrevOpen(open)
    if (!open) {
      setChatMessage(null)
      setChatView(false)
      setAppealView(false)
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
  const responderAssignment = alert ? responderContactAssignment(alert) : null
  const responderAssignmentId = responderAssignment?.id ?? null
  const inlineResponderPhone =
    responderAssignment?.responder.phone_number?.trim() || ""
  const responderContactKey =
    alertId && responderAssignmentId
      ? `${alertId}:${responderAssignmentId}`
      : null
  const activeAssignments = alert
    ? (alert.assignments ?? []).filter((a) =>
        [
          "assigned",
          "acknowledged",
          "en_route",
          "arrived",
          "assisting",
        ].includes(a.status)
      )
    : []

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !isEmergencyActive(alertStatus))
      return
    const refreshAlert = async () => {
      if (shouldSkipPoll()) return
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
    const refreshVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshAlert()
      }
    }
    window.addEventListener("focus", refreshAlert)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshAlert)
      document.removeEventListener("visibilitychange", refreshVisible)
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
    if (!open || !alertId || !alertStatus || !contactKey) return
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

  const isReporter = Boolean(
    sessionUser && alert.reporter && sessionUser.id === alert.reporter.id
  )
  const isLive = isEmergencyActive(alert.status)
  const pendingAppeal = alert.appeals?.find((a) => a.status === "submitted")
  const canAppeal = Boolean(
    alert && !isEmergencyActive(alert.status) && !pendingAppeal && isReporter
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
      setAppealView(false)
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
      showAppealHistory={isReporter}
      appealHistory={appealHistory}
    />
  )

  const appealPanel = (
    <AppealForm
      appealReason={appealReason}
      setAppealReason={setAppealReason}
      appealBusy={appealBusy}
      submitAppeal={() => void submitAppeal()}
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
       callTo={responderPhone}
    />
  )

  const headerRoute = responderAssignment?.route ?? alert.route
  const headerEta =
    headerRoute?.geometry && isLive
      ? `${headerRoute.distance_meters == null ? "" : `${headerRoute.distance_meters < 1000 ? `${Math.round(headerRoute.distance_meters)} m` : `${(headerRoute.distance_meters / 1000).toFixed(1)} km`} `}${headerRoute.eta_seconds == null ? "ETA unavailable" : `ETA ${Math.max(1, Math.round(headerRoute.eta_seconds / 60))} min`}`
      : null
  const sheetHeadline =
    chatView || appealView ? null : responderStatusHeadline(alert)

  return (
    <SheetDialog
      open={open}
      onBack={chatView ? () => setChatView(false) : undefined}
      onClose={() => onOpenChange(false)}
      title={
        chatView
          ? "Chat"
          : appealView
            ? "Request a review"
            : isLive
              ? sheetHeadline ? (
                  <span>
                    {sheetHeadline}{" "}
                    {headerEta ? (
                      <span className="text-[14px] font-normal text-neutral-500">
                        {headerEta}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  "Live alert"
                )
              : "Emergency alert"
      }
      titleClassName={
        chatView
          ? "text-center"
          : !chatView && !appealView && isLive && sheetHeadline
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
          onFullscreenChange={setMapFull}
          onBack={() => {
            if (chatView) setChatView(false)
            else if (appealView) setAppealView(false)
            else onOpenChange(false)
          }}
        />
      }
      backdropScrim={false}
      backdropInteractive
      showClose={false}
      className={cn(
        "bg-white text-neutral-900",
        mapFull && "hidden",
        chatView || appealView
          ? "h-[min(760px,72dvh)] max-h-[min(760px,72dvh)] sm:h-[min(760px,82vh)] sm:max-h-[min(760px,82vh)]"
          : "h-auto max-h-[min(760px,72dvh)] sm:max-h-[min(760px,82vh)]"
      )}
      bodyClassName={cn(
        "min-h-0 flex flex-col px-5",
        chatView || appealView ? "flex-1 pb-5" : "flex-1 pb-0"
      )}
      actions={
        appealView ? (
          <SheetIconButton
            label="Show emergency details"
            onClick={() => setAppealView(false)}
          >
            <InfoIcon className="size-[22px]" strokeWidth={2} />
          </SheetIconButton>
        ) : canAppeal ? (
          <SheetIconButton
            label="Request a review"
            onClick={() => setAppealView(true)}
          >
            <ScaleIcon className="size-[22px]" strokeWidth={2} />
          </SheetIconButton>
        ) : undefined
      }
      footer={
        !chatView && !appealView && (isLive || alert.status === "resolved") ? (
          <div className="space-y-3">
            {activeAssignments.length > 1 ? (
              <>
                <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("eboses:focus-responder", {
                          detail: {
                            assignmentId: activeAssignments[
                              Math.min(
                                responderIndex,
                                activeAssignments.length - 1
                              )
                            ].id,
                          },
                        })
                      )
                    }
                    title="Show responder on map"
                    aria-label="Show responder on map"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  >
                    <UserAvatar
                      user={
                        activeAssignments[
                          Math.min(
                            responderIndex,
                            activeAssignments.length - 1
                          )
                        ].responder
                      }
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-neutral-900">
                        {
                          activeAssignments[
                            Math.min(
                              responderIndex,
                              activeAssignments.length - 1
                            )
                          ].responder.full_name
                        }
                        {"  "}
                        <span className="text-[12px] font-normal text-neutral-500">
                          {
                            ASSIGNMENT_STATUS_LABELS[
                              activeAssignments[
                                Math.min(
                                  responderIndex,
                                  activeAssignments.length - 1
                                )
                              ].status
                            ] ??
                              activeAssignments[
                                Math.min(
                                  responderIndex,
                                  activeAssignments.length - 1
                                )
                              ].status
                          }
                        </span>
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
                  {chatAvailable ? (
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
                  ) : null}
                </div>
                <div className="flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={() =>
                      setResponderIndex((i) => Math.max(0, i - 1))
                    }
                    disabled={responderIndex === 0}
                    aria-label="Previous responder"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm font-semibold">{"<"}</span>
                  </button>
                  <div className="flex gap-1.5 items-center">
                    {activeAssignments.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setResponderIndex(i)}
                        aria-label={`Responder ${i + 1}`}
                        className={cn(
                          "h-1.5 rounded-full transition-all duration-200",
                          i === responderIndex
                            ? "w-4 bg-neutral-800"
                            : "w-1.5 bg-neutral-300 hover:bg-neutral-400"
                        )}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setResponderIndex((i) =>
                        Math.min(activeAssignments.length - 1, i + 1)
                      )
                    }
                    disabled={responderIndex === activeAssignments.length - 1}
                    aria-label="Next responder"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm font-semibold">{">"}</span>
                  </button>
                </div>
              </>
            ) : responderAssignment ? (
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
                {chatAvailable ? (
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
                ) : null}
              </div>
            ) : null}
            <p className="text-center text-[11px] text-neutral-400">
              {alert.status === "resolved"
                ? "This alert is resolved. The responder contact remains available for follow-up."
                : hasActiveResponder(alert)
                ? "In case of changes or new details, contact the barangay in chat."
                : hadResponderAssignment(alert)
                  ? "In case of changes, keep this page open while a new responder is assigned."
                  : "In case of changes or new details, keep this page open for updates."
              }
            </p>
          </div>
        ) : undefined
      }
    >
      {chatView && chatAvailable
        ? chatPanel
        : appealView && canAppeal
          ? appealPanel
          : details}
    </SheetDialog>
  )
}
