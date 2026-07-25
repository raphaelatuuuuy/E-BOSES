/**
 * Resident Alerts Map — Nextdoor structure, feed-backed:
 * - Map pins = community feed posts that have coordinates
 * - List = compact preview (+ “Write about this alert”)
 * - Expand = full feed-style post (reload via getConcern) in the left panel
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  CloudRainIcon,
  CloudSunIcon,
  DropletsIcon,
  HomeIcon,
  LeafIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SunIcon,
  TrafficConeIcon,
  WindIcon,
  XIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  commentOnConcern,
  deleteConcernComment,
  getConcern,
  getResidentAlertsMap,
  listFeedConcerns,
  updateConcernComment,
  voteConcern,
  type Concern,
  type ConcernCategory,
  type ConcernStatus,
  type PublicUser,
  type ResidentAlertsMapSnapshot,
  type ResidentMapConcern,
  type ResidentMapEmergency,
} from "@/features/dashboard/api"
import {
  FeedPostCard,
  concernBodyText,
  streetLabelFromAddress,
} from "@/features/dashboard/components/feed-post-card"
import { usePageTitle } from "@/hooks/use-page-title"
import { RESIDENT_DESKTOP_MIN_PX } from "@/features/dashboard/components/resident-top-bar"
import { websocketTicket, websocketUrl } from "@/lib/api"

import type leaflet from "leaflet"

type ChipKey = "all" | "emergencies" | ConcernCategory

const BARANGAY = "Marikina Heights"
/** Default pin for Marikina Heights (used until map meta loads). */
const BARANGAY_CENTER = { lat: 14.6507, lng: 121.1133 }
/** Loose Marikina City bbox — pins outside this are treated as invalid. */
const MAP_BOUNDS = {
  minLat: 14.58,
  maxLat: 14.72,
  minLng: 121.05,
  maxLng: 121.18,
}
/** Max distance from barangay center to treat device GPS as local. */
const LOCAL_GPS_MAX_M = 25_000

type WeatherState = {
  temperature: number | null
  feelsLike: number | null
  code: number | null
  precipitation: number | null
  wind: number | null
  humidity: number | null
  daily: Array<{ day: string; high: number; low: number; code: number; rain: number }>
  loading: boolean
  error: string | null
  placeName: string
}

function weatherLabel(code: number | null) {
  if (code == null) return "Local weather"
  if (code === 0) return "Clear sky"
  if ([1, 2, 3].includes(code)) return "Partly cloudy"
  if ([45, 48].includes(code)) return "Foggy"
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle"
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rainy"
  if ([71, 73, 75, 77].includes(code)) return "Snow"
  if ([95, 96, 99].includes(code)) return "Thunderstorms"
  return "Cloudy"
}

function WeatherIcon({ code, className = "size-5" }: { code: number | null; className?: string }) {
  if (code === 0) return <SunIcon className={className} />
  if (
    code != null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)
  ) {
    return <CloudRainIcon className={className} />
  }
  return <CloudSunIcon className={className} />
}

/** Live Open-Meteo forecast for the barangay map center (Celsius / km/h). */
function useBarangayWeather(lat: number | null, lng: number | null, placeName: string) {
  const [weather, setWeather] = useState<WeatherState>({
    temperature: null,
    feelsLike: null,
    code: null,
    precipitation: null,
    wind: null,
    humidity: null,
    daily: [],
    loading: true,
    error: null,
    placeName,
  })

  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return

    let cancelled = false
    setWeather((prev) => ({ ...prev, loading: true, error: null, placeName }))

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current:
        "temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m,relative_humidity_2m",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Manila",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      forecast_days: "5",
    })

    void (async () => {
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
        if (!response.ok) throw new Error("weather failed")
        const data = (await response.json()) as {
          current?: Record<string, number>
          daily?: Record<string, Array<number | string>>
        }
        if (cancelled) return
        const current = data.current ?? {}
        const daily = data.daily ?? {}
        const dates = (daily.time ?? []) as string[]
        setWeather({
          temperature: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
          feelsLike:
            typeof current.apparent_temperature === "number" ? current.apparent_temperature : null,
          code: typeof current.weather_code === "number" ? current.weather_code : null,
          precipitation:
            typeof current.precipitation === "number" ? current.precipitation : null,
          wind: typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null,
          humidity:
            typeof current.relative_humidity_2m === "number" ? current.relative_humidity_2m : null,
          daily: dates.map((date, index) => ({
            day: new Intl.DateTimeFormat("en", { weekday: "short" }).format(
              new Date(`${date}T12:00:00`),
            ),
            high: Number(daily.temperature_2m_max?.[index] ?? 0),
            low: Number(daily.temperature_2m_min?.[index] ?? 0),
            code: Number(daily.weather_code?.[index] ?? 0),
            rain: Number(daily.precipitation_probability_max?.[index] ?? 0),
          })),
          loading: false,
          error: null,
          placeName,
        })
      } catch {
        if (!cancelled) {
          setWeather((prev) => ({
            ...prev,
            loading: false,
            error: "Weather unavailable",
            placeName,
          }))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [lat, lng, placeName])

  return weather
}

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "emergencies", label: "Emergencies" },
  { key: "public_safety", label: "Safety" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "environment", label: "Environment" },
  { key: "others", label: "Others" },
]

/** Human-readable SOS / emergency pipeline status */
function emergencyStatusLabel(status: string): { label: string; live: boolean } {
  const s = status.toLowerCase()
  if (s === "submitted") return { label: "Submitted", live: true }
  if (s === "routed") return { label: "Routed", live: true }
  if (s === "acknowledged") return { label: "Responder routed", live: true }
  if (s === "en_route") return { label: "En route", live: true }
  if (s === "nearby") return { label: "Nearby", live: true }
  if (s === "arrived") return { label: "Arrived", live: true }
  if (s === "resolved") return { label: "Resolved", live: false }
  if (s === "cancelled") return { label: "Cancelled", live: false }
  return {
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Active",
    live: true,
  }
}

const categoryMeta: Record<ConcernCategory, { label: string; color: string; bg: string }> = {
  infrastructure: { label: "Infrastructure", color: "#2447b3", bg: "#eef3ff" },
  environment: { label: "Environment", color: "#16a34a", bg: "#e9f9ef" },
  public_safety: { label: "Public Safety", color: "#ff5003", bg: "#ffeceb" },
  others: { label: "Others", color: "#ff6a1a", bg: "#fff1ea" },
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

function formatDistance(meters: number | null) {
  if (meters == null || !Number.isFinite(meters)) return null
  // Absurd distances (wrong GPS origin) — hide rather than show 13000 km
  if (meters > 80_000) return null
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function timeAgo(value?: string | null) {
  if (!value) return ""
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function inMapBounds(lat: number, lng: number) {
  return (
    lat >= MAP_BOUNDS.minLat &&
    lat <= MAP_BOUNDS.maxLat &&
    lng >= MAP_BOUNDS.minLng &&
    lng <= MAP_BOUNDS.maxLng
  )
}

/**
 * Normalize report coordinates for Leaflet [lat, lng].
 * - Rejects NaN / out-of-range
 * - Auto-swaps if values were stored as [lng, lat] (common PH bug: 121 / 14)
 * - Rejects pins far outside Marikina so markers don't "teleport" across the world
 */
function validCoord(lat?: string | number | null, lng?: string | number | null) {
  let latitude = Number(lat)
  let longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  // Classic swap: longitude-looking value in latitude field
  if (
    Math.abs(latitude) > 90 &&
    Math.abs(longitude) <= 90 &&
    Math.abs(latitude) <= 180
  ) {
    const t = latitude
    latitude = longitude
    longitude = t
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null
  }
  if (!inMapBounds(latitude, longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function hasMapCoords(post: Concern) {
  return Boolean(validCoord(post.latitude, post.longitude))
}

/**
 * Community feed intentionally masks lat/lng (privacy_safe).
 * Resident alerts-map snapshot still exposes public pin coords — merge them back.
 */
function mergeFeedWithMapCoords(
  feed: Concern[],
  mapConcerns: ResidentMapConcern[] | undefined,
): Concern[] {
  const coordsById = new Map<number, { latitude: string; longitude: string; address?: string }>()
  for (const c of mapConcerns ?? []) {
    if (c.latitude == null || c.longitude == null) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    coordsById.set(c.id, {
      latitude: String(c.latitude),
      longitude: String(c.longitude),
      address: c.address,
    })
  }

  const feedById = new Map(feed.map((p) => [p.id, p]))
  const merged: Concern[] = feed.map((post) => {
    const coords = coordsById.get(post.id)
    if (!coords) return post
    return {
      ...post,
      latitude: coords.latitude,
      longitude: coords.longitude,
      // Keep barangay-level address from feed privacy, but prefer map street if present
      address: coords.address || post.address,
    }
  })

  // Map-only pins (not in feed payload) still show as lightweight list/map items
  for (const c of mapConcerns ?? []) {
    if (feedById.has(c.id)) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    merged.push(mapConcernToFeedPost(c))
  }

  return merged.filter(hasMapCoords)
}

function mapConcernToFeedPost(c: ResidentMapConcern): Concern {
  return {
    id: c.id,
    public_id: String(c.id),
    tracking_id: c.tracking_id,
    validation_status: "accepted",
    validation_summary: "",
    rejection_code: "",
    status_version: 0,
    reporter: {
      id: c.reporter.id,
      full_name: c.reporter.full_name,
      role: c.reporter.role,
      initials: (c.reporter.full_name?.[0] || "?").toUpperCase(),
      last_seen_at: null,
      barangay: c.reporter.barangay,
    },
    title: c.title,
    description: c.description || "",
    category: c.category,
    status: c.status as ConcernStatus,
    address: c.address || c.barangay,
    latitude: c.latitude,
    longitude: c.longitude,
    location_source: "map",
    location_accuracy: null,
    barangay: c.barangay,
    update_text: "",
    visibility: "community",
    media: c.preview_url
      ? [
          {
            id: 0,
            original_filename: "preview.jpg",
            mime_type: "image/jpeg",
            file_size: 0,
            preview_url: c.preview_url,
            raw_url: c.preview_url,
            validation_status: "accepted" as const,
            validation_detail: "",
            uploaded_at: c.created_at,
          },
        ]
      : [],
    status_events: [],
    comments: [],
    vote_count: 0,
    comment_count: 0,
    priority_score: c.priority === "high" ? 10 : 0,
    user_vote: 0,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

/** Prefer device GPS only when it is near Marikina Heights. */
function isLocalGps(pos: { lat: number; lng: number } | null) {
  if (!pos) return false
  if (inMapBounds(pos.lat, pos.lng)) return true
  const d = haversineMeters(BARANGAY_CENTER.lat, BARANGAY_CENTER.lng, pos.lat, pos.lng)
  return d <= LOCAL_GPS_MAX_M
}

/**
 * Map badge labels — same groups as My reports filters
 * (Active / Resolved / Rejected / Appealed).
 */
function statusLabel(status: string): { label: string; tone: "active" | "closed" | "appealed" } {
  if (status === "resolved") return { label: "Resolved", tone: "closed" }
  if (status === "rejected") return { label: "Rejected", tone: "closed" }
  if (status === "appealed") return { label: "Appealed", tone: "appealed" }
  // submitted | under_review | assigned | in_progress
  return { label: "Active", tone: "active" }
}

function markerDotHtml(color: string, selected: boolean) {
  const size = selected ? 34 : 22
  const border = selected ? 3 : 2
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:${border}px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.28)"></div>`
}

/** Ongoing SOS pin — red pulse-style dot */
function emergencyDotHtml() {
  return `<div style="position:relative;width:26px;height:26px">
    <div style="position:absolute;inset:0;border-radius:999px;background:rgba(220,38,38,.28)"></div>
    <div style="position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);border-radius:999px;background:#dc2626;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(220,38,38,.45)"></div>
  </div>`
}

function emergencyBrief(em: ResidentMapEmergency) {
  const type = (em.type_label || em.type || "Emergency").replace(/_/g, " ")
  const note = (em.note || "").trim()
  const street = (em.address || em.barangay || "").trim()
  const detail = note || street || "Ongoing emergency"
  const short = detail.length > 48 ? `${detail.slice(0, 46)}…` : detail
  const st = emergencyStatusLabel(em.status)
  return { title: type, line: short, status: st }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function CategoryIcon({ category, className }: { category: ConcernCategory; className?: string }) {
  if (category === "infrastructure") return <TrafficConeIcon className={className} />
  if (category === "environment") return <LeafIcon className={className} />
  if (category === "public_safety") return <ShieldCheckIcon className={className} />
  return <SearchIcon className={className} />
}

function CategoryFilterChips({
  chip,
  filterLoading,
  onSelect,
  className,
}: {
  chip: ChipKey
  filterLoading: boolean
  onSelect: (key: ChipKey) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]",
        className,
      )}
      style={{ touchAction: "pan-x" }}
      role="tablist"
      aria-label="Categories"
    >
      {CHIPS.map((c) => (
        <button
          key={c.key}
          type="button"
          role="tab"
          aria-selected={chip === c.key}
          disabled={filterLoading}
          onClick={() => onSelect(c.key)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors sm:text-[13px]",
            chip === c.key
              ? "border-[#ff6a1a] bg-[#ff6a1a] text-white shadow-sm"
              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
            filterLoading && "opacity-70",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

type MapApi = {
  flyTo: (lat: number, lng: number, zoom?: number) => void
  panTo: (lat: number, lng: number) => void
  invalidateSize: () => void
  /** Fit the whole barangay boundary (Home). */
  fitBoundary: (paddingBottom?: number) => void
  zoomIn: () => void
  zoomOut: () => void
}

function userPinHtml() {
  return `<div style="position:relative;width:28px;height:28px">
    <div style="position:absolute;inset:0;border-radius:999px;background:rgba(59,130,246,.25)"></div>
    <div style="position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);border-radius:999px;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 10px rgba(37,99,235,.45)"></div>
  </div>`
}

function AlertsLeafletMap({
  center,
  boundary,
  posts,
  emergencies = [],
  selectedId,
  selectedEmergencyId,
  userPos,
  onSelect,
  onSelectEmergency,
  onReady,
  onMapInteract,
}: {
  center: { latitude: number; longitude: number; zoom: number }
  boundary?: ResidentAlertsMapSnapshot["map"]["boundary"] | null
  posts: Concern[]
  emergencies?: ResidentMapEmergency[]
  selectedId: number | null
  selectedEmergencyId?: number | null
  userPos: { lat: number; lng: number } | null
  onSelect: (id: number) => void
  onSelectEmergency?: (id: number) => void
  onReady: (api: MapApi) => void
  onMapInteract?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const groupRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryLayerRef = useRef<leaflet.GeoJSON | null>(null)
  const onMapInteractRef = useRef(onMapInteract)
  onMapInteractRef.current = onMapInteract
  const [mapReady, setMapReady] = useState(false)

  const boundaryGeomKey = useMemo(
    () => (boundary?.geometry ? JSON.stringify(boundary.geometry) : ""),
    [boundary?.geometry],
  )
  const fittedGeomKeyRef = useRef("")

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null
    let ro: ResizeObserver | null = null
    const sizeTimers: number[] = []

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      // Leaflet re-inits into the same node if Strict Mode remounts
      if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        containerRef.current.innerHTML = ""
      }
      LRef.current = L

      // Keep the map inside greater Marikina so tiles stay meaningful
      const maxBounds = L.latLngBounds(
        [MAP_BOUNDS.minLat - 0.02, MAP_BOUNDS.minLng - 0.02],
        [MAP_BOUNDS.maxLat + 0.02, MAP_BOUNDS.maxLng + 0.02],
      )

      map = L.map(containerRef.current, {
        center: [center.latitude, center.longitude],
        zoom: Math.min(Math.max(center.zoom || 15, 13), 17),
        minZoom: 12,
        maxZoom: 19,
        maxBounds,
        maxBoundsViscosity: 0.85,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
        fadeAnimation: false,
        zoomAnimation: true,
        markerZoomAnimation: false,
      })

      /**
       * Product basemap: Carto light (clean grey streets — original E-Boses look).
       * Tailwind img max-width is overridden via .eboses-alerts-map CSS so
       * tiles stay visible.
       */
      const carto = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: "&copy; OpenStreetMap &copy; CARTO",
          maxZoom: 19,
          subdomains: "abcd",
          keepBuffer: 6,
          updateWhenIdle: true,
          className: "eboses-map-tiles",
        },
      )
      carto.addTo(map)

      groupRef.current = L.layerGroup().addTo(map)
      mapRef.current = map

      const forcePaint = () => {
        if (!map || cancelled) return
        map.invalidateSize({ animate: false })
        // Nudge tile reload after layout settles (fixes grey pane)
        const z = map.getZoom()
        map.setZoom(z, { animate: false })
      }

      // Keep tiles painted when sheet / layout resizes the container
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        let resizeTimer: number | undefined
        ro = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(forcePaint, 60)
        })
        ro.observe(containerRef.current)
      }

      const notifyInteract = () => onMapInteractRef.current?.()
      map.on("dragstart", notifyInteract)
      map.on("zoomstart", notifyInteract)
      map.on("click", notifyInteract)

      const goTo = (lat: number, lng: number, zoom = 17) => {
        if (!map) return
        forcePaint()
        map.setView([lat, lng], Math.min(zoom, 18), { animate: true })
      }

      const fitBoundary = (paddingBottom = 24) => {
        if (!map) return
        forcePaint()
        const layer = boundaryLayerRef.current
        if (layer) {
          const bounds = layer.getBounds()
          if (bounds.isValid()) {
            map.fitBounds(bounds, {
              paddingTopLeft: [28, 28],
              paddingBottomRight: [28, Math.max(28, paddingBottom)],
              maxZoom: 16,
              animate: false,
            })
            forcePaint()
            return
          }
        }
        map.setView([center.latitude, center.longitude], 15, { animate: false })
        forcePaint()
      }

      if (!cancelled) {
        setMapReady(true)
        onReady({
          flyTo: goTo,
          panTo: (lat, lng) => {
            forcePaint()
            map?.panTo([lat, lng], { animate: true })
          },
          invalidateSize: () => forcePaint(),
          fitBoundary,
          zoomIn: () => map?.zoomIn(),
          zoomOut: () => map?.zoomOut(),
        })
        // Multiple paints: container often still settling after route mount
        requestAnimationFrame(forcePaint)
        sizeTimers.push(window.setTimeout(forcePaint, 50))
        sizeTimers.push(window.setTimeout(forcePaint, 200))
        sizeTimers.push(window.setTimeout(() => fitBoundary(48), 120))
      }
    }

    void init()
    return () => {
      cancelled = true
      ro?.disconnect()
      for (const t of sizeTimers) window.clearTimeout(t)
      try {
        map?.off()
        map?.remove()
      } catch {
        /* Leaflet may already have detached the pane */
      }
      mapRef.current = null
      LRef.current = null
      groupRef.current = null
      boundaryLayerRef.current = null
      fittedGeomKeyRef.current = ""
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply boundary when geometry first arrives / actually changes (not every soft reload)
  useEffect(() => {
    if (!mapReady) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (!boundaryGeomKey || !boundary?.geometry) return
    if (fittedGeomKeyRef.current === boundaryGeomKey) return

    if (boundaryLayerRef.current) {
      try {
        map.removeLayer(boundaryLayerRef.current)
      } catch {
        /* ignore */
      }
      boundaryLayerRef.current = null
    }
    boundaryLayerRef.current = L.geoJSON(boundary.geometry as Parameters<typeof L.geoJSON>[0], {
      style: {
        color: "#64748b",
        weight: 2,
        fillColor: "#94a3b8",
        fillOpacity: 0.08,
        opacity: 0.75,
        dashArray: "4 4",
      },
    }).addTo(map)
    try {
      const bounds = boundaryLayerRef.current.getBounds()
      if (bounds.isValid()) {
        map.invalidateSize({ animate: false })
        map.fitBounds(bounds, {
          paddingTopLeft: [28, 28],
          paddingBottomRight: [28, 48],
          maxZoom: 16,
          animate: false,
        })
        fittedGeomKeyRef.current = boundaryGeomKey
      }
    } catch {
      /* ignore invalid geometry */
    }
  }, [mapReady, boundaryGeomKey, boundary?.geometry])

  useEffect(() => {
    if (!mapReady) return
    const L = LRef.current
    const group = groupRef.current
    if (!L || !group) return
    group.clearLayers()

    // Only plot device GPS when near Marikina (avoids far-away user pin)
    if (userPos && isLocalGps(userPos)) {
      L.marker([userPos.lat, userPos.lng], {
        icon: L.divIcon({
          className: "",
          html: userPinHtml(),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 1200,
        interactive: false,
        keyboard: false,
      }).addTo(group)
    }

    for (const post of posts) {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) continue
      const color = categoryMeta[post.category]?.color ?? "#64748b"
      const selected = selectedId === post.id
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: markerDotHtml(selected ? color : "#64748b", selected),
          iconSize: [selected ? 34 : 22, selected ? 34 : 22],
          iconAnchor: [selected ? 17 : 11, selected ? 17 : 11],
        }),
        zIndexOffset: selected ? 900 : 100,
      })
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelect(post.id)
      })
      marker.addTo(group)
    }

    // Ongoing emergencies — red dots + brief label
    for (const em of emergencies) {
      const pos = validCoord(em.latitude, em.longitude)
      if (!pos) continue
      const selected = selectedEmergencyId === em.id
      const brief = emergencyBrief(em)
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: emergencyDotHtml(),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        zIndexOffset: selected ? 1100 : 800,
      })
      marker.bindTooltip(
        `<div style="font:600 11px/1.25 system-ui,sans-serif;color:#0f172a;max-width:180px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="color:#dc2626;font-weight:800">${escapeHtml(brief.title)}</span>
            ${
              brief.status.live
                ? `<span style="font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:#dc2626;border-radius:999px;padding:1px 6px">LIVE</span>`
                : ""
            }
          </div>
          <div style="font-weight:600;color:#b91c1c;margin-bottom:2px">${escapeHtml(brief.status.label)}</div>
          <div style="font-weight:500;color:#475569">${escapeHtml(brief.line)}</div>
        </div>`,
        {
          direction: "top",
          offset: [0, -12],
          opacity: 1,
          className: "eboses-em-tip",
          permanent: false,
        },
      )
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectEmergency?.(em.id)
      })
      marker.addTo(group)
    }
  }, [mapReady, posts, emergencies, selectedId, selectedEmergencyId, userPos, onSelect, onSelectEmergency])

  useEffect(() => {
    if (!mapReady || selectedId == null || !mapRef.current) return
    const post = posts.find((p) => p.id === selectedId)
    const pos = post ? validCoord(post.latitude, post.longitude) : null
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedId, posts])

  useEffect(() => {
    if (!mapReady || selectedEmergencyId == null || !mapRef.current) return
    const em = emergencies.find((e) => e.id === selectedEmergencyId)
    const pos = em ? validCoord(em.latitude, em.longitude) : null
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedEmergencyId, emergencies])

  return (
    <>
      {/*
        Tailwind Preflight sets img { max-width: 100% }, which collapses Leaflet
        tiles into a blank grey map. Override inside our map container only.
      */}
      <style>{`
        .eboses-alerts-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8eef5;
          font: inherit;
        }
        .eboses-alerts-map .leaflet-tile-pane,
        .eboses-alerts-map .leaflet-overlay-pane,
        .eboses-alerts-map .leaflet-shadow-pane,
        .eboses-alerts-map .leaflet-marker-pane,
        .eboses-alerts-map .leaflet-tooltip-pane,
        .eboses-alerts-map .leaflet-popup-pane {
          z-index: auto;
        }
        .eboses-em-tip {
          background: #fff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 10px !important;
          box-shadow: 0 6px 18px rgba(15,23,42,.14) !important;
          padding: 6px 8px !important;
        }
        .eboses-em-tip::before { border-top-color: #fff !important; }
        .eboses-alerts-map img.leaflet-tile,
        .eboses-alerts-map .leaflet-tile,
        .eboses-alerts-map .eboses-map-tiles {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
        }
        .eboses-alerts-map .leaflet-container img {
          max-width: none !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="eboses-alerts-map absolute inset-0 z-0 h-full w-full bg-[#e8eef5]"
        style={{ minHeight: "100%" }}
      />
    </>
  )
}

/** Shared weather body used by desktop popover + mobile full panel */
function WeatherDetails({ weather }: { weather: WeatherState }) {
  if (weather.error) {
    return <p className="py-6 text-center text-sm text-neutral-500">{weather.error}</p>
  }
  if (weather.loading && weather.temperature == null) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoaderCircleIcon className="size-7 animate-spin text-neutral-400" />
      </div>
    )
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-2 py-4 sm:gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-neutral-500">{weatherLabel(weather.code)}</p>
          <p className="mt-1 text-2xl font-bold sm:text-3xl">
            {weather.temperature != null ? `${Math.round(weather.temperature)}°` : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">Feels like</p>
          <p className="mt-1 text-lg font-bold sm:text-xl">
            {weather.feelsLike != null ? `${Math.round(weather.feelsLike)}°` : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">Wind</p>
          <p className="mt-1 text-lg font-bold sm:text-xl">
            {weather.wind != null ? `${Math.round(weather.wind)} km/h` : "—"}
          </p>
        </div>
      </div>
      {weather.humidity != null ? (
        <p className="pb-2 text-xs text-neutral-500">
          Humidity {Math.round(weather.humidity)}%
          {weather.precipitation != null && weather.precipitation > 0
            ? ` · Precip ${weather.precipitation} mm`
            : ""}
        </p>
      ) : null}
      {weather.daily.length > 0 ? (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          {weather.daily.map((day) => (
            <div
              key={day.day}
              className="grid grid-cols-[40px_minmax(0,1fr)_auto_36px] items-center gap-2 text-sm"
            >
              <span className="font-bold text-neutral-800">{day.day}</span>
              <WeatherIcon code={day.code} className="size-5 text-amber-500" />
              <span className="font-bold text-neutral-800">
                {Math.round(day.high)}°{" "}
                <span className="font-medium text-neutral-400">{Math.round(day.low)}°</span>
              </span>
              <span className="text-right text-sky-600">{day.rain}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** Compact list preview (Nextdoor first part) — category icon, not media image */
function FeedPreviewCard({
  post,
  distance,
  expanded,
  onOpen,
  onWrite,
}: {
  post: Concern
  distance: number | null
  expanded: boolean
  onOpen: () => void
  onWrite: () => void
}) {
  const st = statusLabel(post.status)
  const meta = categoryMeta[post.category]
  const dist = formatDistance(distance)
  const ago = timeAgo(post.created_at)
  const snippet = concernBodyText(post)

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded ? "border-neutral-300 bg-neutral-50 shadow-sm" : "border-neutral-200",
      )}
    >
      <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-left sm:px-3.5">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10"
            style={{ background: meta?.bg, color: meta?.color }}
          >
            <CategoryIcon category={post.category} className="size-4 sm:size-5" />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-neutral-900 sm:text-[14px]">
                {(() => {
                  const body = concernBodyText(post).replace(/\s+/g, " ").trim()
                  if (!body) return "Report"
                  if (body.length <= 64) return body
                  const slice = body.slice(0, 64)
                  const atWord = slice.replace(/\s+\S*$/, "").trim()
                  return `${(atWord.length >= 24 ? atWord : slice).trim()}...`
                })()}
              </p>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-semibold sm:text-[12px]",
                  st.tone === "active" && "text-red-500",
                  st.tone === "appealed" && "text-amber-600",
                  st.tone === "closed" && "text-neutral-400",
                )}
              >
                {st.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-neutral-500 sm:text-[12px]">
              {[dist, ago].filter(Boolean).join(" · ")}
            </p>
            {snippet ? (
              <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
                {snippet}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      <div className="border-t border-neutral-100 px-3 py-2 sm:px-3.5 sm:py-2.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onWrite()
          }}
          className="flex h-9 w-full items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 sm:text-[13px]"
        >
          Write about this alert
        </button>
      </div>
    </div>
  )
}

/** Emergency list card — type, LIVE badge, pipeline status, place, note */
function EmergencyPreviewCard({
  emergency,
  distance,
  expanded,
  onOpen,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  expanded: boolean
  onOpen: () => void
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const ago = timeAgo(emergency.created_at)
  const place = (emergency.address || emergency.barangay || "").trim()

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-2xl border bg-white px-3 py-3 text-left transition-colors sm:px-3.5",
        expanded
          ? "border-red-300 bg-red-50/40 shadow-sm"
          : "border-neutral-200 hover:border-red-200 hover:bg-red-50/20",
      )}
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 sm:size-10">
          <AlertTriangleIcon className="size-4 sm:size-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-neutral-900 sm:text-[14px]">
              {brief.title}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {brief.status.live ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" />
                  Live
                </span>
              ) : null}
              <span className="text-[11px] font-semibold text-red-600 sm:text-[12px]">
                {brief.status.label}
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-neutral-500 sm:text-[12px]">
            {[dist, ago, place].filter(Boolean).join(" · ")}
          </p>
          {emergency.note?.trim() ? (
            <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
              {emergency.note.trim()}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-snug text-neutral-500 sm:text-[13px]">
              Ongoing SOS — responders may be en route
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

/** Expanded emergency detail in the list panel */
function EmergencyDetailPanel({
  emergency,
  distance,
  onBack,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  onBack: () => void
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const place = (emergency.address || emergency.barangay || "").trim()
  const st = brief.status

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
          aria-label="Back to list"
        >
          <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
        </button>
        <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
          Emergency
        </p>
        {st.live ? (
          <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangleIcon className="size-5" strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold text-neutral-900">{brief.title}</p>
              <p className="mt-1 text-[13px] font-semibold text-red-700">{st.label}</p>
              <p className="mt-1 text-[12px] text-neutral-500">
                {[dist, timeAgo(emergency.created_at)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {place ? (
            <div className="mt-4 flex items-start gap-2 text-[13px] text-neutral-700">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
              <span>{place}</span>
            </div>
          ) : null}

          {emergency.note?.trim() ? (
            <div className="mt-3 rounded-xl border border-red-100 bg-white px-3 py-2.5">
              <p className="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">
                Note
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-neutral-800">
                {emergency.note.trim()}
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Status</p>
              <p className="mt-0.5 font-semibold text-neutral-900">{st.label}</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Type</p>
              <p className="mt-0.5 font-semibold capitalize text-neutral-900">
                {(emergency.type_label || emergency.type || "—").replace(/_/g, " ")}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Reported</p>
              <p className="mt-0.5 font-semibold text-neutral-900">
                {timeAgo(emergency.created_at) || "—"}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Updated</p>
              <p className="mt-0.5 font-semibold text-neutral-900">
                {timeAgo(emergency.updated_at) || "—"}
              </p>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-neutral-500">
            {st.live
              ? "This SOS is active. Barangay responders may be en route. Stay clear if you are not involved."
              : "This emergency is no longer active."}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ResidentAlertsMapPage() {
  usePageTitle("Alerts Map")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [posts, setPosts] = useState<Concern[]>([])
  const [emergencies, setEmergencies] = useState<ResidentMapEmergency[]>([])
  // Mount map immediately with barangay defaults — don't wait on API (slow OSM/POI path)
  const [mapMeta, setMapMeta] = useState<ResidentAlertsMapSnapshot["map"]>(() => ({
    provider: "OpenStreetMap",
    center: {
      latitude: BARANGAY_CENTER.lat,
      longitude: BARANGAY_CENTER.lng,
      zoom: 15,
    },
    boundary: { osm_relation_id: 371327, name: BARANGAY, geometry: null },
  }))
  const [loading, setLoading] = useState(true)
  const [filterLoading, setFilterLoading] = useState(false)
  const [error, setError] = useState("")
  const [chip, setChip] = useState<ChipKey>("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedEmergencyId, setSelectedEmergencyId] = useState<number | null>(null)
  const [expandedPost, setExpandedPost] = useState<Concern | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)
  const [focusComment, setFocusComment] = useState(false)
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
  /** Mobile sheet: full list, peek preview bar, or fully tucked while using the map */
  const [sheetMode, setSheetMode] = useState<"expanded" | "peek" | "hidden">("expanded")
  const [sheetHeight, setSheetHeight] = useState(() =>
    typeof window !== "undefined" ? Math.round(Math.min(window.innerHeight * 0.55, 520)) : 420,
  )
  const [sheetDragging, setSheetDragging] = useState(false)
  const sheetDragRef = useRef<{
    startY: number
    startH: number
    pointerId: number
  } | null>(null)
  const mapApiRef = useRef<MapApi | null>(null)
  const isDesktop = useMediaDesktop()
  const [weatherOpen, setWeatherOpen] = useState(false)
  const weatherPanelRef = useRef<HTMLDivElement>(null)
  const [locating, setLocating] = useState(false)

  // Desktop weather: close when clicking outside (loses focus)
  useEffect(() => {
    if (!weatherOpen || !isDesktop) return
    function onPointerDown(e: PointerEvent) {
      const root = weatherPanelRef.current
      if (!root) return
      if (e.target instanceof Node && !root.contains(e.target)) {
        setWeatherOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setWeatherOpen(false)
    }
    // Capture phase so map clicks still close the panel
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [weatherOpen, isDesktop])

  const sheetSnaps = useCallback(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    return {
      hidden: 56,
      peek: Math.round(Math.min(268, vh * 0.34)),
      expanded: Math.round(Math.min(vh * 0.58, 560)),
      max: Math.round(Math.min(vh * 0.88, 720)),
    }
  }, [])

  const snapSheetTo = useCallback(
    (mode: "expanded" | "peek" | "hidden") => {
      const s = sheetSnaps()
      setSheetMode(mode)
      setSheetHeight(mode === "expanded" ? s.expanded : mode === "peek" ? s.peek : s.hidden)
      window.requestAnimationFrame(() => mapApiRef.current?.invalidateSize())
    },
    [sheetSnaps],
  )

  const collapseSheetForMap = useCallback(() => {
    if (isDesktop) return
    setWeatherOpen(false)
    snapSheetTo("hidden")
  }, [isDesktop, snapSheetTo])

  function onSheetHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (isDesktop) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    sheetDragRef.current = {
      startY: e.clientY,
      startH: sheetHeight,
      pointerId: e.pointerId,
    }
    setSheetDragging(true)
  }

  function onSheetHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const s = sheetSnaps()
    const delta = drag.startY - e.clientY
    const next = Math.min(s.max, Math.max(s.hidden, drag.startH + delta))
    setSheetHeight(next)
  }

  function onSheetHandlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    sheetDragRef.current = null
    setSheetDragging(false)

    const s = sheetSnaps()
    // Use live height from drag end position (state may lag one frame)
    const h = Math.min(s.max, Math.max(s.hidden, drag.startH + (drag.startY - e.clientY)))
    if (h > (s.expanded + s.max) / 2) {
      setSheetMode("expanded")
      setSheetHeight(s.max)
    } else {
      const targets: Array<{ mode: "expanded" | "peek" | "hidden"; h: number }> = [
        { mode: "hidden", h: s.hidden },
        { mode: "peek", h: s.peek },
        { mode: "expanded", h: s.expanded },
      ]
      let best = targets[0]!
      let bestDist = Math.abs(h - best.h)
      for (const t of targets) {
        const d = Math.abs(h - t.h)
        if (d < bestDist) {
          best = t
          bestDist = d
        }
      }
      snapSheetTo(best.mode)
    }
    window.requestAnimationFrame(() => mapApiRef.current?.invalidateSize())
  }

  const weatherLat = mapMeta?.center.latitude ?? BARANGAY_CENTER.lat
  const weatherLng = mapMeta?.center.longitude ?? BARANGAY_CENTER.lng
  const weatherPlace = (() => {
    const fromMap = mapMeta?.boundary?.name?.trim()
    if (fromMap) return fromMap
    const fromUser = (user?.barangay || "").trim()
    if (fromUser && fromUser.toLowerCase() !== "pending") return fromUser
    return BARANGAY
  })()
  const weather = useBarangayWeather(weatherLat, weatherLng, weatherPlace)

  const load = useCallback(async (soft = false) => {
    if (!soft) setError("")
    try {
      // Parallel: map snapshot has public pin coords; feed has votes/comments but masks lat/lng
      const mapSnapPromise = getResidentAlertsMap()
        .then((mapSnap) => {
          if (mapSnap?.map) setMapMeta(mapSnap.map)
          return mapSnap
        })
        .catch(() => null)
      const feedPromise = listFeedConcerns("all").catch(() => [] as Concern[])

      const [mapSnap, feed] = await Promise.all([mapSnapPromise, feedPromise])
      const withPins = mergeFeedWithMapCoords(feed, mapSnap?.concerns)
      setPosts(withPins)
      setEmergencies(
        (mapSnap?.emergencies ?? []).filter((em) => validCoord(em.latitude, em.longitude)),
      )
    } catch {
      setError("Could not load feed alerts.")
      if (!soft) toast.error("Could not load alerts")
    } finally {
      setLoading(false)
    }
  }, [])

  async function applyChip(next: ChipKey) {
    if (next === chip && !filterLoading) return
    closePost()
    setSelectedEmergencyId(null)
    setChip(next)
    setFilterLoading(true)
    try {
      // Brief UI load so filter switch always shows feedback (client filter is instant)
      await new Promise((r) => window.setTimeout(r, 280))
    } finally {
      setFilterLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false
    let attempts = 0
    const seen = new Set<string>()

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/dashboard/resident-live-map/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        if (!closed) {
          attempts += 1
          reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
        }
        return
      }
      socket.onopen = () => {
        attempts = 0
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string
            payload?: { concern?: ResidentMapConcern; emergency?: ResidentMapEmergency; removed?: boolean }
          }
          if (message.type !== "concern.created" && message.type !== "concern.updated" && message.type !== "emergency.created" && message.type !== "emergency.updated") return
          const resource = message.payload?.concern ?? message.payload?.emergency
          if (!resource?.id) return
          const key = `${message.type}:${resource.id}:${"updated_at" in resource ? resource.updated_at : ""}:${"status" in resource ? resource.status : ""}`
          if (seen.has(key)) return
          seen.add(key)
          if (seen.size > 200) seen.delete(seen.values().next().value as string)
          if (message.payload?.concern) {
            if (message.payload.removed || message.payload.concern.status === "rejected") {
              setPosts((current) => current.filter((post) => post.id !== resource.id))
            } else {
              void load(true)
            }
          } else if (message.payload?.emergency) {
            const emergency = message.payload.emergency
            const active = ["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"].includes(emergency.status)
            setEmergencies((current) => active
              ? current.some((item) => item.id === emergency.id)
                ? current.map((item) => item.id === emergency.id ? emergency : item)
                : [emergency, ...current]
              : current.filter((item) => item.id !== emergency.id))
          }
        } catch {
          // REST refresh remains the recovery path for malformed events.
        }
      }
      socket.onclose = () => {
        if (!closed) {
          attempts += 1
          reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [load, user?.id])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        // Ignore GPS outside the area — caused "13000 km away" labels
        setUserPos(isLocalGps(next) ? next : null)
      },
      () => setUserPos(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [])

  // Distance origin: local GPS when near MH, else barangay center (never far-away device GPS)
  const origin = useMemo(() => {
    if (userPos && isLocalGps(userPos)) return userPos
    if (mapMeta?.center) {
      return { lat: mapMeta.center.latitude, lng: mapMeta.center.longitude }
    }
    return { ...BARANGAY_CENTER }
  }, [userPos, mapMeta])

  const filtered = useMemo(() => {
    if (chip === "emergencies") return [] as Concern[]
    const base = chip === "all" ? posts : posts.filter((p) => p.category === chip)
    // Drop posts with invalid / out-of-area coordinates (no random far pins)
    return base.filter((p) => hasMapCoords(p))
  }, [posts, chip])

  const filteredEmergencies = useMemo(() => {
    if (chip !== "all" && chip !== "emergencies") return [] as ResidentMapEmergency[]
    return emergencies
  }, [emergencies, chip])

  const distanceFor = useCallback(
    (post: Concern) => {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) return null
      return haversineMeters(origin.lat, origin.lng, pos[0], pos[1])
    },
    [origin],
  )

  const distanceForEmergency = useCallback(
    (em: ResidentMapEmergency) => {
      const pos = validCoord(em.latitude, em.longitude)
      if (!pos) return null
      return haversineMeters(origin.lat, origin.lng, pos[0], pos[1])
    },
    [origin],
  )

  async function openPost(id: number, write = false) {
    setSelectedEmergencyId(null)
    setSelectedId(id)
    setWeatherOpen(false)
    snapSheetTo("expanded")
    setFocusComment(write)
    setExpandLoading(true)
    try {
      // Reload full feed post (comments, votes, media) into the left panel
      const full = await getConcern(id)
      setExpandedPost(full)
      // Keep list in sync with lightweight fields
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...full, media: full.media } : p)))
    } catch {
      const fallback = posts.find((p) => p.id === id) ?? null
      setExpandedPost(fallback)
      if (!fallback) toast.error("Could not open post")
    } finally {
      setExpandLoading(false)
    }
  }

  function clearSelection() {
    setSelectedId(null)
    setExpandedPost(null)
    setFocusComment(false)
    setSelectedEmergencyId(null)
  }

  function closePost() {
    clearSelection()
    if (!isDesktop) snapSheetTo("peek")
  }

  function openEmergency(id: number) {
    setSelectedId(null)
    setExpandedPost(null)
    setFocusComment(false)
    setSelectedEmergencyId(id)
    setWeatherOpen(false)
    if (!isDesktop) snapSheetTo("expanded")
  }

  const selectedEmergency =
    selectedEmergencyId != null
      ? (filteredEmergencies.find((e) => e.id === selectedEmergencyId) ??
        emergencies.find((e) => e.id === selectedEmergencyId) ??
        null)
      : null

  function goHomeOnMap() {
    if (!mapMeta) return
    clearSelection()
    collapseSheetForMap()
    window.setTimeout(() => {
      mapApiRef.current?.invalidateSize()
      // Fit entire barangay boundary (not a tight center zoom)
      mapApiRef.current?.fitBoundary(isDesktop ? 48 : sheetSnaps().hidden + 24)
    }, 100)
  }

  function goMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Location unavailable")
      return
    }
    clearSelection()
    collapseSheetForMap()
    setLocating(true)
    // Fresh GPS fix on every click — hide sheet first so the pin isn't under the panel
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLocating(false)
        if (!isLocalGps(next)) {
          setUserPos(null)
          toast.error("Your location is outside Marikina Heights")
          window.setTimeout(() => {
            mapApiRef.current?.invalidateSize()
            mapApiRef.current?.fitBoundary(48)
          }, 120)
          return
        }
        setUserPos(next)
        window.setTimeout(() => {
          mapApiRef.current?.invalidateSize()
          mapApiRef.current?.flyTo(next.lat, next.lng, 17)
        }, 120)
      },
      () => {
        setLocating(false)
        toast.error("Could not get your location")
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const sessionUserAsPublic: PublicUser | null = user
    ? {
        id: user.id,
        full_name:
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident",
        role: user.role,
        initials:
          `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?",
        last_seen_at: null,
        street: streetLabelFromAddress(user.address) ?? undefined,
        barangay: user.barangay || BARANGAY,
      }
    : null

  async function refreshPost(id: number) {
    try {
      const full = await getConcern(id)
      setExpandedPost(full)
      setPosts((prev) => prev.map((p) => (p.id === id ? full : p)))
    } catch {
      /* keep current */
    }
  }

  const nearestPreview = useMemo(() => {
    if (filtered.length === 0) return null
    return [...filtered].sort((a, b) => (distanceFor(a) ?? 1e9) - (distanceFor(b) ?? 1e9))[0]
  }, [filtered, distanceFor])

  const nearestEmergency = useMemo(() => {
    if (filteredEmergencies.length === 0) return null
    return [...filteredEmergencies].sort(
      (a, b) => (distanceForEmergency(a) ?? 1e9) - (distanceForEmergency(b) ?? 1e9),
    )[0]
  }, [filteredEmergencies, distanceForEmergency])

  const mapItemCount = filtered.length + filteredEmergencies.length

  if (loading && posts.length === 0 && emergencies.length === 0) {
    return (
      <div className="relative h-full min-h-[60vh] w-full bg-[#f4f6f9]">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    )
  }

  const listEmpty =
    filtered.length === 0 &&
    filteredEmergencies.length === 0 &&
    !filterLoading

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      {selectedEmergency ? (
        <EmergencyDetailPanel
          emergency={selectedEmergency}
          distance={distanceForEmergency(selectedEmergency)}
          onBack={closePost}
        />
      ) : selectedId != null && (expandedPost || expandLoading) ? (
        expandLoading && !expandedPost ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : expandedPost ? (
          <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
            <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-3">
              <button
                type="button"
                onClick={closePost}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
                aria-label="Back to list"
              >
                <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
              </button>
              <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
                Report
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
              <FeedPostCard
                post={expandedPost}
                sessionUser={sessionUserAsPublic}
                commentsExpanded
                focusCommentOnMount={focusComment}
                className="border-0 shadow-none"
                onVote={async (p) => {
                  const nextVote = p.user_vote === 1 ? 0 : 1
                  try {
                    const result = await voteConcern(p.id, nextVote)
                    const next = {
                      ...p,
                      user_vote: result.user_vote,
                      vote_count: result.vote_count,
                    }
                    setExpandedPost(next)
                    setPosts((prev) => prev.map((x) => (x.id === p.id ? next : x)))
                  } catch {
                    toast.error("Could not update vote")
                  }
                }}
                onComment={async (postId, body, parent) => {
                  try {
                    await commentOnConcern(postId, { body, parent: parent ?? null })
                    await refreshPost(postId)
                  } catch {
                    toast.error("Could not post comment")
                    throw new Error("comment failed")
                  }
                }}
                onEditComment={async (postId, commentId, body) => {
                  try {
                    await updateConcernComment(postId, commentId, { body })
                    await refreshPost(postId)
                  } catch {
                    toast.error("Could not update comment")
                  }
                }}
                onDeleteComment={async (postId, commentId) => {
                  try {
                    await deleteConcernComment(postId, commentId)
                    await refreshPost(postId)
                  } catch {
                    toast.error("Could not delete comment")
                  }
                }}
              />
            </div>
          </div>
        ) : null
      ) : (
        <>
          <div className="shrink-0 bg-white px-4 pb-2 pt-3 sm:pt-4">
            <h1 className="text-[18px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[20px]">
              Alerts in {weatherPlace}
            </h1>
          </div>

          <div className="relative shrink-0 px-3 pb-2 sm:pb-3">
            <CategoryFilterChips
              chip={chip}
              filterLoading={filterLoading}
              onSelect={(key) => void applyChip(key)}
            />
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
            {filterLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 sm:py-16">
                <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                <p className="text-[13px] font-medium text-neutral-500">Loading…</p>
              </div>
            ) : listEmpty ? (
              <div className="flex flex-col items-center px-4 py-10 text-center sm:py-12">
                {chip === "emergencies" ? (
                  <AlertTriangleIcon className="mb-2 size-10 text-neutral-300" />
                ) : (
                  <MapPinIcon className="mb-2 size-10 text-neutral-300" />
                )}
                <p className="text-[14px] font-semibold text-neutral-800 sm:text-[15px]">
                  {chip === "emergencies"
                    ? "No ongoing emergencies"
                    : "No feed posts on the map"}
                </p>
                <p className="mt-1 text-[12px] text-neutral-500 sm:text-[13px]">
                  {chip === "emergencies"
                    ? "Active SOS alerts in Marikina Heights will show here."
                    : "Community posts with a location appear here."}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {/* Emergencies first when All / Emergencies filter */}
                {[...filteredEmergencies]
                  .sort(
                    (a, b) =>
                      (distanceForEmergency(a) ?? 1e9) - (distanceForEmergency(b) ?? 1e9),
                  )
                  .map((em) => (
                    <li key={`em-${em.id}`}>
                      <EmergencyPreviewCard
                        emergency={em}
                        distance={distanceForEmergency(em)}
                        expanded={selectedEmergencyId === em.id}
                        onOpen={() => openEmergency(em.id)}
                      />
                    </li>
                  ))}
                {[...filtered]
                  .sort((a, b) => (distanceFor(a) ?? 1e9) - (distanceFor(b) ?? 1e9))
                  .map((post) => (
                    <li key={post.id}>
                      <FeedPreviewCard
                        post={post}
                        distance={distanceFor(post)}
                        expanded={selectedId === post.id}
                        onOpen={() => void openPost(post.id, false)}
                        onWrite={() => void openPost(post.id, true)}
                      />
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-[#f4f6f9]",
        isDesktop ? "h-[calc(100svh-3.5rem)]" : "h-[calc(100svh-5rem)]",
      )}
    >
      {mapMeta ? (
        <AlertsLeafletMap
          center={mapMeta.center}
          boundary={mapMeta.boundary}
          posts={filtered}
          emergencies={filteredEmergencies}
          selectedId={selectedId}
          selectedEmergencyId={selectedEmergencyId}
          userPos={userPos}
          onSelect={(id) => {
            void openPost(id, false)
          }}
          onSelectEmergency={(id) => openEmergency(id)}
          onMapInteract={collapseSheetForMap}
          onReady={(api) => {
            mapApiRef.current = api
          }}
        />
      ) : null}

      {/* Ongoing emergency banner when any SOS is in the current filter */}
      {filteredEmergencies.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center px-3 md:top-4 md:justify-start md:pl-4">
          <div className="pointer-events-auto max-w-sm rounded-xl border border-red-100 bg-white px-3 py-2 shadow-md">
            <p className="text-[11px] font-bold tracking-wide text-red-600 uppercase">
              {filteredEmergencies.length} ongoing SOS
              {filteredEmergencies.length === 1 ? "" : "s"}
            </p>
            {selectedEmergency ? (
              (() => {
                const brief = emergencyBrief(selectedEmergency)
                return (
                  <div className="mt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[13px] font-semibold text-neutral-900">{brief.title}</p>
                      {brief.status.live ? (
                        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white uppercase">
                          Live
                        </span>
                      ) : null}
                      <span className="text-[11px] font-semibold text-red-600">
                        {brief.status.label}
                      </span>
                    </div>
                    <p className="text-[12px] leading-snug text-neutral-600">{brief.line}</p>
                    {(selectedEmergency.address || selectedEmergency.barangay) &&
                    selectedEmergency.note ? (
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {selectedEmergency.address || selectedEmergency.barangay}
                      </p>
                    ) : null}
                  </div>
                )
              })()
            ) : (
              <p className="mt-0.5 text-[12px] text-neutral-600">
                Red pins on the map — tap for live details
              </p>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm rounded-2xl border border-red-200 bg-white p-4 text-center shadow-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button
            type="button"
            className="mt-3 rounded-full bg-[#07145f] px-4 py-2 text-sm font-bold text-white"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Mobile: back button on the left */}
      {!isDesktop ? (
        <div className="absolute left-3 top-3 z-30">
          <button
            type="button"
            onClick={() => navigate("/dashboard/home")}
            className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-800 shadow-md"
            aria-label="Back to home"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        </div>
      ) : null}

      {/* Map controls (right): Home → Location → Weather → Zoom */}
      <div
        ref={isDesktop ? weatherPanelRef : undefined}
        className={cn(
          "absolute z-30 flex flex-col items-end gap-2",
          isDesktop ? "right-4 top-4" : "right-3 top-3",
        )}
      >
          <button
            type="button"
            onClick={goHomeOnMap}
            className={cn(
              "inline-flex h-10 w-fit shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-800 shadow-md",
              isDesktop ? "gap-1.5 px-2.5 text-[13px] font-semibold" : "size-10 p-0",
            )}
            aria-label="Home"
            title="Home"
          >
            <HomeIcon className="size-5 shrink-0" strokeWidth={2} />
            {isDesktop ? <span className="whitespace-nowrap">Home</span> : null}
          </button>
          <button
            type="button"
            onClick={goMyLocation}
            disabled={locating}
            className={cn(
              "inline-flex h-10 w-fit shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-800 shadow-md disabled:opacity-70",
              isDesktop ? "gap-1.5 px-2.5 text-[13px] font-semibold" : "size-10 p-0",
            )}
            aria-label="Current location"
            title="Current location"
          >
            {locating ? (
              <LoaderCircleIcon className="size-5 shrink-0 animate-spin" strokeWidth={2} />
            ) : (
              <MapPinIcon className="size-5 shrink-0" strokeWidth={2} />
            )}
            {isDesktop ? <span className="whitespace-nowrap">Current location</span> : null}
          </button>

          <div className="relative flex flex-col items-end">
            <button
              type="button"
              onClick={() => {
                setWeatherOpen((value) => !value)
                if (!isDesktop) snapSheetTo("hidden")
              }}
              className="inline-flex h-10 w-fit shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] font-bold text-neutral-900 shadow-md"
              aria-label="Open weather"
              aria-expanded={weatherOpen}
            >
              {weather.loading ? (
                <LoaderCircleIcon className="size-4 animate-spin text-neutral-400" />
              ) : (
                <WeatherIcon code={weather.code} className="size-5 text-amber-500" />
              )}
              <span>
                {weather.temperature != null
                  ? `${Math.round(weather.temperature)}°C`
                  : "—"}
              </span>
            </button>

            {/* Desktop: popover under weather chip — closes on outside click / Escape */}
            {weatherOpen && isDesktop ? (
              <section className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(calc(100vw-1.5rem),340px)] rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-[0_12px_34px_rgba(15,23,42,.16)]">
                <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold sm:text-lg">
                      {weather.placeName}
                    </h2>
                    <p className="text-xs text-neutral-500">Current weather</p>
                  </div>
                  {weather.loading ? (
                    <LoaderCircleIcon className="size-7 shrink-0 animate-spin text-neutral-400" />
                  ) : (
                    <WeatherIcon
                      code={weather.code}
                      className="size-8 shrink-0 text-amber-500"
                    />
                  )}
                </div>
                <WeatherDetails weather={weather} />
              </section>
            ) : null}
          </div>

          {/* +/- zoom directly under weather */}
          <div className="flex w-10 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-md">
            <button
              type="button"
              onClick={() => mapApiRef.current?.zoomIn()}
              className="flex h-10 items-center justify-center text-neutral-800 hover:bg-neutral-50"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <PlusIcon className="size-5" strokeWidth={2.25} />
            </button>
            <div className="h-px w-full bg-neutral-200" />
            <button
              type="button"
              onClick={() => mapApiRef.current?.zoomOut()}
              className="flex h-10 items-center justify-center text-neutral-800 hover:bg-neutral-50"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <MinusIcon className="size-5" strokeWidth={2.25} />
            </button>
          </div>
        </div>

      {/* Mobile weather sheet — E-Boses white style, close (X) on the right */}
      {!isDesktop && weatherOpen ? (
        <>
          {/* Dim map only; keep right-side controls above (z-30) */}
          <button
            type="button"
            className="absolute inset-0 z-[25] cursor-default bg-black/20"
            aria-label="Dismiss weather"
            onClick={() => setWeatherOpen(false)}
          />
          <section
            className="absolute bottom-0 left-0 right-0 z-40 max-h-[min(78svh,640px)] overflow-y-auto overscroll-contain rounded-t-3xl border border-neutral-200 border-b-0 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-neutral-900 shadow-[0_-12px_40px_rgba(15,23,42,.14)]"
            role="dialog"
            aria-modal="true"
            aria-label="Weather"
          >
            {/* Header: place + as of · close on right */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[17px] font-bold leading-tight text-neutral-900">
                  {weather.placeName}
                </h2>
                <p className="mt-0.5 text-[13px] text-neutral-500">
                  As of{" "}
                  {new Intl.DateTimeFormat("en", {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date())}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWeatherOpen(false)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100"
                aria-label="Close weather"
              >
                <XIcon className="size-5" strokeWidth={2.25} />
              </button>
            </div>

            {weather.loading && weather.temperature == null ? (
              <div className="flex justify-center py-12">
                <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
              </div>
            ) : weather.error ? (
              <p className="py-10 text-center text-sm text-neutral-500">{weather.error}</p>
            ) : (
              <>
                {/* Condition */}
                <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-neutral-900">
                  <span>{weatherLabel(weather.code)}</span>
                  <WeatherIcon code={weather.code} className="size-5 text-amber-500" />
                </div>

                {/* Main grid — photo layout, E-Boses light chrome */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <p className="text-[40px] font-bold leading-none tracking-tight text-neutral-900">
                      {weather.temperature != null
                        ? `${Math.round(weather.temperature)}°C`
                        : "—"}
                    </p>
                  </div>
                  <div className="pt-1">
                    <p className="text-[12px] text-neutral-500">Day</p>
                    <p className="text-[22px] font-bold leading-tight text-neutral-900">
                      {weather.daily[0]
                        ? `${Math.round(weather.daily[0].high)}°`
                        : weather.temperature != null
                          ? `${Math.round(weather.temperature)}°`
                          : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[12px] text-neutral-500">Night</p>
                    <p className="text-[22px] font-bold leading-tight text-neutral-900">
                      {weather.daily[0]
                        ? `${Math.round(weather.daily[0].low)}°`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-neutral-500">Feels like</p>
                    <p className="text-[22px] font-bold leading-tight text-neutral-900">
                      {weather.feelsLike != null
                        ? `${Math.round(weather.feelsLike)}°`
                        : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[12px] text-neutral-500">Precipitation</p>
                    <p className="text-[22px] font-bold leading-tight text-neutral-900">
                      {weather.daily[0]
                        ? `${Math.round(weather.daily[0].rain)}%`
                        : weather.precipitation != null
                          ? `${Math.round(weather.precipitation)} mm`
                          : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-neutral-500">Wind</p>
                    <p className="text-[22px] font-bold leading-tight text-neutral-900">
                      {weather.wind != null
                        ? `${Math.round(weather.wind)} km/h`
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* 5-day rows */}
                {weather.daily.length > 0 ? (
                  <div className="mt-5 space-y-3 border-t border-neutral-100 pt-4">
                    {weather.daily.map((day) => (
                      <div
                        key={day.day}
                        className="grid grid-cols-[44px_28px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-1 text-[15px]"
                      >
                        <span className="font-bold text-neutral-900">{day.day}</span>
                        <WeatherIcon
                          code={day.code}
                          className="size-5 text-amber-500"
                        />
                        <span className="font-semibold text-neutral-900">
                          {Math.round(day.high)}°
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-neutral-600">
                          <WindIcon className="size-3.5 shrink-0 text-neutral-400" />
                          {Math.round(day.low)}°
                        </span>
                        <span className="inline-flex items-center justify-end gap-0.5 font-semibold text-sky-600">
                          <DropletsIcon className="size-3.5 shrink-0" />
                          {day.rain}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </>
      ) : null}

      {isDesktop ? (
        <aside className="absolute left-4 top-4 z-20 flex w-[min(100%,380px)] max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)]">
          {panelBody}
        </aside>
      ) : weatherOpen ? null : (
        /* Mobile draggable sheet — solid white so map content never shows through */
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 z-40 flex flex-col overflow-hidden rounded-t-3xl border border-neutral-200 border-b-0 bg-white shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
            !sheetDragging && "transition-[height] duration-200 ease-out",
          )}
          style={{ height: sheetHeight, maxHeight: "92svh" }}
          role="dialog"
          aria-label="Alerts sheet"
        >
          {/* Drag handle — pointer capture for smooth drag */}
          <div
            className="flex shrink-0 touch-none cursor-grab flex-col items-center bg-white px-3 pb-1 pt-2 active:cursor-grabbing"
            onPointerDown={onSheetHandlePointerDown}
            onPointerMove={onSheetHandlePointerMove}
            onPointerUp={onSheetHandlePointerUp}
            onPointerCancel={onSheetHandlePointerUp}
            aria-label="Drag sheet"
          >
            <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
            {sheetMode === "hidden" || sheetHeight <= sheetSnaps().hidden + 8 ? (
              <p className="pb-1 text-[13px] font-semibold text-neutral-700">
                Alerts in {weatherPlace}
                {mapItemCount > 0 ? ` · ${mapItemCount}` : ""}
              </p>
            ) : null}
          </div>

          {/* Content: opaque white so map never shows through; collapsed = no hit targets */}
          {(() => {
            const snaps = sheetSnaps()
            const contentVisible = sheetHeight > snaps.hidden + 14
            const showFull =
              selectedId != null ||
              selectedEmergencyId != null ||
              expandLoading ||
              sheetMode === "expanded" ||
              sheetHeight >= (snaps.peek + snaps.expanded) / 2
            const showDetail =
              selectedId != null || selectedEmergencyId != null || expandLoading
            return (
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col overflow-hidden bg-white",
                  !contentVisible && "pointer-events-none opacity-0",
                )}
              >
                {/* Filters always visible in preview + list (not on expanded detail) */}
                {!showDetail ? (
                  <div className="shrink-0 border-b border-neutral-100 bg-white px-3 pb-2 pt-0.5">
                    <button
                      type="button"
                      className="mb-2 w-full text-left"
                      onClick={() => snapSheetTo("expanded")}
                    >
                      <p className="text-[15px] font-bold text-neutral-900">
                        Alerts in {weatherPlace}
                      </p>
                      <p className="text-[12px] text-neutral-500">
                        {mapItemCount} on the map
                        {filteredEmergencies.length > 0
                          ? ` · ${filteredEmergencies.length} SOS`
                          : ""}
                        {!showFull ? " · Drag up or tap for all" : ""}
                      </p>
                    </button>
                    <CategoryFilterChips
                      chip={chip}
                      filterLoading={filterLoading}
                      onSelect={(key) => void applyChip(key)}
                    />
                  </div>
                ) : null}

                {!showFull ? (
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-3 pb-3 pt-2">
                    {filterLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8">
                        <LoaderCircleIcon className="size-7 animate-spin text-neutral-400" />
                        <p className="text-[13px] font-medium text-neutral-500">Loading…</p>
                      </div>
                    ) : nearestEmergency ? (
                      <EmergencyPreviewCard
                        emergency={nearestEmergency}
                        distance={distanceForEmergency(nearestEmergency)}
                        expanded={false}
                        onOpen={() => openEmergency(nearestEmergency.id)}
                      />
                    ) : nearestPreview ? (
                      <FeedPreviewCard
                        post={nearestPreview}
                        distance={distanceFor(nearestPreview)}
                        expanded={false}
                        onOpen={() => void openPost(nearestPreview.id, false)}
                        onWrite={() => void openPost(nearestPreview.id, true)}
                      />
                    ) : (
                      <p className="pb-3 text-center text-[13px] text-neutral-500">
                        {chip === "emergencies"
                          ? "No ongoing emergencies"
                          : "No alerts with a location"}
                      </p>
                    )}
                  </div>
                ) : showDetail ? (
                  <div className="h-full min-h-0 overflow-hidden bg-white">{panelBody}</div>
                ) : (
                  /* Expanded list: filters already shown above — list only */
                  <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2">
                    {filterLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14">
                        <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                        <p className="text-[13px] font-medium text-neutral-500">Loading…</p>
                      </div>
                    ) : listEmpty ? (
                      <div className="flex flex-col items-center px-4 py-10 text-center">
                        {chip === "emergencies" ? (
                          <AlertTriangleIcon className="mb-2 size-10 text-neutral-300" />
                        ) : (
                          <MapPinIcon className="mb-2 size-10 text-neutral-300" />
                        )}
                        <p className="text-[14px] font-semibold text-neutral-800">
                          {chip === "emergencies"
                            ? "No ongoing emergencies"
                            : "No feed posts on the map"}
                        </p>
                        <p className="mt-1 text-[12px] text-neutral-500">
                          {chip === "emergencies"
                            ? "Active SOS alerts will show here."
                            : "Community posts with a location appear here."}
                        </p>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {[...filteredEmergencies]
                          .sort(
                            (a, b) =>
                              (distanceForEmergency(a) ?? 1e9) -
                              (distanceForEmergency(b) ?? 1e9),
                          )
                          .map((em) => (
                            <li key={`em-${em.id}`}>
                              <EmergencyPreviewCard
                                emergency={em}
                                distance={distanceForEmergency(em)}
                                expanded={selectedEmergencyId === em.id}
                                onOpen={() => openEmergency(em.id)}
                              />
                            </li>
                          ))}
                        {[...filtered]
                          .sort(
                            (a, b) =>
                              (distanceFor(a) ?? 1e9) - (distanceFor(b) ?? 1e9),
                          )
                          .map((post) => (
                            <li key={post.id}>
                              <FeedPreviewCard
                                post={post}
                                distance={distanceFor(post)}
                                expanded={selectedId === post.id}
                                onOpen={() => void openPost(post.id, false)}
                                onWrite={() => void openPost(post.id, true)}
                              />
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function useMediaDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= RESIDENT_DESKTOP_MIN_PX : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${RESIDENT_DESKTOP_MIN_PX}px)`)
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return isDesktop
}
