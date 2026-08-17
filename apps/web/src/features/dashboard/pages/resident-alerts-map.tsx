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
  CircleAlertIcon,
  CircleCheck,
  CloudRainIcon,
  CloudSunIcon,
  DropletsIcon,
  HomeIcon,
  LeafIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MegaphoneIcon,
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
  listAnnouncements,
  listFeedConcerns,
  updateConcernComment,
  voteConcern,
  type Announcement,
  type Concern,
  type ConcernCategory,
  type PublicUser,
  type ResidentAlertsMapSnapshot,
  type ResidentMapConcern,
  type ResidentMapEmergency,
} from "@/features/dashboard/api"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import {
  categoryLabel,
  concernBodyText,
  streetLabelFromAddress,
} from "@/features/dashboard/components/feed-post-text"
import { advisoryMeta } from "@/features/dashboard/components/community-content/advisory-tags"
import { AnnouncementComments } from "@/features/dashboard/components/home/announcement-comments"
import {
  EmergencyDetailPanel,
  EmergencyPreviewCard,
} from "@/features/dashboard/components/resident-map/emergency-strip"
import {
  ResidentLeafletMap,

  type MapApi,
} from "@/features/dashboard/components/resident-map/resident-leaflet-map"
import { useBarangayWeather, type WeatherState } from "@/features/dashboard/hooks/use-barangay-weather"
import { getConcernClassificationConfig } from "@/features/classification/api"
import {
  MapChip,
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import { MapLegend, type MapLegendRow } from "@/features/dashboard/components/map/map-legend"
import { MAP_COLORS } from "@/features/dashboard/components/alerts-map/lib"
import {
  defaultResidentLayers,
  type ResidentMapLayers,
} from "@/features/dashboard/lib/resident-map-layers"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  BARANGAY_CENTER,
  formatDistance,
  haversineMeters,
  hasMapCoords,
  isLocalGps,
  mergeFeedWithMapCoords,
  validCoord,
} from "@/features/dashboard/lib/resident-map-utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  readLastKnownPosition,
  writeLastKnownPosition,
} from "@/features/dashboard/lib/last-known-position"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

type ChipKey = "all" | "emergencies" | (string & {})
type CategoryChip = { key: string; label: string }

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

/** A static filter chip (All / Emergencies) plus the categories configured by officials. */
function CategoryFilterChips({
  chips,
  chip,
  filterLoading,
  onSelect,
  className,
}: {
  chips: CategoryChip[]
  chip: ChipKey
  filterLoading: boolean
  onSelect: (key: ChipKey) => void
  className?: string
}) {
  const scrollerRef = useWheelScroll<HTMLDivElement>()
  return (
    <div
      ref={scrollerRef}
      className={cn(
        "scrollbar-hide flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]",
        className,
      )}
      style={{ touchAction: "pan-x" }}
      role="tablist"
      aria-label="Categories"
    >
      {chips.map((c) => (
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
              <WeatherIcon code={day.code} className="size-5 text-neutral-500" />
              <span className="font-bold text-neutral-800">
                {Math.round(day.high)}°{" "}
                <span className="font-medium text-neutral-400">{Math.round(day.low)}°</span>
              </span>
              <span className="text-right text-neutral-600">{day.rain}%</span>
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
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 sm:size-10">
            <CategoryIcon category={post.category} className="size-5" />
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
              <span className="shrink-0 text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                {categoryLabel(post.category)}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-x-1.5 text-[11px] text-neutral-500 sm:text-[12px]">
              {st.tone === "closed" ? (
                <>
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-status-closed">
                    <CircleCheck className="size-3.5 shrink-0" strokeWidth={2.4} />
                    {st.label}
                  </span>
                  <span aria-hidden>·</span>
                </>
              ) : st.tone === "appealed" ? (
                <>
                  <span className="shrink-0 font-semibold text-neutral-600">{st.label}</span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <span>{[dist, ago].filter(Boolean).join(" · ")}</span>
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

/**
 * Compact announcement card for the alerts list.
 *
 * Same header, same meta format and same neutral icon well as the feed
 * carousel, so one announcement does not read as two different objects
 * depending on where it is seen. No urgency badge and no street chips: the
 * source, the date and the streets are one plain line.
 */
function AnnouncementListItem({
  announcement,
  expanded,
  onOpen,
  onWrite,
}: {
  announcement: Announcement
  expanded: boolean
  onOpen: () => void
  onWrite: () => void
}) {
  const TagIcon = advisoryMeta(announcement.tag).icon
  const place =
    announcement.place_label ||
    (announcement.affected_streets?.length ? announcement.affected_streets.join(" · ") : "")

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded ? "border-neutral-300 bg-neutral-50 shadow-sm" : "border-neutral-200",
      )}
    >
      <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-left sm:px-3.5">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 sm:size-10">
            <TagIcon className="size-4 sm:size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-[11px] font-semibold text-neutral-500 sm:text-[12px]">Barangay Hall</p>
            <p className="mt-0.5 text-[11px] text-neutral-500 sm:text-[12px]">
              {[announcement.date_label, place].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 break-words text-[13px] font-bold leading-snug text-neutral-900 sm:text-[14px]">
              {announcement.title}
            </p>
            {announcement.body ? (
              <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
                {announcement.body}
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

/** Expanded advisory in the left panel — full body, image, and its comments. */
function AnnouncementDetailPanel({
  announcement,
  onBack,
  focusComment,
}: {
  announcement: Announcement
  onBack: () => void
  focusComment: boolean
}) {
  const TagIcon = advisoryMeta(announcement.tag).icon
  const place =
    announcement.place_label ||
    (announcement.affected_streets?.length ? announcement.affected_streets.join(" · ") : "")

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
          Announcement
        </p>
      </div>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
            <TagIcon className="size-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-neutral-900">Barangay Hall</p>
            <p className="mt-0.5 text-meta text-neutral-500">
              {[announcement.date_label, place].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <h2 className="mt-5 break-words text-section text-neutral-900">{announcement.title}</h2>

        {announcement.image_url ? (
          <img
            src={announcement.image_url}
            alt={announcement.image_alt || ""}
            className="mt-4 w-full rounded-2xl object-cover"
          />
        ) : null}

        {announcement.body ? (
          <p className="mt-4 whitespace-pre-wrap break-words text-read leading-relaxed text-neutral-800">
            {announcement.body}
          </p>
        ) : null}

        <div className="mt-6">
          <AnnouncementComments
            announcementId={announcement.id}
            autoFocusComposer={focusComment}
          />
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
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
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
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<number | null>(null)
  const [expandedPost, setExpandedPost] = useState<Concern | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)
  const [focusComment, setFocusComment] = useState(false)
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(() => {
    const stored = readLastKnownPosition(user?.id ?? null)
    if (!stored) return null
    const seed = { lat: stored.latitude, lng: stored.longitude }
    return isLocalGps(seed) ? seed : null
  })
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
  /** Officially-configured concern categories (filter chips), from the classification config. */
  const [filterCats, setFilterCats] = useState<CategoryChip[]>([])
  /** Desktop left alerts panel collapsed vs open. */
  const [alertsOpen, setAlertsOpen] = useState(true)
  /** Epoch ms of the last stored GPS fix — shown under the user pin. */
  const [userKnownAt, setUserKnownAt] = useState<number | null>(() => {
    const stored = readLastKnownPosition(user?.id ?? null)
    return stored ? stored.at : null
  })

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

  // Filter chips come from the classification config officials maintain, not a hardcoded list
  useEffect(() => {
    let mounted = true
    getConcernClassificationConfig()
      .then((config) => {
        if (!mounted) return
        setFilterCats(
          (config.categories ?? [])
            .filter((c) => c.enabled)
            .map((c) => ({ key: c.key, label: c.label })),
        )
      })
      .catch(() => {
        /* keep the static All / Emergencies chips if the config fetch fails */
      })
    return () => {
      mounted = false
    }
  }, [])

  const chips = useMemo<CategoryChip[]>(
    () => [
      { key: "all", label: "All" },
      { key: "posts", label: "Concerns" },
      { key: "announcements", label: "Announcements" },
      { key: "emergencies", label: "Emergencies" },
      ...filterCats,
    ],
    [filterCats],
  )

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
      const announcementsPromise = listAnnouncements().catch(() => [] as Announcement[])

      const [mapSnap, feed, nextAnnouncements] = await Promise.all([
        mapSnapPromise,
        feedPromise,
        announcementsPromise,
      ])
      const withPins = mergeFeedWithMapCoords(feed, mapSnap?.concerns)
      setPosts(withPins)
      // Keep every published advisory: the list shows them all, and the map
      // skips the ones without a drawn area (the map already guards on
      // `area_geometry`), so a barangay-wide notice still belongs in the feed.
      setAnnouncements(nextAnnouncements.filter((item) => item.is_published))
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
        if (isLocalGps(next)) {
          writeLastKnownPosition(pos, user?.id ?? null)
          setUserPos(next)
          setUserKnownAt(pos.timestamp || Date.now())
        } else {
          setUserPos(null)
        }
      },
      // Keep whatever was seeded from the last stored fix; dropping the pin
      // on a failed read is what made distances fall back to barangay centre.
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [user?.id])

  // Distance origin: local GPS when near MH, else barangay center (never far-away device GPS)
  const origin = useMemo(() => {
    if (userPos && isLocalGps(userPos)) return userPos
    if (mapMeta?.center) {
      return { lat: mapMeta.center.latitude, lng: mapMeta.center.longitude }
    }
    return { ...BARANGAY_CENTER }
  }, [userPos, mapMeta])

  const [layers, setLayers] = useState<ResidentMapLayers>(defaultResidentLayers)

  const filtered = useMemo(() => {
    if (!layers.concerns) return [] as Concern[]
    if (chip === "emergencies" || chip === "announcements") return [] as Concern[]
    const base =
      chip === "all" || chip === "posts" ? posts : posts.filter((p) => p.category === chip)
    // Drop posts with invalid / out-of-area coordinates (no random far pins)
    return base.filter((p) => hasMapCoords(p))
  }, [posts, chip, layers.concerns])

  const filteredEmergencies = useMemo(() => {
    if (!layers.emergencies) return [] as ResidentMapEmergency[]
    if (chip !== "all" && chip !== "emergencies") return [] as ResidentMapEmergency[]
    return emergencies
  }, [emergencies, chip, layers.emergencies])

  // Advisories show under the default view and the dedicated Announcements
  // chip — the Emergencies / Posts / category chips are about reports, so a
  // water-outage notice should not leak into those.
  const visibleAnnouncements = useMemo(
    () =>
      layers.advisories && (chip === "all" || chip === "announcements")
        ? announcements
        : ([] as Announcement[]),
    [chip, announcements, layers.advisories],
  )

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

  function openAnnouncement(id: number, write = false) {
    setSelectedId(null)
    setExpandedPost(null)
    setSelectedEmergencyId(null)
    setSelectedAnnouncementId(id)
    setFocusComment(write)
    setWeatherOpen(false)
    setAlertsOpen(true)
    if (!isDesktop) snapSheetTo("expanded")
  }

  async function openPost(id: number, write = false) {
    setSelectedEmergencyId(null)
    setSelectedAnnouncementId(null)
    setSelectedId(id)
    setWeatherOpen(false)
    setAlertsOpen(true)
    snapSheetTo("expanded")
    setFocusComment(write)
    setExpandLoading(true)
    try {
      // The feed endpoint masks the incident address to the barangay for
      // privacy; the map snapshot keeps the full street. Preserve it so the
      // panel shows where the report is.
      const streetAddress = posts.find((p) => p.id === id)?.address || null
      // Reload full feed post (comments, votes, media) into the left panel
      const full = await getConcern(id)
      const detailed = streetAddress ? { ...full, address: streetAddress } : full
      setExpandedPost(detailed)
      // Keep list in sync with lightweight fields
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...detailed } : p)))
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
    setSelectedAnnouncementId(null)
  }

  function closePost() {
    clearSelection()
    if (!isDesktop) snapSheetTo("peek")
  }

  function openEmergency(id: number, write = false) {
    setSelectedId(null)
    setExpandedPost(null)
    setFocusComment(write)
    setSelectedAnnouncementId(null)
    setSelectedEmergencyId(id)
    setWeatherOpen(false)
    setAlertsOpen(true)
    if (!isDesktop) snapSheetTo("expanded")
  }

  const selectedAnnouncement =
    selectedAnnouncementId != null
      ? (announcements.find((item) => item.id === selectedAnnouncementId) ?? null)
      : null

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
        setUserKnownAt(pos.timestamp || Date.now())
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

  const nearestAnnouncement = useMemo(() => {
    if (visibleAnnouncements.length === 0) return null
    return visibleAnnouncements[0]
  }, [visibleAnnouncements])

  // Announcements carry map areas too, so they count toward the badge and the
  // mobile sheet's "N on the map" summary.
  const mapItemCount =
    filtered.length + filteredEmergencies.length + visibleAnnouncements.length

  const legendRows: MapLegendRow<keyof ResidentMapLayers>[] = [
    {
      key: "emergencies",
      label: "Ongoing emergencies",
      hint: "Live incidents responders are handling",
      count: emergencies.length,
      tone: MAP_COLORS.emergency,
    },
    {
      key: "concerns",
      label: "Community reports",
      hint: "Concerns neighbours have filed",
      count: posts.filter((post) => hasMapCoords(post)).length,
      tone: MAP_COLORS.concern,
    },
    {
      key: "advisories",
      label: "Advisory areas",
      hint: "Streets, areas and barangay-wide notices",
      count: announcements.length,
      tone: MAP_COLORS.advisory,
    },
  ]

  if (loading && posts.length === 0 && emergencies.length === 0) {
    return (
      <div className="relative h-full min-h-[60svh] w-full flex-1 bg-canvas">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    )
  }

  const listEmpty =
    filtered.length === 0 &&
    filteredEmergencies.length === 0 &&
    visibleAnnouncements.length === 0 &&
    !filterLoading

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      {selectedEmergency ? (
        <EmergencyDetailPanel
          emergency={selectedEmergency}
          distance={distanceForEmergency(selectedEmergency)}
          onBack={closePost}
          focusComment={focusComment}
        />
      ) : selectedAnnouncement ? (
        <AnnouncementDetailPanel
          announcement={selectedAnnouncement}
          onBack={closePost}
          focusComment={focusComment}
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
            <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
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
              chips={chips}
              chip={chip}
              filterLoading={filterLoading}
              onSelect={(key) => void applyChip(key)}
            />
          </div>

          <div className="scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
            {filterLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 sm:py-16">
                <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                <p className="text-[13px] font-medium text-neutral-500">Loading…</p>
              </div>
            ) : listEmpty ? (
              <EmptyState
                icon={
                  chip === "emergencies" ? (
                    <AlertTriangleIcon className="size-10" />
                  ) : chip === "announcements" ? (
                    <MegaphoneIcon className="size-10" />
                  ) : (
                    <MapPinIcon className="size-10" />
                  )
                }
                title={
                  chip === "emergencies"
                    ? "No ongoing emergencies"
                    : chip === "announcements"
                      ? "No announcements yet"
                      : "No concerns on the map"
                }
                body={
                  chip === "emergencies"
                    ? "Active SOS alerts in Marikina Heights will show here."
                    : chip === "announcements"
                      ? "Official barangay advisories will appear here."
                      : "Concerns with a location appear here."
                }
              />
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
                        onWrite={() => openEmergency(em.id, true)}
                      />
                    </li>
                  ))}
                {/* Official advisories under All and the Announcements filter */}
                {visibleAnnouncements.map((announcement) => (
                  <li key={`ann-${announcement.id}`}>
                    <AnnouncementListItem
                      announcement={announcement}
                      expanded={selectedAnnouncementId === announcement.id}
                      onOpen={() => openAnnouncement(announcement.id, false)}
                      onWrite={() => openAnnouncement(announcement.id, true)}
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
        // Full-bleed route: no shell header and no bottom nav are rendered, so
        // the map owns the whole viewport. The old `calc(100svh - Xrem)`
        // offsets left a dead strip at the bottom and the sheet's `bottom-0`
        // stopped short of the screen floor.
        isDesktop ? "h-full" : "h-svh",
      )}
    >
      {mapMeta ? (
        <ResidentLeafletMap
          center={mapMeta.center}
          boundary={mapMeta.boundary}
          posts={filtered}
          emergencies={filteredEmergencies}
          announcements={visibleAnnouncements}
          selectedId={selectedId}
          selectedEmergencyId={selectedEmergencyId}
          selectedAnnouncementId={selectedAnnouncementId}
          userPos={userPos}
          userPosAt={userKnownAt}
          onSelect={(id) => {
            void openPost(id, false)
          }}
          onSelectEmergency={(id) => openEmergency(id)}
          onSelectAnnouncement={(id) => openAnnouncement(id, false)}
          onMapInteract={collapseSheetForMap}
          onReady={(api) => {
            mapApiRef.current = api
          }}
        />
      ) : null}

      {error ? (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm rounded-2xl border border-sos/30 bg-white p-4 text-center shadow-xl">
          <p className="text-sm font-semibold text-sos">{error}</p>
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

      {/* One control column, same order and geometry as the official map:
          Home, Locate, Zoom, then weather. */}
      <div
        ref={isDesktop ? weatherPanelRef : undefined}
        className={cn(
          "absolute z-30 flex flex-col items-end gap-2",
          isDesktop ? "right-4 top-4" : "right-3 top-3",
        )}
      >
        <MapControlStack tone="light">
          <MapControlButton tone="light" label="Frame the barangay" onClick={goHomeOnMap}>
            <HomeIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label="Current location"
            onClick={goMyLocation}
            loading={locating}
          >
            <MapPinIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label="Zoom in"
            onClick={() => mapApiRef.current?.zoomIn()}
          >
            <PlusIcon className="size-5" strokeWidth={2.1} />
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            label="Zoom out"
            onClick={() => mapApiRef.current?.zoomOut()}
          >
            <MinusIcon className="size-5" strokeWidth={2.1} />
          </MapControlButton>
        </MapControlStack>

        <div className="relative flex flex-col items-end">
          <MapChip
            tone="light"
            label="Weather"
            expanded={weatherOpen}
            onClick={() => {
              setWeatherOpen((value) => !value)
              if (!isDesktop) snapSheetTo("hidden")
            }}
          >
            {weather.loading ? (
              <LoaderCircleIcon className="size-4 animate-spin text-neutral-400" />
            ) : (
              <WeatherIcon code={weather.code} className="size-5 text-neutral-500" />
            )}
            <span>
              {weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}
            </span>
          </MapChip>

          {/* Desktop: popover under weather chip — closes on outside click / Escape */}
          {weatherOpen && isDesktop ? (
            <section className="scrollbar-hide absolute right-0 top-[calc(100%+0.5rem)] z-40 max-h-[min(70svh,520px)] w-[min(calc(100vw-1.5rem),340px)] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-lg">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold">{weather.placeName}</h2>
                  <p className="mt-0.5 text-[13px] text-neutral-500">Current weather</p>
                </div>
                {weather.loading ? (
                  <LoaderCircleIcon className="size-7 shrink-0 animate-spin text-neutral-400" />
                ) : (
                  <WeatherIcon code={weather.code} className="size-8 shrink-0 text-neutral-500" />
                )}
              </div>
              <WeatherDetails weather={weather} />
            </section>
          ) : null}
        </div>
      </div>

      {/* Below the map, clear of the control column, so the legend never covers
          the barangay. Collapsed it is one icon. */}
      {mapMeta ? (
        <div
          className={cn(
            "absolute z-30 flex flex-col items-end",
            isDesktop ? "bottom-4 right-4" : "bottom-[calc(56px+0.75rem)] right-3",
          )}
        >
          <MapLegend
            tone="light"
            rows={legendRows}
            active={layers}
            onToggle={(key) => setLayers((current) => ({ ...current, [key]: !current[key] }))}
          />
        </div>
      ) : null}

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
            className="scrollbar-hide absolute bottom-0 left-0 right-0 z-40 max-h-[min(78svh,640px)] overflow-y-auto overscroll-contain rounded-t-3xl border border-neutral-200 border-b-0 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-neutral-900 shadow-[0_-12px_40px_rgba(15,23,42,.14)]"
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
                  <WeatherIcon code={weather.code} className="size-5 text-neutral-500" />
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
                          className="size-5 text-neutral-500"
                        />
                        <span className="font-semibold text-neutral-900">
                          {Math.round(day.high)}°
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-neutral-600">
                          <WindIcon className="size-3.5 shrink-0 text-neutral-400" />
                          {Math.round(day.low)}°
                        </span>
                        <span className="inline-flex items-center justify-end gap-0.5 font-semibold text-neutral-600">
                          <DropletsIcon className="size-3.5 shrink-0" />
                          {day.rain}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            {/* Bottom fade — signals there's more below without a scrollbar.
                Sticky (not absolute) so it stays pinned to the sheet's bottom
                edge while the content scrolls under it. */}
            <div
              aria-hidden
              className="pointer-events-none sticky bottom-0 -mt-12 h-12 shrink-0 bg-gradient-to-t from-white via-white/70 to-transparent"
            />
          </section>
        </>
      ) : null}

      {isDesktop ? (
        alertsOpen ? (
          <aside className="absolute left-4 top-4 z-20 flex w-[min(100%,380px)] max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)]">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-100 px-3">
              <CircleAlertIcon className="size-5 shrink-0 text-neutral-800" strokeWidth={2.25} />
              <button
                type="button"
                onClick={() => setAlertsOpen(false)}
                className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                aria-label="Collapse alerts"
                title="Collapse alerts"
              >
                <ChevronLeftIcon className="size-4" strokeWidth={2.25} />
              </button>
            </div>
            {panelBody}
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setAlertsOpen(true)}
            className="absolute left-4 top-4 z-20 flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md"
            aria-label="Open alerts"
            title="Open alerts"
          >
            <CircleAlertIcon className="size-5 shrink-0 text-neutral-800" strokeWidth={2.25} />
          </button>
        )
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
                      chips={chips}
                      chip={chip}
                      filterLoading={filterLoading}
                      onSelect={(key) => void applyChip(key)}
                    />
                  </div>
                ) : null}

                {!showFull ? (
                  <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-3 pb-3 pt-2">
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
                    ) : nearestAnnouncement ? (
                      <AnnouncementListItem
                        announcement={nearestAnnouncement}
                        expanded={false}
                        onOpen={() => openAnnouncement(nearestAnnouncement.id, false)}
                        onWrite={() => openAnnouncement(nearestAnnouncement.id, true)}
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
                          : chip === "announcements"
                            ? "No announcements yet"
                            : "No alerts with a location"}
                      </p>
                    )}
                  </div>
                ) : showDetail ? (
                  <div className="h-full min-h-0 overflow-hidden bg-white">{panelBody}</div>
                ) : (
                  /* Expanded list: filters already shown above — list only */
                  <div className="scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2">
                    {filterLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14">
                        <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                        <p className="text-[13px] font-medium text-neutral-500">Loading…</p>
                      </div>
                    ) : listEmpty ? (
                      <EmptyState
                        icon={
                          chip === "emergencies" ? (
                            <AlertTriangleIcon className="size-10" />
                          ) : chip === "announcements" ? (
                            <MegaphoneIcon className="size-10" />
                          ) : (
                            <MapPinIcon className="size-10" />
                          )
                        }
                        title={
                          chip === "emergencies"
                            ? "No ongoing emergencies"
                            : chip === "announcements"
                              ? "No announcements yet"
                              : "No concerns on the map"
                        }
                        body={
                          chip === "emergencies"
                            ? "Active SOS alerts in Marikina Heights will show here."
                            : chip === "announcements"
                              ? "Official barangay advisories will appear here."
                              : "Concerns with a location appear here."
                        }
                      />
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
                        {/* Official advisories under All and the Announcements filter */}
                        {visibleAnnouncements.map((announcement) => (
                          <li key={`ann-${announcement.id}`}>
                            <AnnouncementListItem
                              announcement={announcement}
                              expanded={selectedAnnouncementId === announcement.id}
                              onOpen={() => openAnnouncement(announcement.id, false)}
                              onWrite={() => openAnnouncement(announcement.id, true)}
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