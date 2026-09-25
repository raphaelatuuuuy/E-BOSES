"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  FootprintsIcon,
  HomeIcon,
  LocateFixedIcon,
  SearchIcon,
} from "lucide-react"
import type leaflet from "leaflet"
import "@/features/dashboard/components/map/location-pin.css"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import {
  validateLocation,
  type LocationClassification,
} from "@/lib/location-validation"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  formatNominatimParts,
  reverseGeocode,
  type AddressParts,
} from "@/lib/geocode"
import {
  loadOfflineSosConfig,
  offlineCommunityOutline,
  refreshOfflineSosConfig,
  type OfflineSosConfig,
} from "@/features/dashboard/components/sos/offline-sos-config"
import {
  GLYPHS,
  glyphPinHtml,
  glyphPinSize,
  MAP_COLORS,
} from "@/features/dashboard/components/map/markers"
import {
  concernMarkerHtml,
  concernMarkerSize,
} from "@/features/dashboard/components/map/concern-marker"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryGlyphHtml,
  advisoryLabel,
  advisoryMarkerHtml,
} from "@/features/dashboard/components/community-content/advisory-tags"
import { advisoryDoneColor } from "@/features/dashboard/components/alerts-map/lib"
import {
  bindHoverCard,
  closeHoverCardsOnLeave,
} from "@/features/dashboard/components/map/photo-tooltip"
import {
  StreetViewModal,
  type StreetViewCoord,
  type StreetViewMapPoint,
} from "@/features/dashboard/components/map/street-view"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"
import {
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import {
  fetchRegistrationCommunities,
  lookupRegistrationPinAddress,
  searchRegistrationStreets,
} from "@/features/auth/api"
import type { GeoJsonPolygon } from "@/features/dashboard/api"
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"
import { SosStreetSearchSheet } from "@/features/dashboard/components/sos/street-search-sheet"
import { SosPill } from "@/features/dashboard/components/sos/location-pill"

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842]
const EMPTY_ALERTS: LocationPickerAlertMarker[] = []
const PRIMARY_COMMUNITY_NAME = "Marikina Heights"

// The pin sits this many pixels above the map's true geometric center so the
// "Use this location" pill anchored to the bottom can never cover it.
const PIN_OFFSET_Y = 64
const LOCATION_LOOKUP_DEBOUNCE_MS = 900
const LOCATION_LOOKUP_MIN_INTERVAL_MS = 1_200

function pinLatLng(map: leaflet.Map): leaflet.LatLng {
  const size = map.getSize()
  return map.containerPointToLatLng([
    size.x / 2,
    Math.max(0, size.y / 2 - PIN_OFFSET_Y),
  ])
}

function pinAdjustedCenter(
  map: leaflet.Map,
  lat: number,
  lng: number,
  zoom: number
): leaflet.LatLng {
  const point = map.project([lat, lng], zoom).add([0, PIN_OFFSET_Y])
  return map.unproject(point, zoom)
}

export type LocationConfirmPayload = {
  lat: number
  lng: number
  address: string
  addressPrimary: string
  addressSecondary: string
  source: "gps" | "manual_pin"
  zone?: string
  warning?: string | null
}

export type LocationPickerAlertMarker = {
  id: number
  kind: "concern" | "emergency" | "announcement"
  latitude: number
  longitude: number
  title: string
  category?: string
  categoryLabel?: string
  iconKey?: string
  tag?: string
  expiresAt?: string | null
  areaGeometry?: GeoJsonPolygon | null
  reporterName?: string
  status: string
  severity?: string | null
  description?: string
  summary?: string
  llmSummary?: string | null
  typeLabel?: string
  meta?: string
  date?: string
  image?: string | null
  resolutionImage?: string | null
  resolutionCount?: number
  resolvedAt?: string | null
}

interface LocationPickerModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (payload: LocationConfirmPayload) => void
  initialLat?: number | null
  initialLng?: number | null
  initialAddress?: string
  /** When true, render just the map content inline — no portal, overlay, header, or drag handle. */
  renderInline?: boolean
  /** Hide the report search sheet while keeping the shared map and location pill. */
  showSearch?: boolean
  /** Request the device location as soon as the shared map is ready. */
  autoLocate?: boolean
  /** Fit the map to its barangay boundary once each time it opens. */
  recenterOnOpen?: boolean
  /** Show the optional Street View control in the map control stack. */
  showStreetView?: boolean
  /**
   * Sign-up mode: the visitor has no session yet, so the picker reads the
   * served areas, the pinned address and street search from the public
   * registration endpoints instead of the resident map APIs.
   */
  signup?: boolean
  /** Guest report mode uses the resident map navigation controls. */
  guestReport?: boolean
  /**
   * Which boundaries may receive the pin. `served` keeps the normal report
   * picker UI but accepts and searches every active E-Boses community.
   */
  coverageScope?: "home" | "served"
  strictBoundary?: boolean
  /**
   * Live pin state, so a host screen can drive its own Continue button instead
   * of making the resident hunt for the pill on the map.
   */
  onPinStateChange?: (state: PinState | null) => void
  /** Safe public records rendered with the same marker glyphs as resident maps. */
  publicAlerts?: LocationPickerAlertMarker[]
  selectedAlert?: {
    kind: "concern" | "emergency" | "announcement"
    id: number
  } | null
  onAlertSelect?: (alert: {
    kind: "concern" | "emergency" | "announcement"
    id: number
  }) => void
  /** Public browse mode has no center pin; reporting starts in the form instead. */
  publicBrowse?: boolean
  onReportRequest?: () => void
  onBackRequest?: () => void
  onAlertsRequest?: () => void
  showAlertsButton?: boolean
  /**
   * SOS wizard mode: inline map shows back + search buttons beside the pill.
   * The search button opens a sheet with all Marikina Heights streets;
   * picking one focuses the map there.
   */
  sosStreetSearch?: boolean
  /** Offline SOS mode: accept the locally checked coverage without server validation. */
  offline?: boolean
  /** Offline label for the pin, compared against cached streets when the geocoder is unreachable. */
  offlineAddressLabel?: ((lat: number, lng: number) => string | null) | null
}

export interface PinState {
  lat: number
  lng: number
  address: string
  addressPrimary: string
  addressSecondary: string
  ready: boolean
  source: "gps" | "manual_pin"
  accuracy?: number | null
}

/** Every served outline as one shape, so one pin check covers all communities. */
function mergeBoundaries(
  areas: { boundary: GeoJsonPolygon | null }[]
): GeoJsonPolygon | null {
  const parts: unknown[] = []
  for (const area of areas) {
    const geometry = area.boundary
    if (!geometry) continue
    if (geometry.type === "Polygon") parts.push(geometry.coordinates)
    else if (geometry.type === "MultiPolygon")
      parts.push(...(geometry.coordinates as unknown[]))
  }
  if (parts.length === 0) return null
  return {
    type: "MultiPolygon",
    coordinates: parts,
  } as unknown as GeoJsonPolygon
}

type MapContext = {
  center: { latitude: number; longitude: number; zoom: number }
  bounds: {
    min_latitude: number
    max_latitude: number
    min_longitude: number
    max_longitude: number
  }
  boundary: { name: string; geometry: unknown }
  recenter_boundary?: unknown
  home_boundary?: unknown
  dispatch_policy: CoverageInput["policy"]
  soft_buffer_meters: number
  hard_reject_meters: number
}

function acceptancePolicy(
  acceptance: OfflineSosConfig["community"]["acceptance"] | undefined
): CoverageInput["policy"] {
  const geometry = acceptance?.geometry as GeoJsonPolygon | null
  const hasGeometry = geometry?.type === "Polygon" || geometry?.type === "MultiPolygon"
  const centerLat = Number(acceptance?.centerLatitude)
  const centerLng = Number(acceptance?.centerLongitude)
  const radius = Number(acceptance?.radiusMeters)
  const hasCircle =
    Number.isFinite(centerLat) &&
    Number.isFinite(centerLng) &&
    Number.isFinite(radius) &&
    radius > 0
  if (!acceptance || (!hasGeometry && !hasCircle)) return null
  return {
    acceptance_center_latitude: hasCircle ? centerLat : null,
    acceptance_center_longitude: hasCircle ? centerLng : null,
    acceptance_radius_meters: hasCircle ? radius : 0,
    acceptance_geometry: hasGeometry ? geometry : null,
  }
}

function offlineMapContext(): MapContext | null {
  const config = loadOfflineSosConfig()
  const communities = config.communities?.length
    ? config.communities
    : [config.community]
  const community =
    communities.find(
      (entry) =>
        entry.name.trim().toLowerCase() === PRIMARY_COMMUNITY_NAME.toLowerCase()
    ) ?? communities[0]
  if (!community) return null
  const geometry = offlineCommunityOutline(community)
  if (!geometry) return null
  const acceptance = community.acceptance
  const centerLat = Number(acceptance?.centerLatitude)
  const centerLng = Number(acceptance?.centerLongitude)
  return {
    center: {
      latitude: Number.isFinite(centerLat) ? centerLat : DEFAULT_CENTER[0],
      longitude: Number.isFinite(centerLng) ? centerLng : DEFAULT_CENTER[1],
      zoom: 15,
    },
    bounds: {
      min_latitude: community.bounds.minLatitude,
      max_latitude: community.bounds.maxLatitude,
      min_longitude: community.bounds.minLongitude,
      max_longitude: community.bounds.maxLongitude,
    },
    boundary: { name: community.name, geometry },
    recenter_boundary: acceptance?.geometry ?? geometry,
    home_boundary: geometry,
    dispatch_policy: acceptancePolicy(acceptance),
    soft_buffer_meters: 0,
    hard_reject_meters: 0,
  }
}

type LocationClass = LocationClassification

type SearchHit = {
  lat: number
  lng: number
  label: string
  primary: string
  secondary: string
  zone?: string
  accepted?: boolean
}

/**
 * Reverse-geocode a pin into display-ready address parts.
 *
 * Named apart from the imported `reverseGeocode` deliberately: this used to
 * share that name, which meant the local declaration shadowed the import and
 * the function called *itself* — infinite recursion that only ever exited
 * through the catch below, so every pin silently resolved to "Finding street…".
 */
async function reverseGeocodeParts(
  lat: number,
  lng: number,
  communityName: string
): Promise<AddressParts> {
  const data = await reverseGeocode(lat, lng)
  // The helper already swallows network and rate-limit failures into null. Do
  // not persist Lat/Lng as a fake street — keep the UI empty until a lookup
  // works.
  if (!data)
    return { primary: "Finding street…", secondary: communityName, full: "" }
  return formatNominatimParts(data)
}

export default function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
  initialAddress = "",
  renderInline,
  showSearch = true,
  autoLocate = false,
  recenterOnOpen = false,
  showStreetView = true,
  signup = false,
  guestReport = false,
  coverageScope = "home",
  strictBoundary = false,
  onPinStateChange,
  publicAlerts = EMPTY_ALERTS,
  selectedAlert = null,
  onAlertSelect,
  publicBrowse = false,
  onReportRequest,
  onBackRequest,
  onAlertsRequest,
  showAlertsButton = false,
  sosStreetSearch = false,
  offline = false,
  offlineAddressLabel = null,
}: LocationPickerModalProps) {
  const usesServedCoverage = signup || coverageScope === "served"
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const reverseTimer = useRef<number | null>(null)
  const lastLookupKeyRef = useRef<string | null>(null)
  const lastLookupAtRef = useRef(0)
  const ignoreMove = useRef(false)
  const pinSourceRef = useRef<PinState["source"]>("manual_pin")
  const pinAccuracyRef = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)

  const [previewParts, setPreviewParts] = useState<AddressParts>({
    primary: initialAddress || "Move the map to adjust",
    secondary: "",
    full: initialAddress || "Move the map to adjust",
  })
  const [previewLatLng, setPreviewLatLng] = useState<{
    lat: number
    lng: number
  } | null>(
    initialLat != null && initialLng != null
      ? { lat: initialLat, lng: initialLng }
      : null
  )
  const [geocoding, setGeocoding] = useState(false)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [sosStreetOpen, setSosStreetOpen] = useState(false)
  const sosStreets = useMemo(() => {
    try {
      const config = loadOfflineSosConfig()
      const communities = config.communities?.length
        ? config.communities
        : [config.community]
      const seen = new Map<string, { name: string; lat: number; lng: number }>()
      for (const community of communities) {
        for (const street of community?.streets ?? []) {
          const name = street.name?.trim()
          if (!name || seen.has(name.toLowerCase())) continue
          const paths = street.paths?.length ? street.paths : [street.points]
          let best: [number, number] | null = null
          for (const path of paths) {
            if (path?.length) {
              const mid = path[Math.floor(path.length / 2)]!
              if (Number.isFinite(mid[0]) && Number.isFinite(mid[1])) {
                best = mid
                break
              }
            }
          }
          if (best)
            seen.set(name.toLowerCase(), { name, lat: best[0], lng: best[1] })
        }
      }
      return Array.from(seen.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    } catch {
      return []
    }
  }, [])
  const [mapContext, setMapContext] = useState<MapContext | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [locationClass, setLocationClass] = useState<LocationClass | null>(null)
  // Runs on every frame of a pan, so the pin can refuse itself while the map is
  // still moving. The server call behind `locationClass` is debounced and stays
  // the authority; this only drives the cursor and the notice.
  const [outOfScope, setOutOfScope] = useState(false)
  const coverageRef = useRef<CoverageInput>({})
  const fittedBoundaryRef = useRef(false)
  const publicAlertLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const publicAdvisoryAreaLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const publicAdvisoryAreasRef = useRef(
    new Map<string, { layer: leaflet.GeoJSON; selected: boolean }>()
  )
  const youLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const publicAlertMarkersRef = useRef(new Map<string, leaflet.Marker>())
  const [gpsFix, setGpsFix] = useState<{ lat: number; lng: number } | null>(
    null
  )
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)

  // Bottom sheet for mobile
  const locSheet = useBottomSheetSnap({
    enabled: open,
    initialMode: "expanded",
    onSettle: () => {
      if (locSheet.mode === "hidden") onClose()
    },
  })

  useEffect(() => {
    if (open) locSheet.snapTo("expanded")
  }, [open])

  const scheduleReverseAndValidate = useCallback(
    (
      lat: number,
      lng: number,
      source: PinState["source"] = "manual_pin",
      accuracy: number | null = null
    ) => {
      pinSourceRef.current = source
      pinAccuracyRef.current = accuracy
      const lookupKey = `${lat.toFixed(5)},${lng.toFixed(5)}`
      if (lookupKey === lastLookupKeyRef.current) return
      setPreviewLatLng({ lat, lng })
      // Do not let the previous pin's successful validation authorize the new
      // coordinates while the debounced server check is in flight.
      setLocationClass(null)
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      const run = () => {
        const withOfflineFallback = (parts: {
          primary: string
          secondary: string
          full: string
        }) => {
          if (parts.primary && parts.primary !== "Finding street…")
            return parts
          const street = offlineAddressLabel?.(lat, lng)?.trim()
          if (!street) return parts
          return { primary: street, secondary: "", full: street }
        }
        const wait = Math.max(
          0,
          LOCATION_LOOKUP_MIN_INTERVAL_MS -
            (Date.now() - lastLookupAtRef.current)
        )
        if (wait > 0) {
          reverseTimer.current = window.setTimeout(run, wait)
          return
        }
        lastLookupKeyRef.current = lookupKey
        lastLookupAtRef.current = Date.now()
        setGeocoding(true)
        if (usesServedCoverage) {
          const addressRequest = lookupRegistrationPinAddress(lat, lng)
          const validationRequest = validateLocation(lat, lng)
          void addressRequest
            .then((result) => {
              setPreviewParts(
                withOfflineFallback({
                  primary:
                    result.label || result.street || "Finding street…",
                  secondary: result.community,
                  full: [result.label || result.street, result.community]
                    .filter(Boolean)
                    .join(", "),
                })
              )
            })
            .catch(() => {
              setPreviewParts(
                withOfflineFallback({
                  primary: "Finding street…",
                  secondary: mapContext?.boundary?.name || "",
                  full: "",
                })
              )
            })
          void validationRequest
            .then((classification) => {
              setLocationClass(classification)
              setOutOfScope(
                classification.status === "far" ||
                  !classification.accepted ||
                  (strictBoundary &&
                    !insideCoverage(lat, lng, {
                      boundary: coverageRef.current.boundary,
                    }))
              )
            })
            .catch(() => {
              setLocationClass(null)
              setOutOfScope(
                !insideCoverage(lat, lng, coverageRef.current)
              )
            })
          void Promise.allSettled([addressRequest, validationRequest]).then(
            () => setGeocoding(false)
          )
          return
        }
        void Promise.all([
          reverseGeocodeParts(
            lat,
            lng,
            mapContext?.boundary?.name || "Your community"
          ).catch(
            () =>
              withOfflineFallback({
                primary: "Finding street…",
                secondary: mapContext?.boundary?.name || "",
                full: "",
              }) as never
          ),
          validateLocation(lat, lng).catch(() => null),
        ]).then(([parts, classification]) => {
          setPreviewParts(parts)
          if (!classification) {
            setLocationClass(null)
            setOutOfScope(!insideCoverage(lat, lng, coverageRef.current))
            setGeocoding(false)
            return
          }
          setLocationClass(classification)
          setOutOfScope(
            classification.status === "far" ||
              !classification.accepted ||
              (strictBoundary &&
                !insideCoverage(lat, lng, {
                  boundary: coverageRef.current.boundary,
                }))
          )
          setGeocoding(false)
        })
      }
      reverseTimer.current = window.setTimeout(run, LOCATION_LOOKUP_DEBOUNCE_MS)
    },
    [mapContext?.boundary?.name, offlineAddressLabel, strictBoundary, usesServedCoverage]
  )
  const scheduleReverseAndValidateRef = useRef(scheduleReverseAndValidate)
  useEffect(() => {
    scheduleReverseAndValidateRef.current = scheduleReverseAndValidate
  }, [scheduleReverseAndValidate])

  // Load map context
  useEffect(() => {
    if (!open) return
    if (usesServedCoverage) {
      const homeContextRequest = signup
        ? Promise.resolve<MapContext | null>(null)
        : apiRequest<MapContext>("/locations/map-context/").catch(() => null)
      void Promise.all([
        fetchRegistrationCommunities().catch(() => null),
        homeContextRequest,
        refreshOfflineSosConfig(),
      ])
        .then(([data, homeContext, sosConfig]) => {
          const areas = (data?.results ?? []).filter(
            (area) =>
              area.name.trim().toLowerCase() ===
              PRIMARY_COMMUNITY_NAME.toLowerCase()
          )
          const first = areas[0]
          const homeArea = first
          const sosCommunity =
            (sosConfig.communities ?? [sosConfig.community]).find(
              (community) =>
                community.name.trim().toLowerCase() ===
                PRIMARY_COMMUNITY_NAME.toLowerCase()
            ) ?? sosConfig.community
          const boundary =
            mergeBoundaries(areas) ?? offlineCommunityOutline(sosCommunity)
          const offlineCenter = {
            lat: Number(sosCommunity?.acceptance?.centerLatitude),
            lng: Number(sosCommunity?.acceptance?.centerLongitude),
          }
          const dispatch_policy = acceptancePolicy(sosCommunity?.acceptance)
          setMapContext({
            center: {
              latitude:
                homeContext?.center.latitude ??
                first?.center.latitude ??
                (Number.isFinite(offlineCenter.lat)
                  ? offlineCenter.lat
                  : DEFAULT_CENTER[0]),
              longitude:
                homeContext?.center.longitude ??
                first?.center.longitude ??
                (Number.isFinite(offlineCenter.lng)
                  ? offlineCenter.lng
                  : DEFAULT_CENTER[1]),
              zoom: homeContext?.center.zoom ?? 15,
            },
            bounds: {
              min_latitude: -90,
              max_latitude: 90,
              min_longitude: -180,
              max_longitude: 180,
            },
            boundary: {
              name: homeArea?.name ?? PRIMARY_COMMUNITY_NAME,
              geometry: boundary,
            },
            recenter_boundary: homeContext?.boundary.geometry ?? boundary,
            home_boundary:
              homeContext?.boundary.geometry ?? homeArea?.boundary ?? boundary,
            dispatch_policy,
            soft_buffer_meters: 0,
            hard_reject_meters: 0,
          })
        })
        .catch(() => setMapContext(offlineMapContext()))
      return
    }
    void apiRequest<MapContext>("/locations/map-context/")
      .then(setMapContext)
      .catch(() => setMapContext(null))
  }, [open, signup, usesServedCoverage])

  // Init map
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const publicAlertMarkers = publicAlertMarkersRef.current
    let map: leaflet.Map | null = null
    let styleEl: HTMLStyleElement | null = null
    let removeHoverCardsListener: (() => void) | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      const container = containerRef.current
      if (cancelled || !container) return

      // Leaflet mutates this node outside React. Clear any previous instance
      // before mounting again when the wizard returns to this step.
      if ((container as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        container.innerHTML = ""
      }

      container.classList.add("eboses-location-picker-map")

      // Same fix as the AreaPicker/pin maps: the tile-size override has to
      // exist in <head> before Leaflet lays out its tile pane, or the 256px
      // tiles collapse under Tailwind Preflight's `img { max-width: 100% }`
      // and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-location-picker-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8f5f0;
          font-family: inherit;
        }
        .eboses-location-picker-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-location-picker-map img.leaflet-tile,
        .eboses-location-picker-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-location-picker-map .eboses-pin__disc {
          background: color-mix(in srgb, var(--pin) 16%, white);
          color: var(--pin);
        }
        .eboses-location-picker-map .eboses-pin--glyph.is-alert .eboses-pin__disc {
          background: #fef2f2;
          color: #dc2626;
        }
        .eboses-location-picker-map .eboses-pin__disc svg {
          display: block;
        }
      `
      document.head.appendChild(styleEl)

      const initialZoom = mapContext?.center.zoom ?? 15
      const hasInitialPin = initialLat != null && initialLng != null
      map = L.map(container, {
        center: hasInitialPin
          ? [initialLat, initialLng]
          : mapContext
            ? [mapContext.center.latitude, mapContext.center.longitude]
            : DEFAULT_CENTER,
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      })
      removeHoverCardsListener = closeHoverCardsOnLeave(map)

      // The visual pin is intentionally above the map's geometric center so
      // the confirmation pill cannot cover it. Keep an existing report pin
      // under that visual pin; using it as the raw map center shifts the real
      // checked coordinate and can incorrectly trip the radius boundary.
      if (initialLat != null && initialLng != null) {
        map.setView(
          pinAdjustedCenter(map, initialLat, initialLng, initialZoom),
          initialZoom,
          { animate: false }
        )
      }

      // Clean CARTO light basemap (sign-up style — not busy)
      addBaseTiles(L, map, "light", { maxZoom: 19 })

      publicAlertLayerRef.current = L.layerGroup().addTo(map)
      publicAdvisoryAreaLayerRef.current = L.layerGroup().addTo(map)
      youLayerRef.current = L.layerGroup().addTo(map)
      const publicAlertPane = map.createPane("eboses-public-alerts")
      publicAlertPane.style.zIndex = "650"
      publicAlertPane.style.pointerEvents = "auto"

      map.on("move", () => {
        if (!map) return
        const size = map.getSize()
        const c = size.x > 0 && size.y > 0 ? pinLatLng(map) : map.getCenter()
        setOutOfScope(!insideCoverage(c.lat, c.lng, coverageRef.current))
      })

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        // The center pin is the selected report location. Once the resident
        // manually pans it, the old GPS marker is no longer a second selected
        // location and must not remain on the map.
        setGpsFix(null)
        const c = pinLatLng(map)
        scheduleReverseAndValidateRef.current(c.lat, c.lng)
      })

      mapRef.current = map
      setMapReady(true)
      // The picker mounts into a portal that is still sizing itself, so one
      // frame is not enough: Leaflet measured a collapsed box and painted no
      // tiles. Re-measure on every box change instead.
      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        const current = mapRef.current
        current?.invalidateSize({ animate: false })
        if (
          current &&
          !fittedBoundaryRef.current &&
          initialLat == null &&
          initialLng == null &&
          coverageRef.current.boundary
        ) {
          try {
            const bounds = L.geoJSON(
              coverageRef.current.boundary as never
            ).getBounds()
            if (bounds.isValid()) {
              current.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 })
              fittedBoundaryRef.current = true
            }
          } catch {
            /* Wait for a valid boundary payload instead of breaking the map. */
          }
        }
      })
      observer.observe(container)
      resizeRef.current = observer
      requestAnimationFrame(() => {
        map?.invalidateSize()
        if (map) {
          const c = pinLatLng(map)
          scheduleReverseAndValidateRef.current(c.lat, c.lng)
        }
      })
    }

    void init()

    const advisoryAreas = publicAdvisoryAreasRef.current
    return () => {
      cancelled = true
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      lastLookupKeyRef.current = null
      lastLookupAtRef.current = 0
      resizeRef.current?.disconnect()
      resizeRef.current = null
      removeHoverCardsListener?.()
      fittedBoundaryRef.current = false
      publicAlertLayerRef.current = null
      publicAdvisoryAreaLayerRef.current = null
      advisoryAreas.clear()
      youLayerRef.current = null
      publicAlertMarkers.clear()
      styleEl?.remove()
      try {
        map?.off()
        map?.remove()
      } catch {
        /* Leaflet may already have detached panes during portal close */
      } finally {
        const container = containerRef.current
        if (container) {
          container.innerHTML = ""
          container.classList.remove("eboses-location-picker-map")
        }
      }
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map init is once per open; callbacks use refs
  }, [open])

  // "You are here" dot from the locate button — the public browse map has no
  // center pin, so without this the map moves with no visible result.
  useEffect(() => {
    const group = youLayerRef.current
    if (!open || !mapReady || !group) return
    let cancelled = false
    void import("leaflet").then((L) => {
      if (cancelled || youLayerRef.current !== group) return
      group.clearLayers()
      if (!gpsFix || sosStreetSearch) return
      const size = 12
      L.marker([gpsFix.lat, gpsFix.lng], {
        icon: L.divIcon({
          className: "",
          html: `<span class="eboses-pin-pulse" style="display:block;width:12px;height:12px;border-radius:9999px;background:#171717;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        keyboard: false,
        zIndexOffset: 1100,
      }).addTo(group)
    })
    return () => {
      cancelled = true
    }
  }, [open, mapReady, gpsFix, sosStreetSearch])

  function offlineSosCoverage(): CoverageInput {
    const config = loadOfflineSosConfig()
    const community = (
      config.communities?.length ? config.communities : [config.community]
    )[0]
    if (!community) return {}
    const acceptance = community.acceptance
    const geometry = acceptance?.geometry as GeoJsonPolygon | null
    const hasGeometry =
      geometry?.type === "Polygon" || geometry?.type === "MultiPolygon"
    const centerLat = Number(acceptance?.centerLatitude)
    const centerLng = Number(acceptance?.centerLongitude)
    const radius = Number(acceptance?.radiusMeters)
    const hasCircle =
      Number.isFinite(centerLat) &&
      Number.isFinite(centerLng) &&
      Number.isFinite(radius) &&
      radius > 0
    return {
      boundary: offlineCommunityOutline(community) ?? null,
      policy:
        hasGeometry || hasCircle
          ? {
              acceptance_center_latitude: hasCircle ? centerLat : null,
              acceptance_center_longitude: hasCircle ? centerLng : null,
              acceptance_radius_meters: hasCircle ? radius : 0,
              acceptance_geometry: hasGeometry ? geometry : null,
            }
          : null,
    }
  }

  // Keep coverage data private to the picker. The boundary and radius are used
  // for validation, but are intentionally not drawn on resident/public maps.
  useEffect(() => {
    const map = mapRef.current
    if (!open || !map) return
    if (!mapContext) {
      coverageRef.current = offlineSosCoverage()
      const center = pinLatLng(map)
      setOutOfScope(
        !insideCoverage(center.lat, center.lng, coverageRef.current)
      )
      if (recenterOnOpen) {
        const outline = coverageRef.current.boundary
        if (
          outline &&
          (outline.type === "Polygon" || outline.type === "MultiPolygon")
        ) {
          void import("leaflet").then((L) => {
            try {
              map.fitBounds(L.geoJSON(outline as never).getBounds(), {
                padding: [28, 28],
                maxZoom: 16,
              })
            } catch {
              // Keep the current view instead of failing.
            }
          })
        }
      }
      return
    }
    const boundary = (mapContext.boundary?.geometry ?? null) as never
    coverageRef.current = {
      boundary,
      policy: strictBoundary ? null : mapContext.dispatch_policy,
    }
    const center = pinLatLng(map)
    setOutOfScope(!insideCoverage(center.lat, center.lng, coverageRef.current))
    const initialBoundary = (mapContext.recenter_boundary ?? boundary) as never
    if (
      !initialBoundary ||
      fittedBoundaryRef.current ||
      (!recenterOnOpen && initialLat != null && initialLng != null)
    )
      return
    let cancelled = false
    let frame = 0
    let attempts = 0
    const fitWhenSized = () => {
      if (cancelled || fittedBoundaryRef.current || !mapRef.current) return
      const size = map.getSize()
      if ((size.x <= 0 || size.y <= 0) && attempts < 30) {
        attempts += 1
        frame = window.requestAnimationFrame(fitWhenSized)
        return
      }
      void import("leaflet").then((L) => {
        if (cancelled || fittedBoundaryRef.current || !mapRef.current) return
        try {
          const bounds = L.geoJSON(initialBoundary).getBounds()
          const currentSize = map.getSize()
          if (!bounds.isValid() || currentSize.x <= 0 || currentSize.y <= 0)
            return
          map.fitBounds(bounds, {
            padding: [28, 28],
            maxZoom: 16,
          })
          fittedBoundaryRef.current = true
        } catch {
          /* ignore */
        }
      })
    }
    fitWhenSized()
    return () => {
      cancelled = true
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [open, mapContext, initialLat, initialLng, mapReady, recenterOnOpen, strictBoundary])

  // Public report-map pins share the resident map's glyphs and sizing. The
  // picker still owns the fixed report pin, so moving the map never creates a
  // second competing location marker.
  useEffect(() => {
    const map = mapRef.current
    const group = publicAlertLayerRef.current
    if (!open || !mapReady || !map || !group || !signup) return
    let cancelled = false
    void import("leaflet").then((L) => {
      if (cancelled || !publicAlertLayerRef.current) return
      group.clearLayers()
      publicAlertMarkersRef.current.clear()
      const areaGroup = publicAdvisoryAreaLayerRef.current
      areaGroup?.clearLayers()
      publicAdvisoryAreasRef.current.clear()
      const paintArea = (key: string, strong: boolean) => {
        const entry = publicAdvisoryAreasRef.current.get(key)
        if (!entry) return
        entry.layer.setStyle({ fillOpacity: strong ? 0.3 : 0.16 })
      }
      const boundaryGeometry = (mapContext?.boundary?.geometry ??
        null) as unknown as Parameters<typeof L.geoJSON>[0] | null
      let wideKey: string | null = null
      const paintWide = (key: string | null, color: string | null) => {
        if (!areaGroup || !boundaryGeometry) return
        if (wideKey) {
          areaGroup.clearLayers()
          for (const entry of publicAdvisoryAreasRef.current.values()) {
            entry.layer.addTo(areaGroup)
          }
          wideKey = null
        }
        if (!key || !color) return
        try {
          L.geoJSON(boundaryGeometry, {
            style: {
              stroke: false,
              fillColor: color,
              fillOpacity: 0.15,
              interactive: false,
            },
          }).addTo(areaGroup)
          wideKey = key
        } catch {
          /* skip a malformed boundary */
        }
      }
      for (const alert of publicAlerts) {
        if (
          !Number.isFinite(alert.latitude) ||
          !Number.isFinite(alert.longitude)
        )
          continue
        const selected =
          selectedAlert?.kind === alert.kind && selectedAlert.id === alert.id
        const size =
          alert.kind === "concern"
            ? concernMarkerSize(selected)
            : glyphPinSize(28, selected)
        const html =
          alert.kind === "concern"
            ? concernMarkerHtml({
                category: alert.category || "other",
                iconKey: alert.iconKey,
                status: alert.status,
                severity: alert.severity,
                selected,
                hoverGrow: true,
                tint: (alert.severity ?? "").toLowerCase() !== "critical",
              })
            : alert.kind === "announcement"
              ? advisoryMarkerHtml(
                  alert.tag ?? "",
                  28,
                  "light",
                  selected,
                  advisoryDoneColor(
                    {
                      expires_at: alert.expiresAt ?? null,
                      status_label: alert.status,
                    },
                    ANNOUNCEMENT_ACCENT.color
                  )
                )
              : glyphPinHtml({
                  paths: GLYPHS.emergency,
                  color: [
                    "resolved",
                    "closed",
                    "cancelled",
                    "false_alarm",
                    "invalid",
                  ].includes(alert.status)
                    ? MAP_COLORS.resolved
                    : MAP_COLORS.emergency,
                  size: 28,
                  selected,
                  hoverGrow: true,
                  tint: [
                    "resolved",
                    "closed",
                    "cancelled",
                    "false_alarm",
                    "invalid",
                  ].includes(alert.status),
                })
        const marker = L.marker([alert.latitude, alert.longitude], {
          icon: L.divIcon({
            className: "",
            html,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
          pane: "eboses-public-alerts",
          zIndexOffset: selected ? 1200 : 700,
          keyboard: true,
        })
        marker.on("click", (event) => {
          L.DomEvent.stopPropagation(event)
          onAlertSelect?.({ kind: alert.kind, id: alert.id })
        })
        if (alert.kind === "announcement" && alert.areaGeometry && areaGroup) {
          const key = `${alert.kind}:${alert.id}`
          const areaColor = advisoryDoneColor(
            {
              expires_at: alert.expiresAt ?? null,
              status_label: alert.status,
            },
            ANNOUNCEMENT_ACCENT.color
          )
          try {
            const area = L.geoJSON(alert.areaGeometry as never, {
              style: {
                stroke: false,
                fillColor: areaColor,
                fillOpacity: selected ? 0.3 : 0.16,
                interactive: false,
              },
            }).addTo(areaGroup)
            publicAdvisoryAreasRef.current.set(key, {
              layer: area as leaflet.GeoJSON,
              selected,
            })
            marker.on("mouseover", () => paintArea(key, true))
            marker.on("mouseout", () =>
              paintArea(
                key,
                publicAdvisoryAreasRef.current.get(key)?.selected ?? false
              )
            )
          } catch {
            /* skip a malformed geometry */
          }
        } else if (alert.kind === "announcement" && !alert.areaGeometry) {
          const key = `${alert.kind}:${alert.id}`
          const wideColor = advisoryDoneColor(
            {
              expires_at: alert.expiresAt ?? null,
              status_label: alert.status,
            },
            ANNOUNCEMENT_ACCENT.color
          )
          marker.on("mouseover", () => paintWide(key, wideColor))
          marker.on("mouseout", () =>
            selected ? paintWide(key, wideColor) : paintWide(null, null)
          )
          if (selected) paintWide(key, wideColor)
        }
        bindHoverCard(
          L,
          map,
          marker,
          {
            title: alert.title,
            reporterName:
              alert.kind === "concern" ? alert.reporterName : undefined,
            meta: alert.meta,
            eyebrow:
              alert.kind === "announcement"
                ? advisoryLabel(alert.tag)
                : undefined,
            eyebrowColor:
              alert.kind === "announcement"
                ? ANNOUNCEMENT_ACCENT.color
                : undefined,
            badgeSvg:
              alert.kind === "announcement"
                ? advisoryGlyphHtml(alert.tag, 18)
                : undefined,
            resolved:
              alert.kind === "concern"
                ? alert.status === "resolved" ||
                  alert.status === "partially_resolved"
                : undefined,
            resolvedAt:
              alert.kind === "concern" ? (alert.resolvedAt ?? null) : undefined,
            severity:
              alert.kind === "concern" ? (alert.severity ?? null) : undefined,
            resolutionImage:
              alert.kind === "concern"
                ? (alert.resolutionImage ?? null)
                : undefined,
            resolutionCount:
              alert.kind === "concern"
                ? (alert.resolutionCount ?? 0)
                : undefined,
            description:
              alert.kind === "concern" ? alert.description : undefined,
            summary:
              alert.kind === "concern"
                ? alert.summary
                : alert.kind === "announcement"
                  ? (alert.llmSummary ?? undefined)
                  : undefined,
            excerpt: alert.kind === "concern" ? undefined : alert.summary,
            date: alert.date,
            image: alert.image || undefined,
          },
          size
        )
        marker.addTo(group)
        publicAlertMarkersRef.current.set(`${alert.kind}:${alert.id}`, marker)
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    open,
    mapReady,
    signup,
    publicAlerts,
    selectedAlert,
    onAlertSelect,
    mapContext,
  ])

  useEffect(() => {
    if (!open || !selectedAlert) return
    const marker = publicAlertMarkersRef.current.get(
      `${selectedAlert.kind}:${selectedAlert.id}`
    )
    if (marker && mapRef.current)
      mapRef.current.panTo(marker.getLatLng(), { animate: true })
  }, [open, selectedAlert])

  // Clear stale results when the query drops below the debounce threshold, or
  // the picker opens/closes — via render-adjust instead of a sync setState in
  // the debounce effect below.
  const searchKey = `${open}/${search.trim()}`
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey)
  if (prevSearchKey !== searchKey) {
    setPrevSearchKey(searchKey)
    if (!open || search.trim().length < 2) setResults([])
  }

  // Debounced API search
  useEffect(() => {
    if (!open || search.trim().length < 2) return
    const t = window.setTimeout(() => {
      setSearching(true)
      const request = usesServedCoverage
        ? searchRegistrationStreets(search.trim(), 10).then((data) =>
            (data.results ?? []).map((hit) => ({
              lat: hit.latitude,
              lng: hit.longitude,
              label: `${hit.name}, ${hit.community}`,
              primary: hit.name,
              secondary: hit.community,
              accepted: true,
            }))
          )
        : apiRequest<{ results: SearchHit[] }>(
            `/locations/search/?q=${encodeURIComponent(search.trim())}`
          ).then((data) => data.results || [])
      void request
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 450)
    return () => window.clearTimeout(t)
  }, [search, open, usesServedCoverage])

  const flyTo = useCallback(
    (
      lat: number,
      lng: number,
      parts?: AddressParts,
      zoom?: number | null
    ) => {
      const map = mapRef.current
      if (!map) return
      ignoreMove.current = true
      setGpsFix(null)
      const target = zoom ?? map.getZoom()
      map.setView(pinAdjustedCenter(map, lat, lng, target), target)
      setPreviewLatLng({ lat, lng })
      if (parts) setPreviewParts(parts)
      scheduleReverseAndValidate(lat, lng)
      window.setTimeout(() => {
        ignoreMove.current = false
      }, 500)
    },
    [scheduleReverseAndValidate]
  )

  function recenter() {
    const map = mapRef.current
    if (!map) return
    const boundary =
      mapContext?.home_boundary ??
      mapContext?.recenter_boundary ??
      coverageRef.current.boundary
    if (boundary) {
      void import("leaflet").then((L) => {
        try {
          map.fitBounds(L.geoJSON(boundary as never).getBounds(), {
            padding: [18, 18],
            maxZoom: 16,
          })
        } catch {
          map.setView(DEFAULT_CENTER, 15)
        }
      })
    } else {
      map.setView(DEFAULT_CENTER, 15)
    }
  }

  function locate() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device.")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const accuracy = position.coords.accuracy
        setGpsFix({
          lat,
          lng,
        })
        ignoreMove.current = true
        map.setView(
          pinAdjustedCenter(map, lat, lng, 16),
          16,
          { animate: false }
        )
        scheduleReverseAndValidate(lat, lng, "gps", accuracy)
        window.setTimeout(() => {
          ignoreMove.current = false
        }, 500)
      },
      () => toast.error("Could not get your current location."),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  useEffect(() => {
    if (!open || !autoLocate || !mapReady) return
    locate()
    // Auto-locate only when the shared map transitions to ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoLocate, mapReady])

  const moveStreetViewTo = useCallback(
    (next: StreetViewCoord) => {
      if (!insideCoverage(next.lat, next.lng, coverageRef.current)) {
        toast.error(OUT_OF_SCOPE_MESSAGE)
        return
      }
      flyTo(next.lat, next.lng, undefined, 17)
      setSvCoord(next)
    },
    [flyTo]
  )

  const resolveStreetViewAt = useCallback((next: StreetViewCoord) => {
    // Imagery providers snap a requested location to the nearest panorama,
    // which is commonly in the middle of the road. Keep that camera position
    // for Street View without replacing the resident's more precise report
    // pin/address (and its house number). Explicit movement inside Street View
    // still uses moveStreetViewTo and intentionally updates the report pin.
    setSvCoord(next)
  }, [])

  const openStreetViewAtCenter = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const center = pinLatLng(map)
    if (!insideCoverage(center.lat, center.lng, coverageRef.current)) {
      toast.error(OUT_OF_SCOPE_MESSAGE)
      return
    }
    moveStreetViewTo({ lat: center.lat, lng: center.lng })
  }, [moveStreetViewTo])

  function handleConfirm() {
    const map = mapRef.current
    const center = map ? pinLatLng(map) : undefined
    const lat = previewLatLng?.lat ?? center?.lat
    const lng = previewLatLng?.lng ?? center?.lng
    if (lat == null || lng == null) return
    if (outOfScope) return
    if (
      locationClass &&
      (locationClass.status === "far" || !locationClass.accepted)
    ) {
      return
    }
    // Require a real street line so Concern.address is saved for later display
    // without reverse-geocoding again on My Reports.
    const primary = (previewParts.primary || "").trim()
    const badPrimary =
      !primary ||
      primary === "Finding street…" ||
      primary === "Selected location" ||
      /^lat\b/i.test(primary) ||
      /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
    if (badPrimary || geocoding) {
      return
    }
    const secondary = (
      previewParts.secondary ||
      mapContext?.boundary?.name ||
      ""
    ).trim()
    const full = previewParts.full?.trim() || `${primary}, ${secondary}`
    onConfirm({
      lat,
      lng,
      address: full,
      addressPrimary: primary,
      addressSecondary: secondary,
      source: "manual_pin",
      zone: locationClass?.zone,
      warning: locationClass?.warning,
    })
    onClose()
  }

  useEffect(() => {
    if (!open || svCoord) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose, svCoord])

  const hasQuery = search.trim().length >= 2
  // Sign-up has no search sheet: the resident places the pin, and the address
  // is read off it. Nothing can raise the sheet, so it stays collapsed.
  const sheetMode: "collapsed" | "peek" | "expanded" =
    signup || !hasQuery ? "collapsed" : searchFocused ? "expanded" : "peek"

  const streetPrimary = (previewParts.primary || "").trim()
  const hasUsableStreet =
    Boolean(streetPrimary) &&
    streetPrimary !== "Finding street…" &&
    streetPrimary !== "Selected location" &&
    !/^lat\b/i.test(streetPrimary) &&
    !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(streetPrimary)
  const strictOutside =
    strictBoundary &&
    previewLatLng != null &&
    !insideCoverage(previewLatLng.lat, previewLatLng.lng, {
      boundary: coverageRef.current.boundary,
    })
  const locallyAccepted = offline && previewLatLng != null && !outOfScope
  const canConfirm =
    !outOfScope &&
    !strictOutside &&
    (Boolean(
      locationClass?.accepted && locationClass.status !== "far"
    ) ||
      locallyAccepted) &&
    hasUsableStreet &&
    !geocoding

  const reportPin = onPinStateChange
  useEffect(() => {
    if (!reportPin) return
    if (!previewLatLng) {
      reportPin(null)
      return
    }
    const primary = (previewParts.primary || "").trim()
    const secondary = (previewParts.secondary || "").trim()
    reportPin({
      lat: previewLatLng.lat,
      lng: previewLatLng.lng,
      address:
        previewParts.full?.trim() ||
        [primary, secondary].filter(Boolean).join(", "),
      addressPrimary: primary,
      addressSecondary: secondary,
      ready: canConfirm,
      source: pinSourceRef.current,
      accuracy: pinAccuracyRef.current,
    })
  }, [reportPin, previewLatLng, previewParts, canConfirm])

  const svPoints = useMemo<StreetViewMapPoint[]>(
    () =>
      gpsFix
        ? [
            {
              id: "you",
              lat: gpsFix.lat,
              lng: gpsFix.lng,
              html: glyphPinHtml({
                paths: GLYPHS.userResident,
                color: MAP_COLORS.you,
                size: 24,
              }),
              size: 24,
              title: "You are here",
            },
          ]
        : [],
    [gpsFix]
  )

  if (!open) return null

  const LOCATION_STYLES = `
    .eboses-noscrollbar {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .eboses-noscrollbar::-webkit-scrollbar { width: 0; height: 0; }
    .eboses-map-blocked.leaflet-container,
    .eboses-map-blocked .leaflet-grab,
    .eboses-map-blocked .leaflet-interactive {
      cursor: not-allowed !important;
    }
    .eboses-map-blocked::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 1000;
      pointer-events: none;
      background: rgba(220, 38, 38, 0.1);
    }
    .eboses-loc-resize { resize: both; }
    .eboses-loc-resize::-webkit-resizer { display: none; }
    .eboses-loc-resize::after { display: none !important; content: none !important; }
  `

  const mapBody = (
    <div
      className={cn(
        "relative h-full min-h-0 flex-1 overflow-hidden",
        sheetMode === "expanded" && "eboses-map-search-expanded"
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0 z-0",
          outOfScope && !publicBrowse && "eboses-map-blocked"
        )}
      />

      {!svCoord ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex min-w-0 flex-col items-end gap-2 px-3 pt-3 pb-24">
          <MapControlStack className="pointer-events-auto shrink-0 border-0 bg-white">
            <MapStackButton
              className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
              label="Recenter to the barangay"
              onClick={recenter}
            >
              <HomeIcon className="size-5" strokeWidth={1.8} aria-hidden />
            </MapStackButton>
            <MapStackDivider className="bg-neutral-200" />
            <MapStackButton
              className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
              label="Use my current location"
              onClick={locate}
            >
              <LocateFixedIcon
                className="size-5"
                strokeWidth={1.8}
                aria-hidden
              />
            </MapStackButton>
            {showStreetView && !publicBrowse && (!signup || guestReport) ? (
              <>
                <MapStackDivider className="bg-neutral-200" />
                <MapStackButton
                  className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
                  label="Open Street View here"
                  onClick={openStreetViewAtCenter}
                >
                  <FootprintsIcon
                    className="size-5"
                    strokeWidth={1.9}
                    aria-hidden
                  />
                </MapStackButton>
              </>
            ) : null}
          </MapControlStack>
        </div>
      ) : null}

      {sheetMode !== "expanded" && !svCoord ? (
        <>
          {!publicBrowse && !outOfScope ? (
            <span
              className="eboses-pin-pulse absolute left-1/2 z-30 size-3 rounded-full bg-neutral-900"
              style={{
                top: `calc(50% - ${PIN_OFFSET_Y}px)`,
                marginLeft: -6,
                marginTop: -6,
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              }}
            />
          ) : null}
          <div
            className={cn(
              sosStreetSearch
                ? "pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex items-center justify-center gap-2 px-3"
                : "pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-2 px-4",
              !sosStreetSearch &&
                (!showSearch
                  ? "bottom-3"
                  : signup
                    ? "bottom-5"
                    : sheetMode === "peek"
                      ? "bottom-[116px]"
                      : "bottom-[88px]")
            )}
          >
            {sosStreetSearch ? (
              <>
                {onBackRequest ? (
                  <button
                    type="button"
                    onClick={onBackRequest}
                    aria-label="Back"
                    className="pointer-events-auto flex size-[69px] shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-900 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
                  >
                    <ArrowLeftIcon
                      className="size-6 text-neutral-900"
                      strokeWidth={2}
                    />
                  </button>
                ) : null}
                {outOfScope ? (
                  <SosPill title={OUT_OF_SCOPE_MESSAGE} />
                ) : (
                  <SosPill
                    title="Use this location"
                    subtitle={
                      geocoding ? "Finding address…" : previewParts.primary
                    }
                    onClick={handleConfirm}
                    disabled={!canConfirm || geocoding}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setSosStreetOpen(true)}
                  aria-label="Search streets"
                  className="pointer-events-auto flex size-[69px] shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-900 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
                >
                  <SearchIcon
                    className="size-6 text-neutral-900"
                    strokeWidth={2}
                  />
                </button>
              </>
            ) : publicBrowse ? (
              <div className="pointer-events-none flex w-full items-center justify-center">
                <div className="relative">
                  <button
                    type="button"
                    onClick={onReportRequest}
                    className="pointer-events-auto flex max-w-[min(calc(100vw-125px),340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
                  >
                    <span className="text-[16px] leading-none font-semibold text-neutral-900">
                      Report a concern
                    </span>
                    <span className="mt-1.5 text-[14px] leading-snug font-medium text-neutral-500">
                      Make one
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={
                      onBackRequest ??
                      (() => window.history.back())
                    }
                    aria-label="Go back"
                    title="Go back"
                    className="pointer-events-auto absolute top-1/2 right-full mr-2 flex size-[69px] shrink-0 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
                  >
                    <ArrowLeftIcon
                      className="size-6 text-neutral-900"
                      strokeWidth={2}
                    />
                  </button>
                  {showAlertsButton ? (
                    <button
                      type="button"
                      onClick={onAlertsRequest}
                      aria-label="Open alerts"
                      title="Open alerts"
                      className="pointer-events-auto absolute top-1/2 left-full ml-2 flex size-[69px] shrink-0 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
                    >
                      <CircleAlertIcon
                        className="size-6 text-neutral-900"
                        strokeWidth={2}
                      />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : outOfScope ? (
              <p
                role="status"
                className="pointer-events-none flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
              >
                <span className="text-[15px] leading-none font-semibold text-neutral-900">
                  {OUT_OF_SCOPE_MESSAGE}
                </span>
                <span className="mt-1.5 text-[13px] leading-snug font-medium text-neutral-500">
                  Drag the pin within the barangay only.
                </span>
              </p>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm || geocoding}
                className={cn(
                  "pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform",
                  canConfirm
                    ? "hover:scale-[1.02] active:scale-[0.99]"
                    : "cursor-not-allowed opacity-60"
                )}
              >
                <span className="text-[16px] leading-none font-semibold text-neutral-900">
                  Use this location
                </span>
                <span className="mt-1.5 line-clamp-2 text-[14px] leading-snug font-medium text-neutral-500">
                  {geocoding ? "Finding address…" : previewParts.primary}
                </span>
              </button>
            )}
          </div>
        </>
      ) : null}

      {/* Search bottom sheet */}
      {!svCoord && !signup && showSearch ? (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-40 flex h-full flex-col overflow-hidden bg-white",
            "rounded-t-2xl border-t border-neutral-200 shadow-[0_-8px_28px_rgba(0,0,0,0.12)]",
            "transition-transform duration-300 ease-out will-change-transform",
            sheetMode === "expanded" &&
              "translate-y-0 rounded-none border-0 shadow-none",
            sheetMode === "peek" && "translate-y-[calc(100%-100px)]",
            sheetMode === "collapsed" && "translate-y-[calc(100%-72px)]"
          )}
          onClick={() => {
            if (sheetMode === "peek") {
              setSearchFocused(true)
              searchInputRef.current?.focus()
            }
          }}
        >
          <div className="shrink-0 px-4 pt-3 pb-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                aria-label="Search report location"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchFocused(false), 180)
                }}
                placeholder={
                  usesServedCoverage
                    ? `Search streets in ${PRIMARY_COMMUNITY_NAME}`
                    : `Search streets in ${mapContext?.boundary?.name ?? "your community"}`
                }
                autoComplete="off"
                className={cn(
                  "h-11 w-full rounded-full border border-neutral-200 bg-white pr-4 pl-10 text-[15px] text-neutral-900 outline-none",
                  "placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100"
                )}
              />
            </div>
          </div>

          <ul
            className={cn(
              "scrollbar-hide min-h-0 flex-1 list-none overflow-y-auto",
              sheetMode === "collapsed" && "hidden",
              sheetMode === "peek" && "pointer-events-none select-none",
              sheetMode === "expanded" &&
                hasQuery &&
                results.length === 0 &&
                !searching &&
                "flex flex-col justify-center"
            )}
          >
            {searching ? (
              <li className="px-5 py-3 text-[14px] text-neutral-500">
                Searching…
              </li>
            ) : results.length === 0 && hasQuery ? (
              <li className="px-5 py-3 text-center text-[14px] text-neutral-500">
                No results found
              </li>
            ) : (
              results.map((item) => (
                <li
                  key={`${item.lat}-${item.lng}-${item.label}`}
                  className="border-b border-neutral-100 last:border-b-0"
                >
                  <button
                    type="button"
                    className="flex w-full flex-col px-5 py-3.5 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSearch("")
                      setResults([])
                      setSearchFocused(false)
                      flyTo(item.lat, item.lng, {
                        primary: item.primary,
                        secondary: item.secondary,
                        full: item.secondary
                          ? `${item.primary}, ${item.secondary}`
                          : item.primary,
                      }, 17)
                    }}
                  >
                    <span className="text-[15px] font-semibold text-neutral-900">
                      {item.primary || item.label}
                    </span>
                    {item.secondary ? (
                      <span className="mt-0.5 text-[13px] text-neutral-500">
                        {item.secondary}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {/* SOS wizard street search sheet — draggable, alert-style filter + search */}
      {!svCoord && sosStreetSearch && sosStreetOpen ? (
        <SosStreetSearchSheet
          streets={sosStreets}
          pinLat={previewLatLng?.lat ?? null}
          pinLng={previewLatLng?.lng ?? null}
          onSelect={(street) => {
            setSosStreetOpen(false)
            flyTo(street.lat, street.lng, {
              primary: street.name,
              secondary: PRIMARY_COMMUNITY_NAME,
              full: `${street.name}, ${PRIMARY_COMMUNITY_NAME}`,
            })
          }}
          onGoHome={(lat, lng) => {
            setSosStreetOpen(false)
            flyTo(lat, lng, undefined, 17)
          }}
          onClose={() => setSosStreetOpen(false)}
        />
      ) : null}
    </div>
  )

  // Inline mode: just the map content, no portal/overlay/header
  if (renderInline) {
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <style>{LOCATION_STYLES}</style>
        {mapBody}
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6 md:p-8">
      <style>{LOCATION_STYLES}</style>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Mobile: draggable bottom sheet · Desktop: centered dialog */}
      <div
        className={cn(
          "z-10 flex w-full flex-col overflow-hidden bg-white",
          "absolute inset-x-0 bottom-0 h-[var(--loc-sheet-h)] rounded-t-2xl border-t border-neutral-200 shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
          "eboses-loc-resize md:relative md:inset-auto md:mx-auto md:h-[min(1000px,96vh)] md:min-h-[420px] md:w-[min(100%,26rem)] md:max-w-full md:resize md:overflow-auto md:rounded-2xl md:border md:border-neutral-200 md:shadow-2xl",
          !locSheet.dragging && "transition-[height] duration-200 ease-out"
        )}
        // The sheet height arrives as a CSS variable, not an inline height:
        // an inline style would outrank the md:h-[…] class and keep the
        // desktop dialog clamped to the mobile snap (~560px).
        style={
          { "--loc-sheet-h": `${locSheet.height}px` } as React.CSSProperties
        }
      >
        {/* Drag handle — mobile only */}
        <div
          onPointerDown={locSheet.onHandlePointerDown}
          onPointerMove={locSheet.onHandlePointerMove}
          onPointerUp={locSheet.onHandlePointerUp}
          onPointerCancel={locSheet.onHandlePointerUp}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center bg-white px-3 pt-2 pb-1 active:cursor-grabbing md:hidden"
        >
          <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
        </div>
        <div className="relative flex shrink-0 items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 sm:size-12"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-6" strokeWidth={2} />
          </button>
          <h2 className="pointer-events-none absolute inset-x-0 text-center text-[16px] font-semibold text-neutral-900 sm:text-[17px]">
            Move map to pin location
          </h2>
        </div>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0",
              svCoord && "pointer-events-none invisible"
            )}
          >
            {mapBody}
          </div>
          {svCoord ? (
            <div className="absolute inset-0 z-[1000]">
              <StreetViewModal
                coord={svCoord}
                mode="pick"
                embedded
                points={svPoints}
                onMove={moveStreetViewTo}
                onResolved={resolveStreetViewAt}
                onConfirm={handleConfirm}
                confirmDisabled={!canConfirm || geocoding}
                confirmDetail={
                  geocoding ? "Finding address…" : previewParts.primary
                }
                coverage={
                  mapContext
                    ? {
                        boundary: (mapContext.boundary?.geometry ??
                          null) as never,
                        policy: mapContext.dispatch_policy,
                      }
                    : null
                }
                onClose={() => setSvCoord(null)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
