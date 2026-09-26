import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { AlertTriangleIcon, ChevronRightIcon, CheckIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { isStaffUser } from "@/features/auth/roles"
import { useDebouncedCallback } from "@/hooks/use-debounced-callback"
import { shouldSkipPoll } from "@/features/dashboard/lib/visible-poll"
import { geocodeCommunityStreet } from "@/features/auth/lib/forward-geocode"
import {
  commentOnConcern,
  deleteConcernComment,
  getConcern,
  getResidentAlertsMap,
  getResidentDashboardSummary,
  listAnnouncements,
  listFeedConcerns,
  listBarangayEventCalendar,
  updateConcernComment,
  voteConcern,
  type Announcement,
  type BarangayEvent,
  type Concern,
  type PublicUser,
} from "@/features/dashboard/api"
import { streetLabelFromAddress } from "@/features/dashboard/components/feed-post-text"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { HomeRail } from "@/features/dashboard/components/home/home-rail"
import {
  LiveDot,
  liveDotAriaLabel,
} from "@/features/dashboard/components/home/live-dot"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import { FeedPostErrorBoundary } from "@/features/dashboard/components/feed-post-error-boundary"
import { railLiveMapSrc } from "@/features/dashboard/components/home/home-style"
import {
  ResidentNotificationsButton,
  ResidentProfileDialog,
} from "@/features/dashboard/components/resident/resident-account-dialogs"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
} from "@/features/dashboard/components/resident-top-bar"
import { FEED_MAX, RAIL_W } from "@/features/dashboard/lib/shell"
import {
  rankFeed,
  type FeedOrigin,
} from "@/features/dashboard/lib/feed-ranking"
import { isCriticalConcern } from "@/features/dashboard/lib/critical-concern"
import { AnnouncementCarousel } from "@/features/dashboard/components/home/announcement-carousel"
import { usePageTitle } from "@/hooks/use-page-title"

const FEED_TABS = [
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" },
  { id: "resolved", label: "Resolved" },
] as const

type FeedTab = (typeof FEED_TABS)[number]["id"]

export default function HomePage() {
  usePageTitle("Feed")
  const { user, loading: authLoading } = useAuthSession()
  const navigate = useNavigate()
  const staffFeed = isStaffUser(user)

  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    function open() {
      setCreateOpen(true)
    }
    window.addEventListener("eboses:open-report", open)
    return () => window.removeEventListener("eboses:open-report", open)
  }, [])

  const [feedTab, setFeedTab] = useState<FeedTab>("recent")
  const [origin, setOrigin] = useState<FeedOrigin | null>(null)
  /** True when we could not determine any position (geolocation denied / no
      geocoder hit) — drives the Nearby tab's empty-state wording. */
  const [nearbyUnavailable, setNearbyUnavailable] = useState(false)
  const [feedFilterOpen, setFeedFilterOpen] = useState(false)
  const [feedSearch, setFeedSearch] = useState("")

  const [profileOpen, setProfileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const location = useLocation()
  const stateHighlightId = (location.state as { highlightConcernId?: unknown } | null)
    ?.highlightConcernId
  const queryHighlightId = new URLSearchParams(location.search).get(
    "highlightConcernId"
  )
  const parsedHighlightId = Number(queryHighlightId ?? stateHighlightId)
  const highlightId = Number.isInteger(parsedHighlightId) ? parsedHighlightId : null
  const activeFeedTab = highlightId != null ? "recent" : feedTab
  const activeFeedSearch = highlightId != null ? "" : feedSearch
  const [expandedComments, setExpandedComments] = useState<Set<number>>(
    () => new Set(highlightId != null ? [highlightId] : [])
  )
  const [barangayActiveEmergencies, setBarangayActiveEmergencies] = useState(0)

  useEffect(() => {
    if (!loaded || highlightId == null) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let attempts = 0
    const timer = window.setInterval(() => {
      const post = document.getElementById(`feed-post-${highlightId}`)
      attempts += 1
      if (post) {
        const main = post.closest("main")
        if (main && main.scrollHeight > main.clientHeight) {
          const top = Math.max(
            0,
            main.scrollTop +
              post.getBoundingClientRect().top -
              main.getBoundingClientRect().top -
              88
          )
          main.scrollTo({
            top,
            behavior: reduce ? "auto" : "smooth",
          })
        } else {
          post.scrollIntoView({
            behavior: reduce ? "auto" : "smooth",
            block: "start",
          })
        }
        post.focus({ preventScroll: true })
        window.clearInterval(timer)
      } else if (attempts >= 20) {
        window.clearInterval(timer)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [loaded, highlightId, concerns])

  useEffect(() => {
    if (
      !loaded ||
      highlightId == null ||
      concerns.some((concern) => concern.id === highlightId)
    ) {
      return
    }
    let cancelled = false
    void getConcern(highlightId)
      .then((concern) => {
        if (cancelled) return
        setConcerns((current) =>
          current.some((item) => item.id === concern.id)
            ? current
            : [concern, ...current]
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [loaded, highlightId, concerns])

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"

  const hasOngoingAlerts = barangayActiveEmergencies > 0
  const activeCriticalReports = concerns.filter(
    (concern) =>
      !["resolved", "partially_resolved", "rejected", "appealed"].includes(
        concern.status
      ) && isCriticalConcern(concern)
  ).length
  const hasCriticalReports = activeCriticalReports > 0
  const urgentAlertCount = barangayActiveEmergencies + activeCriticalReports
  const hasUrgentAlerts = urgentAlertCount > 0
  const hasLiveCriticalActivity = hasOngoingAlerts || hasCriticalReports
  const communityName = user?.barangay || "Your community"

  /** True when there is nothing at all to show in any tab — drives the
      "Nothing in the feed yet" onboarding card instead of a filter miss. */
  const feedTotallyEmpty = announcements.length === 0 && concerns.length === 0

  const streetLabel = streetLabelFromAddress(user?.address)

  /** Live rail map — real OSM (same embed style as report maps), street when known */
  const [railMap, setRailMap] = useState<{ lat: number; lng: number }>({
    lat: 14.5995,
    lng: 120.9842,
  })
  const railMapSrc = useMemo(
    () => railLiveMapSrc(railMap.lat, railMap.lng),
    [railMap.lat, railMap.lng]
  )

  useEffect(() => {
    let cancelled = false
    async function resolveRailMap() {
      if (!streetLabel) return
      // streetLabel may be "123 Champaca Street" — geocode as full street line
      const hit = await geocodeCommunityStreet(streetLabel, communityName)
      if (cancelled) return
      if (hit) {
        setRailMap({ lat: hit.lat, lng: hit.lng })
      }
    }
    void resolveRailMap()
    return () => {
      cancelled = true
    }
  }, [communityName, streetLabel])

  const sessionUserAsPublic: PublicUser | null = user
    ? {
        id: user.id,
        full_name: displayName,
        role: user.role,
        initials:
          `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() ||
          "U",
        last_seen_at: null,
        street: streetLabel ?? undefined,
        barangay: communityName,
      }
    : null

  async function loadHome() {
    if (shouldSkipPoll()) return
    setError("")
    try {
      const [
        nextAnnouncements,
        nextConcerns,
        nextEvents,
        summary,
        mapSnapshot,
      ] = await Promise.all([
        listAnnouncements(),
        listFeedConcerns("all", undefined, undefined, undefined, "all", origin),
        listBarangayEventCalendar(),
        getResidentDashboardSummary().catch(() => null),
        getResidentAlertsMap().catch(() => null),
      ])
      setAnnouncements(nextAnnouncements)
      setConcerns(nextConcerns)
      setEvents(nextEvents)
      if (mapSnapshot) {
        setRailMap({
          lat: mapSnapshot.map.center.latitude,
          lng: mapSnapshot.map.center.longitude,
        })
      }
      const count =
        summary?.barangay_active_emergencies ??
        (summary?.has_ongoing_emergencies ? 1 : 0)
      setBarangayActiveEmergencies(typeof count === "number" ? count : 0)
    } catch {
      setError("Could not load home feed.")
    } finally {
      setLoaded(true)
    }
  }

  const loadHomeRef = useRef(loadHome)

  useEffect(() => {
    loadHomeRef.current = loadHome
  })

  // The feed is first fetched without a position; once the viewer's location
  // resolves (geolocation or street-geocode fallback) refetch so the API can
  // attach per-concern distances for the Nearby tab.
  useEffect(() => {
    if (!origin) return
    void loadHomeRef.current()
  }, [origin])

  const eventRefresh = useDebouncedCallback(
    () => void loadHomeRef.current(),
    3000
  )

  useEffect(() => {
    if (authLoading) return
    const initialLoad = window.setTimeout(() => void loadHomeRef.current(), 0)
    const interval = window.setInterval(eventRefresh, 30000)
    const refreshVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        eventRefresh()
      }
    }
    window.addEventListener("eboses:report-created", eventRefresh)
    window.addEventListener("eboses:concern-updated", eventRefresh)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", eventRefresh)
      window.removeEventListener("eboses:concern-updated", eventRefresh)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  }, [authLoading, eventRefresh])

  async function handleVote(post: Concern) {
    const nextVote = post.user_vote === 1 ? 0 : 1
    const result = await voteConcern(post.id, nextVote)
    setConcerns((items) =>
      items.map((item) =>
        item.id === post.id
          ? {
              ...item,
              user_vote: result.user_vote,
              vote_count: result.vote_count,
            }
          : item
      )
    )
  }

  async function submitComment(
    postId: number,
    body: string,
    parentId?: number | null,
    media?: File | null
  ): Promise<boolean> {
    const trimmed = body.trim()
    if (!trimmed && !media) return false
    try {
      await commentOnConcern(postId, {
        body: trimmed,
        parent: parentId ?? null,
        media,
      })
      await loadHome()
      setExpandedComments((current) => new Set(current).add(postId))
      return true
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not post comment."
      )
      return false
    }
  }

  async function saveCommentEdit(
    postId: number,
    commentId: number,
    body: string
  ) {
    const trimmed = body.trim()
    if (!trimmed) {
      toast.error("Comment cannot be empty.")
      return
    }
    try {
      await updateConcernComment(postId, commentId, { body: trimmed })
      await loadHome()
      toast.success("Comment updated")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update comment."
      )
    }
  }

  async function removeComment(postId: number, commentId: number) {
    if (!window.confirm("Delete this comment?")) return
    try {
      await deleteConcernComment(postId, commentId)
      await loadHome()
      toast.success("Comment deleted")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete comment."
      )
    }
  }

  useEffect(() => {
    if (activeFeedTab !== "nearby") return
    if (origin) return

    let cancelled = false

    // GPS denied / timed out / unsupported → approximate the viewer's
    // position from their registered street so Nearby still has an origin.
    function fallbackToStreet() {
      if (cancelled) return
      if (!streetLabel) {
        setNearbyUnavailable(true)
        return
      }
      void geocodeCommunityStreet(streetLabel, communityName).then((hit) => {
        if (cancelled) return
        if (hit) setOrigin({ lat: hit.lat, lng: hit.lng })
        else setNearbyUnavailable(true)
      })
    }

    if (!navigator.geolocation) {
      fallbackToStreet()
      return () => {
        cancelled = true
      }
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setNearbyUnavailable(false)
        setOrigin({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      fallbackToStreet,
      { maximumAge: 300_000, timeout: 8_000 }
    )
    return () => {
      cancelled = true
    }
  }, [activeFeedTab, origin, streetLabel, communityName])

  const sortedConcerns = useMemo(() => {
    const ranked = rankFeed(concerns, activeFeedTab, origin)
    if (highlightId == null) return ranked
    const at = ranked.findIndex((post) => post.id === highlightId)
    if (at <= 0) return ranked
    const next = [...ranked]
    const [hit] = next.splice(at, 1)
    next.unshift(hit)
    return next
  }, [concerns, activeFeedTab, origin, highlightId])

  const visibleConcerns = useMemo(() => {
    const q = activeFeedSearch.trim().toLowerCase()
    if (!q) return sortedConcerns
    return sortedConcerns.filter((post) =>
      [
        post.title,
        post.description,
        post.address,
        post.barangay,
        post.tracking_id,
        post.reporter?.full_name,
      ].some((value) => value?.toLowerCase().includes(q))
    )
  }, [sortedConcerns, activeFeedSearch])

  function clearHighlight() {
    if (highlightId == null) return
    navigate(
      { pathname: location.pathname, search: "" },
      { replace: true, state: null }
    )
  }

  if (!loaded) {
    return (
      <div className="min-h-0 flex-1 bg-white">
        <div className="px-4 py-3">
          <Skeleton className="mx-auto h-10 w-full max-w-md rounded-full" />
        </div>
        <div
          className="mx-auto w-full p-4 lg:grid lg:grid-cols-[minmax(0,680px)_288px] lg:gap-4 lg:px-5"
          style={{ maxWidth: FEED_MAX + RAIL_W + 16 }}
        >
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <div className="hidden min-w-0 space-y-3 lg:block">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Mobile top — also used at ~200% zoom (CSS width < 1024) */}
      <style>{`
        .resident-mobile-top { display: none; }
        .resident-mobile-top.staff-feed-top { display: none !important; }
        .resident-home-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-mobile-top { display: block; }
          .resident-home-desktop-grid { display: block !important; }
          .resident-home-rail { display: none !important; }
        }
        /* Live Carto-light map badge styles live with the shared LiveDot. */
      `}</style>
      {/* Mobile top: map+status dot · community · notif · avatar */}
      <header className={cn("resident-mobile-top sticky top-0 z-30 mt-5 bg-white", staffFeed && "staff-feed-top")}>
        <div className="flex h-12 items-center gap-2 px-4">
          <LiveDot
            src={railMapSrc}
            alert={hasLiveCriticalActivity}
            label={
              hasOngoingAlerts
                ? liveDotAriaLabel(
                    user?.barangay || "your community",
                    true,
                    barangayActiveEmergencies
                  )
                : hasCriticalReports
                  ? `Live map — critical reports in ${user?.barangay || "your community"}`
                  : liveDotAriaLabel(
                      user?.barangay || "your community",
                      false,
                      0
                    )
            }
            to="/dashboard/alerts-map"
          />
          <p className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900">
            {communityName}
          </p>

          <ResidentNotificationsButton />
          <ProfileAccountMenu
            placeLabel={communityName}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenSettings={() => openSettingsDialog()}
          />
        </div>
      </header>
      <ResidentProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onOpenSettings={(closeDialog) => {
          closeDialog()
          openSettingsDialog()
        }}
      />

      {/*
        Mobile: padded feed · Desktop: same grid as top bar
      */}
      <ResidentContentGrid className="resident-home-desktop-grid min-w-0 flex-1 pt-3 pb-6 max-lg:pt-3.5 lg:pt-3 lg:pb-8">
        {/* CENTER feed column */}
        <div className="w-full min-w-0 max-lg:px-3.5">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFeedFilterOpen(true)}
              aria-label="Filter feed"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200"
            >
              <SlidersHorizontalIcon className="size-5" aria-hidden="true" />
            </button>
            <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-neutral-100 pr-4 pl-4">
              <SearchIcon
                className="size-5 shrink-0 text-neutral-500"
                aria-hidden="true"
              />
              <input
                value={activeFeedSearch}
                onChange={(event) => {
                  setFeedSearch(event.target.value)
                  clearHighlight()
                }}
                placeholder="Search feed"
                aria-label="Search feed"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </label>
          </div>

          {/* Desktop: inline chips only */}
          <div className="mb-3 hidden flex-wrap items-center gap-1.5 lg:flex">
            {FEED_TABS.map((tab) => {
              const active = activeFeedTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setFeedTab(tab.id)
                    clearHighlight()
                  }}
                  className={cn(
                    "h-8 rounded-sm border px-3.5 text-[13px] font-semibold transition-colors outline-none",
                    "border-neutral-300 focus-visible:border-neutral-400 focus-visible:text-brand-navy",
                    active
                      ? "bg-neutral-100 text-brand-navy"
                      : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-brand-navy"
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {error ? (
            <p className="mb-3 text-[15px] text-destructive">{error}</p>
          ) : null}

          {hasUrgentAlerts ? (
            <Link
              to="/dashboard/alerts-map"
              className="hover:bg-sos/10/80 mb-3 flex items-center gap-3 rounded-2xl border border-neutral-300 bg-sos/10 px-3.5 py-3 no-underline transition-colors lg:mb-2.5 lg:rounded-lg"
            >
              <span className="flex size-12 shrink-0 items-center justify-center text-sos">
                <AlertTriangleIcon
                  className="size-7 motion-safe:animate-sos-icon-blink"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-sos">
                  {urgentAlertCount} ongoing urgent alert
                  {urgentAlertCount === 1 ? "" : "s"} in{" "}
                  {communityName}
                </span>
                <span className="mt-0.5 block text-[13px] font-medium text-sos/90">
                  View on the map
                </span>
              </span>
              <ChevronRightIcon
                className="size-5 shrink-0 text-sos"
                strokeWidth={2}
              />
            </Link>
          ) : null}

          <div className="flex flex-col gap-2">
            <AnnouncementCarousel announcements={announcements} />

            {visibleConcerns.map((post) => (
              <div
                key={
                  highlightId === post.id
                    ? `${post.id}-${location.key}`
                    : post.id
                }
                id={`feed-post-${post.id}`}
                tabIndex={highlightId === post.id ? -1 : undefined}
                className={cn(
                  "scroll-mt-24 rounded-lg",
                  highlightId === post.id &&
                    "eboses-feed-highlight ring-2 ring-primary/50 ring-offset-2"
                )}
              >
                <FeedPostErrorBoundary key={`boundary-${post.id}`}>
                <FeedPostCard
                  post={post}
                  sessionUser={sessionUserAsPublic}
                  commentsExpanded={expandedComments.has(post.id)}
                  onCommentsExpandedChange={(open) =>
                    setExpandedComments((prev) => {
                      const next = new Set(prev)
                      if (open) next.add(post.id)
                      else next.delete(post.id)
                      return next
                    })
                  }
                  onVote={(p) => void handleVote(p)}
                  onComment={(postId, body, parent) =>
                    submitComment(postId, body, parent ?? null)
                  }
                  onEditComment={saveCommentEdit}
                  onDeleteComment={removeComment}
                />
                </FeedPostErrorBoundary>
              </div>
            ))}

            {visibleConcerns.length === 0 && !error && !feedTotallyEmpty ? (
              <div className="rounded-lg border border-neutral-300 bg-white px-5 py-8 text-center">
                <p className="text-[15px] font-semibold text-neutral-700">
                  {activeFeedSearch.trim()
                    ? "No posts match your search."
                    : activeFeedTab === "nearby"
                      ? nearbyUnavailable
                        ? "Location unavailable — allow location access to see posts near you."
                        : "Nothing reported within 1.5 km of you."
                      : "No posts match this filter."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFeedSearch("")
                    setFeedTab("recent")
                  }}
                  className="mt-2 text-[14px] font-semibold text-brand-orange"
                >
                  Show all recent posts
                </button>
              </div>
            ) : null}

            {feedTotallyEmpty && !error ? (
              <div className="flex flex-col items-center rounded-lg border border-neutral-300 bg-white px-6 py-10 text-center">
                <img
                  src="/contents/feed-header.webp"
                  alt=""
                  className="mb-4 h-44 w-auto max-w-[90%] object-contain opacity-95 sm:h-52"
                />
                <p className="text-[15px] font-semibold text-neutral-700">
                  Nothing in the feed yet.
                </p>
                <p className="mt-1 text-[14px] text-neutral-500">
                  Be the first to post in {communityName}.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT RAIL — sticky while feed scrolls */}
        <HomeRail
          hasOngoingAlerts={hasOngoingAlerts}
          hasCriticalReports={hasCriticalReports}
          barangayActiveEmergencies={barangayActiveEmergencies}
          railMapSrc={railMapSrc}
          streetLabel={streetLabel}
          events={events}
          onCreateReport={() => setCreateOpen(true)}
        />
      </ResidentContentGrid>

      {/* Mobile feed filter sheet — Nextdoor “Filter by” layout, E-Boses white */}
      {feedFilterOpen ? (
        <div
          className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/30 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filter by"
        >
          <button
            type="button"
            className="min-h-0 flex-1 cursor-default"
            aria-label="Dismiss filters"
            onClick={() => setFeedFilterOpen(false)}
          />
          <div className="rounded-t-3xl border border-b-0 border-neutral-200 bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(15,23,42,0.14)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300" />
            <h2 className="mb-2 px-1 text-[20px] font-bold tracking-tight text-neutral-900">
              Filter by
            </h2>
            <ul className="pb-2">
              {FEED_TABS.map((tab) => {
                const active = activeFeedTab === tab.id
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedTab(tab.id)
                        setFeedFilterOpen(false)
                        clearHighlight()
                      }}
                      className="flex min-h-12 w-full items-center justify-between px-1 py-3 text-left text-[16px] text-neutral-800 transition-colors hover:bg-neutral-50"
                    >
                      <span
                        className={cn(
                          active && "font-semibold text-neutral-900"
                        )}
                      >
                        {tab.label}
                      </span>
                      {active ? (
                        <CheckIcon
                          className="size-5 shrink-0 text-neutral-900"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
