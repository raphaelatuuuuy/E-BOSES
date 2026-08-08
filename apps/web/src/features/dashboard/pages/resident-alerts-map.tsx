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
  type PublicUser,
  type ResidentAlertsMapSnapshot,
  type ResidentMapConcern,
  type ResidentMapEmergency,
} from "@/features/dashboard/api"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import {
  concernBodyText,
  streetLabelFromAddress,
} from "@/features/dashboard/components/feed-post-text"
import {
  EmergencyBanner,
  EmergencyDetailPanel,
  EmergencyPreviewCard,
} from "@/features/dashboard/components/resident-map/emergency-strip"
import {
  ResidentLeafletMap,
  type MapApi,
} from "@/features/dashboard/components/resident-map/resident-leaflet-map"
import { useBarangayWeather, type WeatherState } from "@/features/dashboard/hooks/use-barangay-weather"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  BARANGAY_CENTER,
  categoryMeta,
  formatDistance,
  haversineMeters,
  hasMapCoords,
  isLocalGps,
  mergeFeedWithMapCoords,
  timeAgo,
  validCoord,
} from "@/features/dashboard/lib/resident-map-utils"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

type ChipKey = "all" | "emergencies" | ConcernCategory

const BARANGAY = "Marikina Heights"

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

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "emergencies", label: "Emergencies" },
  { key: "public_safety", label: "Safety" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "environment", label: "Environment" },
  { key: "others", label: "Others" },
]

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
              ? "border-brand-orange bg-brand-orange text-white shadow-sm"
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
  const isDesktop = useIsDesktop()
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
    // load() sets loading synchronously, so defer the initial fetch a
    // macrotask to let the mount render settle (resumes are event-driven).
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
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
            const active = isEmergencyActive(emergency.status)
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
      <div className="relative h-full min-h-[60vh] w-full bg-canvas">
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
        "relative w-full overflow-hidden bg-canvas",
        isDesktop ? "h-[calc(100svh-3.5rem)]" : "h-[calc(100svh-5rem)]",
      )}
    >
      {mapMeta ? (
        <ResidentLeafletMap
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
      <EmergencyBanner emergencies={filteredEmergencies} selectedEmergency={selectedEmergency} />

      {error ? (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm rounded-2xl border border-red-200 bg-white p-4 text-center shadow-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button
            type="button"
            className="mt-3 rounded-full bg-brand-navy px-4 py-2 text-sm font-bold text-white"
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