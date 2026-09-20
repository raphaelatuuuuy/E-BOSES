/**
 * Resident Alerts Map — Nextdoor structure, feed-backed:
 * - Map pins = community feed posts that have coordinates
 * - List = compact preview (+ “View the concern”)
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
  Check,
  ChevronLeftIcon,
  CircleAlertIcon,
  HomeIcon,
  LeafIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MapPinIcon,
  MegaphoneIcon,
  SearchIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { isResponderUser } from "@/features/auth/roles"
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
  concernBodyText,
  concernTitleText,
  streetLabelFromAddress,
} from "@/features/dashboard/components/feed-post-text"
import {
  advisoryLabel,
  advisoryMeta,
} from "@/features/dashboard/components/community-content/advisory-tags"
import { AnnouncementComments } from "@/features/dashboard/components/home/announcement-comments"
import { AnnouncementSummary } from "@/features/dashboard/components/home/announcement-summary"
import {
  announcementSummary,
  announcementTitle,
  formatAnnouncementDateTime,
} from "@/features/dashboard/lib/announcement-summary"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import {
  EmergencyDetailPanel,
  EmergencyPreviewCard,
} from "@/features/dashboard/components/resident-map/emergency-strip"
import { AlertsSearchRow } from "@/features/dashboard/components/alerts-map/alerts-search-row"
import {
  ResidentLeafletMap,
  type MapApi,
} from "@/features/dashboard/components/resident-map/resident-leaflet-map"
import { useBarangayWeather } from "@/features/dashboard/hooks/use-barangay-weather"
import {
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import {
  MapWeatherCard,
  MapWeatherIcon,
} from "@/features/dashboard/components/map-weather"
import { defaultResidentLayers } from "@/features/dashboard/lib/resident-map-layers"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  NETWORK_FALLBACK_CENTER,
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

type ChipKey = "all" | (string & {})
const BARANGAY = "Community"

/**
 * Map badge labels — same groups as My reports filters
 * (Active / Resolved / Rejected / Appealed).
 */
function statusLabel(status: string): {
  label: string
  tone: "active" | "closed" | "appealed"
} {
  if (status === "resolved" || status === "partially_resolved")
    return { label: "Resolved", tone: "closed" }
  if (status === "rejected") return { label: "Rejected", tone: "closed" }
  if (status === "appealed") return { label: "Appealed", tone: "appealed" }
  // submitted | under_review | assigned | in_progress
  return { label: "Active", tone: "active" }
}

/** Keep the resident list ordered by severity without rendering the priority.
 * Residents see the same urgent concerns first, but not the internal band label.
 */
function concernPriorityRank(concern: Pick<Concern, "severity">) {
  switch ((concern.severity || "").toLowerCase()) {
    case "critical":
      return 3
    case "high":
      return 2
    case "moderate":
    case "medium":
      return 1
    default:
      return 0
  }
}

function priorityVisual(value?: string | null) {
  const severity = (value || "").toLowerCase()
  if (!(severity in { critical: true, high: true, moderate: true, low: true }))
    return null
  const icon = {
    critical: TriangleAlertIcon,
    high: SignalHighIcon,
    moderate: SignalMediumIcon,
    low: SignalLowIcon,
  }[severity as "critical" | "high" | "moderate" | "low"]
  const tone = {
    critical: "text-severity-critical-map-ink",
    high: "text-severity-high-ink",
    moderate: "text-severity-moderate-ink",
    low: "text-severity-low-ink",
  }[severity as "critical" | "high" | "moderate" | "low"]
  return {
    label: `${severity.charAt(0).toUpperCase() + severity.slice(1)} priority`,
    icon,
    tone,
  }
}

/* eslint-disable react-hooks/static-components -- resolveIconByKey returns a stable module-level Lucide component, never a new one */
function CategoryIcon({
  category,
  iconKey,
  className,
}: {
  category: ConcernCategory
  iconKey?: string
  className?: string
}) {
  const Resolved = resolveIconByKey(iconKey)
  if (Resolved) return <Resolved className={className} />
  if (category === "infrastructure")
    return <TrafficConeIcon className={className} />
  if (category === "environment") return <LeafIcon className={className} />
  if (category === "public_safety")
    return <ShieldCheckIcon className={className} />
  return <SearchIcon className={className} />
}
/* eslint-enable react-hooks/static-components */

/** Compact list preview (Nextdoor first part) — category icon, not media image */
function FeedPreviewCard({
  post,
  distance,
  expanded,
  onOpen,
  onWrite,
  showPriority = false,
  actionLabel = "View the concern",
}: {
  post: Concern
  distance: number | null
  expanded: boolean
  onOpen: () => void
  onWrite: () => void
  showPriority?: boolean
  actionLabel?: string
}) {
  const st = statusLabel(post.status)
  const dist = formatDistance(distance)
  const ago = timeAgo(post.created_at)
  const street =
    streetSegment(post.address) ||
    streetLabelFromAddress(post.address) ||
    post.community.name
  const body = concernBodyText(post).replace(/\s+/g, " ").trim()
  const title = concernTitleText(post).replace(/\s+/g, " ").trim() || "Report"
  const critical = (post.severity ?? "").toLowerCase() === "critical"
  const summary = post.summary?.replace(/\s+/g, " ").trim() || ""
  const normalise = (value: string) =>
    value
      .replace(/[“”‘’"']/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  // A generated summary can be identical to the submitted auto-title/body.
  // Keep one readable line in the preview instead of printing the same report
  // twice; the full feed detail still contains both when they differ.
  const snippet =
    (summary &&
    normalise(summary) !== normalise(title) &&
    normalise(summary) !== normalise(body)
      ? summary
      : "") || (normalise(body) !== normalise(title) ? body : "")
  const snippetLabel = summary ? "" : snippet ? "Report description" : ""
  const priority = showPriority ? priorityVisual(post.severity ?? null) : null
  const PriorityIcon = priority?.icon

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded
          ? "border-neutral-300 bg-status-closed-surface shadow-sm"
          : "border-neutral-200"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-[13px] leading-snug font-bold break-words text-neutral-900 sm:text-[14px]">
              {critical ? (
                <TriangleAlertIcon
                  className="mr-1.5 inline size-[18px] align-[-3px] text-sos"
                  strokeWidth={2.2}
                />
              ) : st.tone === "closed" ? (
                <Check
                  className="mr-1.5 inline size-[18px] align-[-3px] text-emerald-600"
                  strokeWidth={2.5}
                />
              ) : (
                <CategoryIcon
                  category={post.category}
                  iconKey={post.category_ref?.icon_key}
                  className="mr-1.5 inline size-[18px] align-[-3px] text-brand-orange"
                />
              )}
              {title || "Report"}
            </p>
            {st.tone === "appealed" ? (
              <span className="shrink-0 text-[11px] font-semibold text-neutral-600 sm:text-[12px]">
                {st.label}
              </span>
            ) : priority && PriorityIcon ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold sm:text-[12px]",
                  priority.tone
                )}
                title={priority.label}
              >
                <PriorityIcon className="size-3.5 shrink-0" strokeWidth={2} />
                {priority.label}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 flex items-center gap-x-1.5 text-[11px] text-neutral-500 sm:text-[12px]">
            <span>{street}</span>
            <span aria-hidden>·</span>
            <span>{[dist, ago].filter(Boolean).join(" · ")}</span>
          </p>
          {snippet ? (
            <div className="mt-1.5">
              {snippetLabel ? (
                <p className="mb-0.5 text-[10px] font-bold tracking-[0.06em] text-neutral-400 uppercase">
                  {snippetLabel}
                </p>
              ) : null}
              <p className="text-[12px] leading-snug break-words whitespace-pre-wrap text-neutral-600 sm:text-[13px]">
                {snippet}
              </p>
            </div>
          ) : null}
        </div>
      </button>

      <div className="border-t border-neutral-100 px-3 py-2 text-center sm:px-3.5 sm:py-2.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onWrite()
          }}
          className="flex h-9 w-full items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 sm:text-[13px]"
        >
          {actionLabel}
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
 * source, date, and raw body stay close to the announcement title.
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

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded
          ? "border-neutral-300 bg-status-closed-surface shadow-sm"
          : "border-neutral-200"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="mt-0.5 text-[13px] leading-snug font-bold break-words text-neutral-900 sm:text-[14px]">
            <TagIcon
              className="mr-1.5 inline size-[18px] align-[-3px] text-severity-low"
              strokeWidth={2}
              aria-hidden
            />
            {announcementTitle(announcement)}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500 sm:text-[12px]">
            {advisoryLabel(announcement.tag)} ·{" "}
            {timeAgo(announcement.updated_at)}
          </p>
          <p className="mt-1.5 text-[12px] leading-snug break-words whitespace-pre-wrap text-neutral-600 sm:text-[13px]">
            {announcementSummary(announcement)}
          </p>
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
          View the advisory
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
  const [commentsOpen, setCommentsOpen] = useState(true)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
          aria-label="Back to list"
        >
          <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
        </button>
        <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
          Advisory
        </p>
      </div>

      <div
        className={`scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${commentsOpen ? "pb-6" : "pb-0"}`}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-severity-low-surface text-severity-low">
            <TagIcon className="size-6" strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="mt-0.5 text-[15px] font-semibold break-words text-neutral-900">
              {announcement.title}
            </p>
          </div>
        </div>

        {announcement.image_url ? (
          <img
            src={announcement.image_url}
            alt={announcement.image_alt || ""}
            className="mt-4 w-full rounded-2xl object-cover"
          />
        ) : null}

        {announcement.body ? (
          <div className="mt-4 space-y-1">
            <p className="text-meta text-neutral-500">
              Posted on {formatAnnouncementDateTime(announcement)}
            </p>
            <p className="text-[16px] leading-relaxed break-words whitespace-pre-wrap text-neutral-800">
              {announcement.body}
            </p>
          </div>
        ) : null}

        <AnnouncementSummary announcement={announcement} className="mt-2" />

        <div>
          <AnnouncementComments
            announcementId={announcement.id}
            autoFocusComposer={focusComment}
            defaultOpen
            onOpenChange={setCommentsOpen}
          />
        </div>
      </div>
    </div>
  )
}

function withPinCoords(prev: Concern, full: Concern): Concern {
  const merged = { ...prev, ...full }
  if (!hasMapCoords(full)) {
    merged.latitude = prev.latitude
    merged.longitude = prev.longitude
  }
  return merged
}

export default function ResidentAlertsMapPage() {
  usePageTitle("Alerts Map")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const isResponder = isResponderUser(user)
  const initialCommunityName = (user?.barangay || "").trim()
  const [posts, setPosts] = useState<Concern[]>([])
  const [emergencies, setEmergencies] = useState<ResidentMapEmergency[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [communities, setCommunities] = useState<
    ResidentAlertsMapSnapshot["communities"]
  >([])
  const [homeCommunityId, setHomeCommunityId] = useState<string | null>(null)
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(
    null
  )
  // Mount map immediately with barangay defaults — don't wait on API (slow OSM/POI path)
  const [mapMeta, setMapMeta] = useState<ResidentAlertsMapSnapshot["map"]>(
    () => ({
      provider: "OpenStreetMap",
      center: {
        latitude: NETWORK_FALLBACK_CENTER.latitude,
        longitude: NETWORK_FALLBACK_CENTER.longitude,
        zoom: NETWORK_FALLBACK_CENTER.zoom,
      },
      boundary: {
        osm_relation_id: null,
        name:
          initialCommunityName.toLowerCase() === "pending"
            ? ""
            : initialCommunityName,
        geometry: null,
      },
    })
  )
  const [loading, setLoading] = useState(true)
  // The map can paint immediately with a visual network fallback, but that
  // fallback is not a valid weather location. Wait for a real community
  // payload before requesting a forecast so another area's weather never
  // flashes on first render.
  const [weatherReady, setWeatherReady] = useState(false)
  const [filterLoading, setFilterLoading] = useState(false)
  const [error, setError] = useState("")
  const [chip, setChip] = useState<ChipKey>("all")
  const [alertQuery, setAlertQuery] = useState("")
  const [alertFilterOpen, setAlertFilterOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedEmergencyId, setSelectedEmergencyId] = useState<number | null>(
    null
  )
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<
    number | null
  >(null)
  const [expandedPost, setExpandedPost] = useState<Concern | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)
  const [focusComment, setFocusComment] = useState(false)
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(
    () => {
      const stored = readLastKnownPosition(user?.id ?? null)
      if (!stored) return null
      const seed = { lat: stored.latitude, lng: stored.longitude }
      return isLocalGps(seed, mapMeta.boundary.geometry) ? seed : null
    }
  )
  const [userPinVisible, setUserPinVisible] = useState(false)
  const mapApiRef = useRef<MapApi | null>(null)
  const isDesktop = useIsDesktop()
  const advisorySheetRef = useRef<HTMLDivElement>(null)
  const advisoryDragRef = useRef<{
    id: number
    startY: number
    startH: number
  } | null>(null)
  const [advisoryDragH, setAdvisoryDragH] = useState<number | null>(null)
  const filtersHeadRef = useRef<HTMLDivElement>(null)
  const rowsScrollRef = useRef<HTMLUListElement>(null)
  const [listH, setListH] = useState<number | null>(null)
  useEffect(() => {
    setAdvisoryDragH(null)
  }, [selectedAnnouncementId])
  const sheetDetailOpen =
    selectedId != null ||
    selectedEmergencyId != null ||
    selectedAnnouncementId != null ||
    expandLoading
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
      typeof window !== "undefined"
        ? Math.round(Math.min(window.innerHeight * 0.55, 520))
        : 420,
    onSettle: () => mapApiRef.current?.invalidateSize(),
    maxH: sheetDetailOpen ? undefined : listH,
  })
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  /** Desktop left alerts panel collapsed vs open. */
  const [alertsOpen, setAlertsOpen] = useState(true)
  /** Desktop alerts panel size — null until the resident drags the corner. */
  const [alertsPanelSize, setAlertsPanelSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const alertsPanelRef = useRef<HTMLElement>(null)
  const [alertsPanelResizing, setAlertsPanelResizing] = useState(false)
  const alertsPanelResizeStartRef = useRef<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
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
      const maxHeight = Math.min(
        window.innerHeight - 32,
        Math.round(window.innerHeight * 0.9)
      )
      const width = Math.min(
        maxWidth,
        Math.max(280, start.w + (e.clientX - start.x))
      )
      const height = Math.min(
        maxHeight,
        Math.max(220, start.h + (e.clientY - start.y))
      )
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
    alertsPanelResizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
    }
    setAlertsPanelResizing(true)
  }

  const collapseSheetForMap = useCallback(() => {
    if (isDesktop) return
    setWeatherOpen(false)
    snapSheetTo("hidden")
  }, [isDesktop, snapSheetTo])

  const selectedCommunity =
    communities.find((community) => community.id === selectedCommunityId) ??
    communities.find((community) => community.id === homeCommunityId) ??
    null
  const activeCommunityId = selectedCommunity?.id ?? homeCommunityId
  const selectedCenter = useMemo(
    () =>
      selectedCommunity
        ? { ...selectedCommunity.center, zoom: mapMeta.center.zoom }
        : mapMeta.center,
    [mapMeta.center, selectedCommunity]
  )
  const selectedBoundary = selectedCommunity?.boundary ?? mapMeta.boundary
  const weatherLat = weatherReady ? selectedCenter.latitude : null
  const weatherLng = weatherReady ? selectedCenter.longitude : null
  const weatherPlace = (() => {
    const fromMap = selectedBoundary?.name?.trim()
    if (fromMap) return fromMap
    const fromUser = (user?.barangay || "").trim()
    if (fromUser && fromUser.toLowerCase() !== "pending") return fromUser
    return ""
  })()
  const weather = useBarangayWeather(weatherLat, weatherLng, weatherPlace)

  const load = useCallback(async (soft = false) => {
    if (!soft) setError("")
    try {
      // Parallel: map snapshot has public pin coords; feed has votes/comments but masks lat/lng
      const mapSnapPromise = getResidentAlertsMap()
        .then((mapSnap) => {
          if (mapSnap?.map) {
            setMapMeta(mapSnap.map)
            setCommunities(mapSnap.communities ?? [])
            setHomeCommunityId(mapSnap.home_community_id)
            setSelectedCommunityId(
              (current) => current ?? mapSnap.home_community_id
            )
            setWeatherReady(true)
          }
          return mapSnap
        })
        .catch(() => null)
      const feedPromise = listFeedConcerns("all").catch(() => [] as Concern[])
      const announcementsPromise = listAnnouncements().catch(
        () => [] as Announcement[]
      )

      const [mapSnap, feed, nextAnnouncements] = await Promise.all([
        mapSnapPromise,
        feedPromise,
        announcementsPromise,
      ])
      const withPins = mergeFeedWithMapCoords(
        feed,
        mapSnap?.concerns,
        mapSnap?.home_community_id
      )
      setPosts(withPins)
      // Keep every published advisory: the list shows them all, and the map
      // skips the ones without a drawn area (the map already guards on
      // `area_geometry`), so a barangay-wide notice still belongs in the feed.
      setAnnouncements(nextAnnouncements.filter((item) => item.is_published))
      setEmergencies(
        (mapSnap?.emergencies ?? []).filter((em) =>
          validCoord(em.latitude, em.longitude)
        )
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
    setSelectedId(null)
    setExpandedPost(null)
    setFocusComment(false)
    setSelectedEmergencyId(null)
    setSelectedAnnouncementId(null)
    setAlertsOpen(true)
    if (!isDesktop) snapSheetTo("expanded")
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
    setWeatherOpen((value) => !value)
  }

  const weatherToggle = (
    <button
      type="button"
      onClick={toggleWeather}
      aria-label={
        weatherOpen ? "Show the alerts list" : "Show the weather details"
      }
      aria-expanded={weatherOpen}
      title="Weather"
      className="flex shrink-0 items-center gap-1.5 text-[18px] leading-tight font-bold tracking-tight text-neutral-900 transition-opacity hover:opacity-70 sm:text-[20px]"
    >
      {weather.loading && weather.temperature == null ? (
        <LoaderCircleIcon className="size-5 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <MapWeatherIcon code={weather.code} className="size-5 shrink-0" />
      )}
      <span className="tabular-nums">
        {weather.temperature != null
          ? `${Math.round(weather.temperature)}°C`
          : "—"}
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
          websocketUrl(
            `/ws/dashboard/resident-live-map/?ticket=${encodeURIComponent(ticket)}`
          )
        )
      } catch {
        if (!closed) {
          attempts += 1
          reconnectTimer = window.setTimeout(
            () => void connect(),
            Math.min(30_000, 1500 * 2 ** attempts)
          )
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
            payload?: {
              concern?: ResidentMapConcern
              emergency?: ResidentMapEmergency
              removed?: boolean
            }
          }
          if (
            message.type !== "concern.created" &&
            message.type !== "concern.updated" &&
            message.type !== "emergency.created" &&
            message.type !== "emergency.updated"
          )
            return
          const resource =
            message.payload?.concern ?? message.payload?.emergency
          if (!resource?.id) return
          const key = `${message.type}:${resource.id}:${"updated_at" in resource ? resource.updated_at : ""}:${"status" in resource ? resource.status : ""}`
          if (seen.has(key)) return
          seen.add(key)
          if (seen.size > 200) seen.delete(seen.values().next().value as string)
          if (message.payload?.concern) {
            if (
              message.payload.removed ||
              message.payload.concern.status === "rejected"
            ) {
              setPosts((current) =>
                current.filter((post) => post.id !== resource.id)
              )
            } else {
              scheduleReload()
            }
          } else if (message.payload?.emergency) {
            const emergency = message.payload.emergency
            const active = isEmergencyActive(emergency.status)
            setEmergencies((current) =>
              active
                ? current.some((item) => item.id === emergency.id)
                  ? current.map((item) =>
                      item.id === emergency.id ? emergency : item
                    )
                  : [emergency, ...current]
                : current.filter((item) => item.id !== emergency.id)
            )
          }
        } catch {
          // REST refresh remains the recovery path for malformed events.
        }
      }
      socket.onclose = () => {
        if (!closed) {
          attempts += 1
          reconnectTimer = window.setTimeout(
            () => void connect(),
            Math.min(30_000, 1500 * 2 ** attempts)
          )
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
    setUserPinVisible(false)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        // Ignore GPS outside the area — caused "13000 km away" labels
        if (isLocalGps(next, mapMeta.boundary.geometry)) {
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    )
  }, [user?.id])

  // Distance origin: local GPS when near MH, else barangay center (never far-away device GPS)
  const origin = useMemo(() => {
    if (userPos && isLocalGps(userPos, selectedBoundary.geometry))
      return userPos
    return { lat: selectedCenter.latitude, lng: selectedCenter.longitude }
  }, [userPos, selectedBoundary, selectedCenter])

  const layers = defaultResidentLayers

  const filtered = useMemo(() => {
    if (!layers.concerns) return [] as Concern[]
    if (chip === "announcements") return [] as Concern[]
    if (!activeCommunityId) return [] as Concern[]
    // Chip can only be All or Concerns now that the category dropdown is gone.
    const base = posts
    // Drop posts with invalid / out-of-area coordinates (no random far pins)
    return base.filter(
      (post) => hasMapCoords(post) && post.community.id === activeCommunityId
    )
  }, [posts, chip, layers.concerns, activeCommunityId])

  const filteredEmergencies = useMemo(() => {
    if (!layers.concerns) return [] as ResidentMapEmergency[]
    // “Concerns” is the complete report queue. Keep emergency/critical SOS
    // rows in this view alongside ordinary resident concerns.
    if (chip !== "all" && chip !== "concerns" && chip !== "posts")
      return [] as ResidentMapEmergency[]
    if (!activeCommunityId) return [] as ResidentMapEmergency[]
    return emergencies.filter(
      (emergency) => emergency.community.id === activeCommunityId
    )
  }, [emergencies, chip, layers.concerns, activeCommunityId])

  // Advisories show under the default view and the dedicated Announcements
  // chip — the Posts / category chips are about reports, so a
  // water-outage notice should not leak into those.
  const visibleAnnouncements = useMemo(
    () =>
      layers.advisories &&
      (chip === "all" || chip === "announcements") &&
      selectedCommunity?.name
        ? announcements.filter(
            (announcement) =>
              announcement.barangay.trim().toLowerCase() ===
              selectedCommunity.name.trim().toLowerCase()
          )
        : ([] as Announcement[]),
    [chip, announcements, layers.advisories, selectedCommunity]
  )

  const orderedAlerts = useMemo(() => {
    const rows = [
      ...filteredEmergencies.map((item) => ({
        kind: "emergency" as const,
        item,
        group: isEmergencyActive(item.status) ? 0 : 1,
        priority: 3,
        time: new Date(item.created_at).getTime(),
      })),
      ...filtered.map((item) => ({
        kind: "concern" as const,
        item,
        group: ["resolved", "partially_resolved", "rejected"].includes(
          item.status
        )
          ? 1
          : 0,
        priority: concernPriorityRank(item),
        time: new Date(item.created_at).getTime(),
      })),
      ...visibleAnnouncements.map((item) => ({
        kind: "announcement" as const,
        item,
        group: 2,
        priority: 0,
        time: new Date(item.created_at).getTime(),
      })),
    ]
    return rows.sort(
      (a, b) => a.group - b.group || b.priority - a.priority || b.time - a.time
    )
  }, [filtered, filteredEmergencies, visibleAnnouncements])

  const visibleAlerts = useMemo(() => {
    const q = alertQuery.trim().toLowerCase()
    if (!q) return orderedAlerts
    const matches = (values: Array<unknown>) =>
      values.some(
        (value) => typeof value === "string" && value.toLowerCase().includes(q)
      )
    return orderedAlerts.filter((row) => {
      if (row.kind === "emergency") {
        const emergency = row.item
        return matches([
          emergency.type,
          emergency.type_label,
          emergency.note,
          emergency.display_description,
          emergency.ai_summary,
          emergency.address,
          emergency.barangay,
        ])
      }
      if (row.kind === "concern") {
        const post = row.item
        return matches([
          post.title,
          post.description,
          post.address,
          post.barangay,
          post.tracking_id,
        ])
      }
      const announcement = row.item
      return matches([
        announcement.title,
        announcement.body,
        announcement.barangay,
        announcement.tag,
      ])
    })
  }, [orderedAlerts, alertQuery])

  const distanceFor = useCallback(
    (post: Concern) => {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) return null
      return haversineMeters(origin.lat, origin.lng, pos[0], pos[1])
    },
    [origin]
  )

  const distanceForEmergency = useCallback(
    (em: ResidentMapEmergency) => {
      const pos = validCoord(em.latitude, em.longitude)
      if (!pos) return null
      return haversineMeters(origin.lat, origin.lng, pos[0], pos[1])
    },
    [origin]
  )

  function openAnnouncement(id: number, write = false) {
    setSelectedId(null)
    setExpandedPost(null)
    setSelectedEmergencyId(null)
    setSelectedAnnouncementId(id)
    setFocusComment(write)
    setWeatherOpen(false)
    setAlertsOpen(true)
  }

  async function openPost(id: number, write = false) {
    if (isResponder) {
      clearSelection()
      navigate(`/dashboard/reports/${id}`)
      return
    }
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
      const detailed = streetAddress
        ? { ...full, address: streetAddress }
        : full
      setExpandedPost(detailed)
      // Keep list in sync with lightweight fields
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? withPinCoords(p, detailed) : p))
      )
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
    // Back returns to the complete alert list. The map pins are independent
    // of the selected detail and must remain visible while the list reopens.
    setAlertsOpen(true)
    if (!isDesktop) snapSheetTo("expanded")
  }

  function onAdvisoryHandleDown(event: ReactPointerEvent<HTMLDivElement>) {
    const el = advisorySheetRef.current
    if (el == null) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    const startH = el.offsetHeight
    advisoryDragRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startH,
    }
    setAdvisoryDragH(startH)
  }

  function onAdvisoryHandleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = advisoryDragRef.current
    if (!drag || drag.id !== event.pointerId) return
    setAdvisoryDragH(
      Math.min(
        drag.startH,
        Math.max(56, drag.startH + (drag.startY - event.clientY))
      )
    )
  }

  function onAdvisoryHandleUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = advisoryDragRef.current
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    advisoryDragRef.current = null
    if (drag && drag.id === event.pointerId) {
      const h = Math.min(
        drag.startH,
        Math.max(56, drag.startH + (drag.startY - event.clientY))
      )
      if (drag.startH - h > 90) {
        setAdvisoryDragH(null)
        closePost()
        return
      }
    }
    setAdvisoryDragH(null)
  }

  function toggleOrOpen(alreadySelected: boolean, open: () => void) {
    if (alreadySelected) {
      clearSelection()
      setAlertsOpen(true)
      if (!isDesktop) snapSheetTo("expanded")
      return
    }
    open()
  }

  function openEmergency(id: number, write = false) {
    if (isResponder) {
      clearSelection()
      navigate(`/dashboard/reports?alert=${id}`)
      return
    }
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
      ? (announcements.find((item) => item.id === selectedAnnouncementId) ??
        null)
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
        if (!isLocalGps(next, mapMeta.boundary.geometry)) {
          setUserPos(null)
          setUserPinVisible(false)
          toast.error(
            weatherPlace
              ? `Your location is outside ${weatherPlace}`
              : "Your location is outside this community"
          )
          window.setTimeout(() => {
            mapApiRef.current?.invalidateSize()
            mapApiRef.current?.fitBoundary(48)
          }, 120)
          return
        }
        setUserPos(next)
        setUserKnownAt(pos.timestamp || Date.now())
        setUserPinVisible(true)
        window.setTimeout(() => {
          mapApiRef.current?.invalidateSize()
          mapApiRef.current?.flyTo(next.lat, next.lng, 17)
        }, 120)
      },
      () => {
        setLocating(false)
        toast.error("Could not get your location")
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }

  const sessionUserAsPublic: PublicUser | null = user
    ? {
        id: user.id,
        full_name:
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident",
        role: user.role,
        initials:
          `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() ||
          "U",
        last_seen_at: null,
        street: streetLabelFromAddress(user.address) ?? undefined,
        barangay: user.barangay || BARANGAY,
      }
    : null

  async function refreshPost(id: number) {
    try {
      const full = await getConcern(id)
      setExpandedPost(full)
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? withPinCoords(p, full) : p))
      )
    } catch {
      /* keep current */
    }
  }

  const nearestPreview = useMemo(() => {
    if (filtered.length === 0) return null
    return [...filtered].sort(
      (a, b) => (distanceFor(a) ?? 1e9) - (distanceFor(b) ?? 1e9)
    )[0]
  }, [filtered, distanceFor])

  const nearestEmergency = useMemo(() => {
    if (filteredEmergencies.length === 0) return null
    return [...filteredEmergencies].sort(
      (a, b) =>
        (distanceForEmergency(a) ?? 1e9) - (distanceForEmergency(b) ?? 1e9)
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

  useEffect(() => {
    const head = filtersHeadRef.current
    const rows = rowsScrollRef.current
    if (head == null || rows == null) return
    const h = head.offsetHeight + rows.scrollHeight + 8 + 16 + 24
    setListH((prev) => (prev == null || Math.abs(prev - h) > 2 ? h : prev))
  }, [
    chip,
    alertQuery,
    filterLoading,
    weatherOpen,
    weather,
    mapItemCount,
    posts.length,
    emergencies.length,
    announcements.length,
    orderedAlerts.length,
    sheetMode,
    sheetHeight,
    selectedId,
    selectedEmergencyId,
    selectedAnnouncementId,
    expandLoading,
  ])

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
          canInteract={selectedEmergency.community.id === homeCommunityId}
        />
      ) : selectedAnnouncement ? (
        <AnnouncementDetailPanel
          key={selectedAnnouncement.id}
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
            <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-1">
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
                key={expandedPost.id}
                post={expandedPost}
                sessionUser={sessionUserAsPublic}
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
                    setPosts((prev) =>
                      prev.map((x) => (x.id === p.id ? next : x))
                    )
                  } catch {
                    toast.error("Could not update vote")
                  }
                }}
                onComment={async (postId, body, parent, media) => {
                  try {
                    await commentOnConcern(postId, {
                      body,
                      parent: parent ?? null,
                      media,
                    })
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
          <div className="flex shrink-0 items-center gap-2.5 bg-white px-4 pt-3 pb-2 sm:pt-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] leading-tight font-bold tracking-tight text-neutral-900 sm:text-[20px]">
                {weatherOpen
                  ? weatherPlace
                    ? "Weather in"
                    : "Local weather"
                  : weatherPlace
                    ? "Alerts in"
                    : "Local alerts"}{" "}
                <span
                  className="text-brand-orange"
                  style={{ color: "var(--color-brand-orange)" }}
                >
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
            <AlertsSearchRow
              query={alertQuery}
              onQuery={setAlertQuery}
              filterOpen={alertFilterOpen}
              onToggleFilter={() => setAlertFilterOpen((value) => !value)}
              chip={weatherOpen ? "" : chip}
              onSelectChip={(key) => void applyChip(key)}
            />
          </div>

          <div
            className={cn(
              "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4",
              weatherOpen ? "px-4" : "px-3"
            )}
          >
            {weatherOpen ? (
              <MapWeatherCard weather={weather} framed={false} />
            ) : filterLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 sm:py-16">
                <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                <p className="text-[13px] font-medium text-neutral-500">
                  Loading…
                </p>
              </div>
            ) : listEmpty ? (
              <EmptyState
                icon={
                  chip === "announcements" ? (
                    <MegaphoneIcon className="size-10" />
                  ) : (
                    <MapPinIcon className="size-10" />
                  )
                }
                title={
                  chip === "announcements"
                    ? "No advisories yet"
                    : "No concerns on the map"
                }
                body={
                  chip === "announcements"
                    ? "Official barangay advisories will appear here."
                    : "Concerns with a location appear here."
                }
              />
            ) : visibleAlerts.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <SearchIcon
                  className="size-8 text-neutral-300"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <p className="mt-3 text-[14px] text-neutral-500">
                  No alerts match this search.
                </p>
                <button
                  type="button"
                  onClick={() => setAlertQuery("")}
                  className="mt-2 text-[14px] font-semibold text-brand-orange"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleAlerts.map((row) => {
                  if (row.kind === "emergency") {
                    return (
                      <li key={`em-${row.item.id}`}>
                        <EmergencyPreviewCard
                          emergency={row.item}
                          distance={distanceForEmergency(row.item)}
                          expanded={selectedEmergencyId === row.item.id}
                          onOpen={() => openEmergency(row.item.id)}
                          onWrite={() => openEmergency(row.item.id)}
                          showPriority={isResponder}
                          actionLabel={
                            isResponder ? "Open full report" : undefined
                          }
                        />
                      </li>
                    )
                  }
                  if (row.kind === "concern") {
                    return (
                      <li key={row.item.id}>
                        <FeedPreviewCard
                          post={row.item}
                          distance={distanceFor(row.item)}
                          expanded={selectedId === row.item.id}
                          onOpen={() => void openPost(row.item.id, false)}
                          onWrite={() => void openPost(row.item.id, false)}
                          showPriority={isResponder}
                          actionLabel={
                            isResponder ? "Open full report" : undefined
                          }
                        />
                      </li>
                    )
                  }
                  return (
                    <li key={`ann-${row.item.id}`}>
                      <AnnouncementListItem
                        announcement={row.item}
                        expanded={selectedAnnouncementId === row.item.id}
                        onOpen={() => openAnnouncement(row.item.id, false)}
                        onWrite={() => openAnnouncement(row.item.id, false)}
                      />
                    </li>
                  )
                })}
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
        isDesktop ? "h-full" : "h-svh"
      )}
    >
      {mapMeta ? (
        <ResidentLeafletMap
          center={selectedCenter}
          // Keep the geometry available for Home/initial framing. The map
          // component renders this layer fully transparent, so coverage
          // indicators remain hidden while centering still works.
          boundary={selectedBoundary}
          policy={mapMeta.dispatch_policy}
          posts={filtered}
          emergencies={filteredEmergencies}
          announcements={visibleAnnouncements}
          selectedId={selectedId}
          selectedEmergencyId={selectedEmergencyId}
          selectedAnnouncementId={selectedAnnouncementId}
          userPos={userPinVisible ? userPos : null}
          userPosAt={userKnownAt}
          viewerIsResponder={isResponder}
          onSelect={(id) => {
            toggleOrOpen(selectedId === id, () => void openPost(id, false))
          }}
          onSelectEmergency={(id) => {
            toggleOrOpen(selectedEmergencyId === id, () => openEmergency(id))
          }}
          onSelectAnnouncement={(id) => {
            toggleOrOpen(selectedAnnouncementId === id, () =>
              openAnnouncement(id, false)
            )
          }}
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
        <div className="absolute top-3 left-3 z-30">
          <button
            type="button"
            onClick={() =>
              navigate(isResponder ? "/dashboard/reports" : "/dashboard/home")
            }
            className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-800 shadow-md"
            aria-label="Back to home"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        </div>
      ) : null}

      {/* One control column, shared order and icon language across maps. */}
      <div
        className={cn(
          "absolute z-30 flex flex-col items-end gap-2",
          isDesktop ? "top-4 right-4" : "top-3 right-3"
        )}
      >
        <div className="pointer-events-auto relative">
          <MapControlStack tone="light">
            <MapControlButton
              tone="light"
              label="Frame the barangay"
              onClick={goHomeOnMap}
            >
              <HomeIcon className="size-5" strokeWidth={1.9} />
            </MapControlButton>
            <MapControlButton
              tone="light"
              divider
              label="Current location"
              onClick={goMyLocation}
              loading={locating}
            >
              <LocateFixedIcon className="size-5" strokeWidth={1.9} />
            </MapControlButton>
          </MapControlStack>
        </div>
      </div>

      {isDesktop ? (
        alertsOpen ? (
          <aside
            ref={alertsPanelRef}
            className="absolute top-4 left-4 z-20 flex max-h-[min(72vh,620px)] w-[min(100%,380px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)]"
            style={
              alertsPanelSize
                ? {
                    width: alertsPanelSize.width,
                    maxHeight: alertsPanelSize.height,
                  }
                : undefined
            }
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-100 px-3">
              <CircleAlertIcon
                className="size-5 shrink-0 text-neutral-800"
                strokeWidth={2.25}
              />
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
              className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none"
              aria-hidden
            />
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setAlertsOpen(true)}
            className="absolute top-4 left-4 z-20 flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md"
            aria-label="Open alerts"
            title="Open alerts"
          >
            <CircleAlertIcon
              className="size-5 shrink-0 text-neutral-800"
              strokeWidth={2.25}
            />
          </button>
        )
      ) : (
        /* Mobile draggable sheet — solid white so map content never shows through */
        <div
          ref={advisorySheetRef}
          className={cn(
            "absolute right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden rounded-t-3xl border border-b-0 border-neutral-200 bg-white shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
            !sheetDragging &&
              advisoryDragH == null &&
              "transition-[height] duration-200 ease-out"
          )}
          style={
            selectedAnnouncementId != null && advisoryDragH == null
              ? { maxHeight: "92svh" }
              : { height: advisoryDragH ?? sheetHeight, maxHeight: "92svh" }
          }
          role="dialog"
          aria-label="Alerts sheet"
        >
          {/* Drag handle — advisory hugs content and only drags down to dismiss */}
          <div
            className="flex shrink-0 cursor-grab touch-none flex-col items-center bg-white px-3 pt-2 pb-1 active:cursor-grabbing"
            onPointerDown={
              selectedAnnouncementId != null
                ? onAdvisoryHandleDown
                : onSheetHandlePointerDown
            }
            onPointerMove={
              selectedAnnouncementId != null
                ? onAdvisoryHandleMove
                : onSheetHandlePointerMove
            }
            onPointerUp={
              selectedAnnouncementId != null
                ? onAdvisoryHandleUp
                : onSheetHandlePointerUp
            }
            onPointerCancel={
              selectedAnnouncementId != null
                ? onAdvisoryHandleUp
                : onSheetHandlePointerUp
            }
            aria-label="Drag sheet"
          >
            <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
            {sheetMode === "hidden" ||
            sheetHeight <= sheetSnaps().hidden + 8 ? (
              <p className="pb-1 text-[13px] font-semibold text-neutral-700">
                {weatherPlace ? `Alerts in ${weatherPlace}` : "Local alerts"}
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
              selectedAnnouncementId != null ||
              expandLoading ||
              sheetMode === "expanded" ||
              sheetHeight >= (snaps.peek + snaps.expanded) / 2
            const showDetail =
              selectedId != null ||
              selectedEmergencyId != null ||
              selectedAnnouncementId != null ||
              expandLoading
            return (
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col overflow-hidden bg-white",
                  !contentVisible && "pointer-events-none opacity-0"
                )}
              >
                {/* Filters always visible in preview + list (not on expanded detail) */}
                {!showDetail ? (
                  <div
                    ref={filtersHeadRef}
                    className="relative shrink-0 bg-white px-3 pt-0.5 pb-2"
                  >
                    <div className="mb-2 flex items-center gap-2.5">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => snapSheetTo("expanded")}
                      >
                        <p className="text-[15px] font-bold text-neutral-900">
                          {weatherOpen
                            ? weatherPlace
                              ? "Weather in"
                              : "Local weather"
                            : weatherPlace
                              ? "Alerts in"
                              : "Local alerts"}{" "}
                          <span
                            className="text-brand-orange"
                            style={{ color: "var(--color-brand-orange)" }}
                          >
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
                    <AlertsSearchRow
                      query={alertQuery}
                      onQuery={setAlertQuery}
                      filterOpen={alertFilterOpen}
                      onToggleFilter={() =>
                        setAlertFilterOpen((value) => !value)
                      }
                      chip={weatherOpen ? "" : chip}
                      onSelectChip={(key) => void applyChip(key)}
                    />
                  </div>
                ) : null}

                {!showFull ? (
                  <div
                    className={cn(
                      "scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white pt-2 pb-3",
                      weatherOpen ? "px-4" : "px-3"
                    )}
                  >
                    {weatherOpen ? (
                      <MapWeatherCard weather={weather} framed={false} />
                    ) : filterLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8">
                        <LoaderCircleIcon className="size-7 animate-spin text-neutral-400" />
                        <p className="text-[13px] font-medium text-neutral-500">
                          Loading…
                        </p>
                      </div>
                    ) : nearestEmergency ? (
                      <EmergencyPreviewCard
                        emergency={nearestEmergency}
                        distance={distanceForEmergency(nearestEmergency)}
                        expanded={false}
                        onOpen={() => openEmergency(nearestEmergency.id)}
                        onWrite={() => openEmergency(nearestEmergency.id)}
                        showPriority={isResponder}
                        actionLabel={
                          isResponder ? "Open full report" : undefined
                        }
                      />
                    ) : nearestAnnouncement ? (
                      <AnnouncementListItem
                        announcement={nearestAnnouncement}
                        expanded={false}
                        onOpen={() =>
                          openAnnouncement(nearestAnnouncement.id, false)
                        }
                        onWrite={() =>
                          openAnnouncement(nearestAnnouncement.id, false)
                        }
                      />
                    ) : nearestPreview ? (
                      <FeedPreviewCard
                        post={nearestPreview}
                        distance={distanceFor(nearestPreview)}
                        expanded={false}
                        onOpen={() => void openPost(nearestPreview.id, false)}
                        onWrite={() => void openPost(nearestPreview.id, false)}
                        showPriority={isResponder}
                        actionLabel={
                          isResponder ? "Open full report" : undefined
                        }
                      />
                    ) : (
                      <p className="pb-3 text-center text-[13px] text-neutral-500">
                        {chip === "announcements"
                          ? "No advisories yet"
                          : "No alerts with a location"}
                      </p>
                    )}
                  </div>
                ) : showDetail ? (
                  <div className="h-full min-h-0 touch-pan-y overflow-y-auto overscroll-contain bg-white">
                    {panelBody}
                  </div>
                ) : (
                  /* Expanded list: filters already shown above — list only */
                  <div
                    className={cn(
                      "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-4",
                      weatherOpen ? "px-4" : "px-3"
                    )}
                  >
                    {weatherOpen ? (
                      <MapWeatherCard weather={weather} framed={false} />
                    ) : filterLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14">
                        <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
                        <p className="text-[13px] font-medium text-neutral-500">
                          Loading…
                        </p>
                      </div>
                    ) : listEmpty ? (
                      <EmptyState
                        icon={
                          chip === "announcements" ? (
                            <MegaphoneIcon className="size-10" />
                          ) : (
                            <MapPinIcon className="size-10" />
                          )
                        }
                        title={
                          chip === "announcements"
                            ? "No advisories yet"
                            : "No concerns on the map"
                        }
                        body={
                          chip === "announcements"
                            ? "Official barangay advisories will appear here."
                            : "Concerns with a location appear here."
                        }
                      />
                    ) : visibleAlerts.length === 0 ? (
                      <div className="flex flex-col items-center px-6 py-10 text-center">
                        <SearchIcon
                          className="size-8 text-neutral-300"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                        <p className="mt-3 text-[14px] text-neutral-500">
                          No alerts match this search.
                        </p>
                        <button
                          type="button"
                          onClick={() => setAlertQuery("")}
                          className="mt-2 text-[14px] font-semibold text-brand-orange"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : (
                      <ul ref={rowsScrollRef} className="flex flex-col gap-2">
                        {visibleAlerts.map((row) => {
                          if (row.kind === "emergency") {
                            return (
                              <li key={`em-${row.item.id}`}>
                                <EmergencyPreviewCard
                                  emergency={row.item}
                                  distance={distanceForEmergency(row.item)}
                                  expanded={selectedEmergencyId === row.item.id}
                                  onOpen={() => openEmergency(row.item.id)}
                                  onWrite={() => openEmergency(row.item.id)}
                                  showPriority={isResponder}
                                  actionLabel={
                                    isResponder ? "Open full report" : undefined
                                  }
                                />
                              </li>
                            )
                          }
                          if (row.kind === "concern") {
                            return (
                              <li key={row.item.id}>
                                <FeedPreviewCard
                                  post={row.item}
                                  distance={distanceFor(row.item)}
                                  expanded={selectedId === row.item.id}
                                  onOpen={() =>
                                    void openPost(row.item.id, false)
                                  }
                                  onWrite={() =>
                                    void openPost(row.item.id, false)
                                  }
                                  showPriority={isResponder}
                                  actionLabel={
                                    isResponder ? "Open full report" : undefined
                                  }
                                />
                              </li>
                            )
                          }
                          return (
                            <li key={`ann-${row.item.id}`}>
                              <AnnouncementListItem
                                announcement={row.item}
                                expanded={
                                  selectedAnnouncementId === row.item.id
                                }
                                onOpen={() =>
                                  openAnnouncement(row.item.id, false)
                                }
                                onWrite={() =>
                                  openAnnouncement(row.item.id, false)
                                }
                              />
                            </li>
                          )
                        })}
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
