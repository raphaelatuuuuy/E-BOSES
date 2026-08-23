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
  ChevronDownIcon,
  ChevronLeftIcon,
  CircleAlertIcon,
  HomeIcon,
  LeafIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MegaphoneIcon,
  MinusIcon,
  PersonStandingIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
} from "lucide-react"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
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
import { useBarangayWeather } from "@/features/dashboard/hooks/use-barangay-weather"
import { getConcernClassificationConfig } from "@/features/classification/api"
import {
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import {
  MapWeatherCard,
  MapWeatherIcon,
} from "@/features/dashboard/components/map-weather"
import { MapLegend, type MapLegendRow } from "@/features/dashboard/components/map/map-legend"
import { MapFilterChips } from "@/features/dashboard/components/map/filter-chips"
import { MAP_COLORS } from "@/features/dashboard/components/alerts-map/lib"
import {
  defaultResidentLayers,
  type ResidentMapLayers,
} from "@/features/dashboard/lib/resident-map-layers"
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
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"
import {
  readLastKnownPosition,
  writeLastKnownPosition,
} from "@/features/dashboard/lib/last-known-position"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

type ChipKey = "all" | "emergencies" | (string & {})
type CategoryChip = { key: string; label: string }

const BARANGAY = "Marikina Heights"

const MODE_CHIPS: CategoryChip[] = [
  { key: "all", label: "All" },
  { key: "posts", label: "Concerns" },
  { key: "announcements", label: "Announcements" },
  { key: "emergencies", label: "Emergencies" },
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

/* eslint-disable react-hooks/static-components -- resolveIconByKey returns a stable module-level Lucide component, never a new one */
function CategoryIcon({ category, iconKey, className }: { category: ConcernCategory; iconKey?: string; className?: string }) {
  const Resolved = resolveIconByKey(iconKey)
  if (Resolved) return <Resolved className={className} />
  if (category === "infrastructure") return <TrafficConeIcon className={className} />
  if (category === "environment") return <LeafIcon className={className} />
  if (category === "public_safety") return <ShieldCheckIcon className={className} />
  return <SearchIcon className={className} />
}
/* eslint-enable react-hooks/static-components */

function ResidentFilterRows({
  chip,
  categories,
  categoriesOpen,
  onToggleCategories,
  loading,
  onSelect,
}: {
  chip: string
  categories: CategoryChip[]
  categoriesOpen: boolean
  onToggleCategories: () => void
  loading: boolean
  onSelect: (key: string) => void
}) {
  const categoryActive = categories.some((c) => c.key === chip)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <MapFilterChips
          tone="light"
          chips={MODE_CHIPS}
          chip={chip}
          loading={loading}
          onSelect={onSelect}
          className="min-w-0 flex-1"
        />
        {categories.length > 0 ? (
          <button
            type="button"
            onClick={onToggleCategories}
            disabled={loading}
            aria-expanded={categoriesOpen}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors sm:text-[13px]",
              categoriesOpen || categoryActive
                ? "border-brand-orange bg-brand-orange text-white shadow-sm"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
              loading && "opacity-70",
            )}
          >
            Categories
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                categoriesOpen && "rotate-180",
              )}
              strokeWidth={2.25}
            />
          </button>
        ) : null}
      </div>
      {categoriesOpen && categories.length > 0 ? (
        <MapFilterChips
          tone="light"
          chips={categories}
          chip={chip}
          loading={loading}
          onSelect={onSelect}
          label="Category filters"
        />
      ) : null}
    </div>
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
          <span className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10",
            st.tone === "closed"
              ? "bg-neutral-100 text-neutral-500"
              : "bg-orange-50 text-orange-500",
          )}>
            <CategoryIcon category={post.category} iconKey={post.category_ref?.icon_key} className="size-5" />
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
              {st.tone === "closed" ? (
                <span className="inline-flex shrink-0 items-center text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                  {st.label}
                </span>
              ) : st.tone === "appealed" ? (
                <span className="shrink-0 text-[11px] font-semibold text-neutral-600 sm:text-[12px]">{st.label}</span>
              ) : null}
            </div>
            <p className="mt-0.5 flex items-center gap-x-1.5 text-[11px] text-neutral-500 sm:text-[12px]">
              <span className="text-neutral-500">
                {categoryLabel(post.category)}
              </span>
              <span aria-hidden>·</span>
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
  const ago = timeAgo(announcement.created_at)

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
            <p className="break-words text-[13px] font-bold leading-snug text-neutral-900 sm:text-[14px]">
              {announcement.title}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500 sm:text-[12px]">
              {[place, ago].filter(Boolean).join(" · ")}
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
  const mapApiRef = useRef<MapApi | null>(null)
  const isDesktop = useIsDesktop()
  /** Mobile sheet: full list, peek preview bar, or fully tucked while using the map */
  const {
    snaps: sheetSnaps,
    mode: sheetMode,
    height: sheetHeight,
    dragging: sheetDragging,
    snapTo: snapSheetTo,
    onHandlePointerDown: onSheetHandlePointerDown,
    onHandlePointerMove: onSheetHandlePointerMove,
    onHandlePointerUp: onSheetHandlePointerUp,
  } = useBottomSheetSnap({
    enabled: !isDesktop,
    initialHeight:
      typeof window !== "undefined" ? Math.round(Math.min(window.innerHeight * 0.55, 520)) : 420,
    onSettle: () => mapApiRef.current?.invalidateSize(),
  })
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [svPick, setSvPick] = useState(false)
  const [locating, setLocating] = useState(false)
  /** Officially-configured concern categories (filter chips), from the classification config. */
  const [filterCats, setFilterCats] = useState<CategoryChip[]>([])
  /** Category filter chips stay collapsed behind the "Categories" toggle. */
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  /** Desktop left alerts panel collapsed vs open. */
  const [alertsOpen, setAlertsOpen] = useState(true)
  /** Desktop alerts panel size — null until the resident drags the corner. */
  const [alertsPanelSize, setAlertsPanelSize] = useState<{ width: number; height: number } | null>(null)
  const alertsPanelRef = useRef<HTMLElement>(null)
  const [alertsPanelResizing, setAlertsPanelResizing] = useState(false)
  const alertsPanelResizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Epoch ms of the last stored GPS fix — shown under the user pin. */
  const [userKnownAt, setUserKnownAt] = useState<number | null>(() => {
    const stored = readLastKnownPosition(user?.id ?? null)
    return stored ? stored.at : null
  })

  // Desktop alerts panel: drag the bottom-right corner to resize. No visible
  // grip — just a hit zone in the corner with a resize cursor.
  useEffect(() => {
    if (!alertsPanelResizing) return
    function onMove(e: PointerEvent) {
      const start = alertsPanelResizeStartRef.current
      if (!start) return
      const maxWidth = Math.min(640, window.innerWidth - 32)
      const maxHeight = Math.min(window.innerHeight - 32, Math.round(window.innerHeight * 0.9))
      const width = Math.min(maxWidth, Math.max(280, start.w + (e.clientX - start.x)))
      const height = Math.min(maxHeight, Math.max(220, start.h + (e.clientY - start.y)))
      setAlertsPanelSize({ width, height })
    }
    function onUp() {
      setAlertsPanelResizing(false)
      alertsPanelResizeStartRef.current = null
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [alertsPanelResizing])

  function onAlertsPanelResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const rect = alertsPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    alertsPanelResizeStartRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height }
    setAlertsPanelResizing(true)
  }

  const collapseSheetForMap = useCallback(() => {
    if (isDesktop) return
    setWeatherOpen(false)
    snapSheetTo("hidden")
  }, [isDesktop, snapSheetTo])

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

  function toggleWeather() {
    void applyChip("all")
    setCategoriesOpen(false)
    setWeatherOpen((value) => !value)
  }

  const weatherToggle = (
    <button
      type="button"
      onClick={toggleWeather}
      aria-label={weatherOpen ? "Show the alerts list" : "Show the weather details"}
      aria-expanded={weatherOpen}
      title="Weather"
      className="flex shrink-0 items-center gap-1.5 text-[18px] font-bold leading-tight tracking-tight text-neutral-900 transition-opacity hover:opacity-70 sm:text-[20px]"
    >
      {weather.loading && weather.temperature == null ? (
        <LoaderCircleIcon className="size-5 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <MapWeatherIcon code={weather.code} className="size-5 shrink-0" />
      )}
      <span className="tabular-nums">
        {weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}
      </span>
    </button>
  )

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
    let reloadTimer: number | undefined
    let closed = false
    let attempts = 0
    const seen = new Set<string>()

    const scheduleReload = () => {
      if (reloadTimer != null) return
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined
        void load(true)
      }, 2500)
    }

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
              scheduleReload()
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
      if (reloadTimer != null) window.clearTimeout(reloadTimer)
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

  function toggleOrOpen(alreadySelected: boolean, open: () => void) {
    if (alreadySelected) {
      clearSelection()
      setAlertsOpen(false)
      if (!isDesktop) snapSheetTo("peek")
      return
    }
    open()
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
          <div className="flex shrink-0 items-center gap-2.5 bg-white px-4 pb-2 pt-3 sm:pt-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[20px]">
                {weatherOpen ? "Weather in" : "Alerts in"}{" "}
                <span className="text-brand-orange" style={{ color: "var(--color-brand-orange)" }}>
                  {weatherPlace}
                </span>
              </h1>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {weatherOpen
                  ? `As of ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : `${mapItemCount} on the map`}
              </p>
            </div>
            {weatherToggle}
          </div>

          <div className="relative shrink-0 px-3 pb-2 sm:pb-3">
            <ResidentFilterRows
              chip={weatherOpen ? "" : chip}
              categories={filterCats}
              categoriesOpen={categoriesOpen}
              onToggleCategories={() => setCategoriesOpen((value) => !value)}
              loading={filterLoading}
              onSelect={(key) => void applyChip(key)}
            />
          </div>

          <div
            className={cn(
              "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4",
              weatherOpen ? "px-4" : "px-3",
            )}
          >
            {weatherOpen ? (
              <MapWeatherCard weather={weather} framed={false} />
            ) : filterLoading ? (
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
                  .sort((a, b) => {
                    // Resolved/closed at the bottom
                    const aResolved = ["resolved", "closed", "cancelled"].includes(a.status)
                    const bResolved = ["resolved", "closed", "cancelled"].includes(b.status)
                    if (aResolved !== bResolved) return aResolved ? 1 : -1
                    return (distanceForEmergency(a) ?? 1e9) - (distanceForEmergency(b) ?? 1e9)
                  })
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
                  .sort((a, b) => {
                    // Resolved/rejected at the bottom
                    const aClosed = ["resolved", "rejected"].includes(a.status)
                    const bClosed = ["resolved", "rejected"].includes(b.status)
                    if (aClosed !== bClosed) return aClosed ? 1 : -1
                    return (distanceFor(a) ?? 1e9) - (distanceFor(b) ?? 1e9)
                  })
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
          policy={mapMeta.dispatch_policy}
          posts={filtered}
          emergencies={filteredEmergencies}
          announcements={visibleAnnouncements}
          selectedId={selectedId}
          selectedEmergencyId={selectedEmergencyId}
          selectedAnnouncementId={selectedAnnouncementId}
          userPos={userPos}
          userPosAt={userKnownAt}
          onSelect={(id) => {
            toggleOrOpen(selectedId === id, () => void openPost(id, false))
          }}
          onSelectEmergency={(id) => {
            toggleOrOpen(selectedEmergencyId === id, () => openEmergency(id))
          }}
          onSelectAnnouncement={(id) => {
            toggleOrOpen(selectedAnnouncementId === id, () => openAnnouncement(id, false))
          }}
          onMapInteract={collapseSheetForMap}
          onStreetViewPickChange={setSvPick}
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
          <MapControlButton
            tone="light"
            divider
            label={svPick ? "Cancel Street View pick" : "Drag me onto the map or click, then pick a spot for Street View"}
            active={svPick}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", "street-view")
              event.dataTransfer.effectAllowed = "copy"
              if (!svPick) mapApiRef.current?.toggleStreetViewPick()
            }}
            onClick={() => mapApiRef.current?.toggleStreetViewPick()}
          >
            <PersonStandingIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
        </MapControlStack>

        {svPick ? (
          <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] w-max max-w-[min(15rem,calc(100vw-1.5rem))] rounded-lg bg-nav-bg/90 px-2.5 py-1.5 text-[11.5px] font-semibold text-white/85 shadow-md backdrop-blur">
            Click the map to start Street View · Esc cancels
          </div>
        ) : null}
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

      {isDesktop ? (
        alertsOpen ? (
          <aside
            ref={alertsPanelRef}
            className="absolute left-4 top-4 z-20 flex w-[min(100%,380px)] max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)]"
            style={
              alertsPanelSize
                ? { width: alertsPanelSize.width, maxHeight: alertsPanelSize.height }
                : undefined
            }
          >
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
            {/* Corner resize hit zone — no visible grip by design. */}
            <div
              onPointerDown={onAlertsPanelResizeStart}
              className="absolute bottom-0 right-0 size-4 touch-none cursor-nwse-resize"
              aria-hidden
            />
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
      ) : (
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
                  <div className="shrink-0 bg-white px-3 pb-2 pt-0.5">
                    <div className="mb-2 flex items-center gap-2.5">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => snapSheetTo("expanded")}
                      >
                        <p className="text-[15px] font-bold text-neutral-900">
                          {weatherOpen ? "Weather in" : "Alerts in"}{" "}
                          <span className="text-brand-orange" style={{ color: "var(--color-brand-orange)" }}>
                            {weatherPlace}
                          </span>
                        </p>
                        <p className="text-[12px] text-neutral-500">
                          {weatherOpen
                            ? `As of ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                            : `${mapItemCount} on the map${filteredEmergencies.length > 0 ? ` · ${filteredEmergencies.length} SOS` : ""}${!showFull ? " · Drag up or tap for all" : ""}`}
                        </p>
                      </button>
                      {!isDesktop ? weatherToggle : null}
                    </div>
                    <ResidentFilterRows
                      chip={weatherOpen ? "" : chip}
                      categories={filterCats}
                      categoriesOpen={categoriesOpen}
                      onToggleCategories={() => setCategoriesOpen((value) => !value)}
                      loading={filterLoading}
                      onSelect={(key) => void applyChip(key)}
                    />
                  </div>
                ) : null}

                {!showFull ? (
                  <div
                    className={cn(
                      "scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white pb-3 pt-2",
                      weatherOpen ? "px-4" : "px-3",
                    )}
                  >
                    {weatherOpen ? (
                      <MapWeatherCard weather={weather} framed={false} />
                    ) : filterLoading ? (
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
                  <div
                    className={cn(
                      "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 pt-2",
                      weatherOpen ? "px-4" : "px-3",
                    )}
                  >
                    {weatherOpen ? (
                      <MapWeatherCard weather={weather} framed={false} />
                    ) : filterLoading ? (
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
