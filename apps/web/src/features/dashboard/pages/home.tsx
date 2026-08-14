import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CheckIcon,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  geocodeMarikinaStreet,
  MARIKINA_HEIGHTS_CENTER,
} from "@/features/auth/lib/forward-geocode"
import {
  commentOnConcern,
  deleteConcernComment,
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
import { ComposerCard } from "@/features/dashboard/components/home/composer-card"
import { HomeRail } from "@/features/dashboard/components/home/home-rail"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import {
  BARANGAY,
  railLiveMapSrc,
} from "@/features/dashboard/components/home/home-style"
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
import { rankFeed, type FeedOrigin } from "@/features/dashboard/lib/feed-ranking"
import { AnnouncementCarousel } from "@/features/dashboard/components/home/announcement-carousel"
import { usePageTitle } from "@/hooks/use-page-title"

const FEED_TABS = [
  { id: "for_you", label: "For you" },
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" },
] as const

type FeedTab = (typeof FEED_TABS)[number]["id"]

export default function HomePage() {
  usePageTitle("Home")
  const { user, loading: authLoading } = useAuthSession()

  const [createOpen, setCreateOpen] = useState(false)
  const [feedTab, setFeedTab] = useState<FeedTab>("for_you")
  const [origin, setOrigin] = useState<FeedOrigin | null>(null)
  const [feedFilterOpen, setFeedFilterOpen] = useState(false)

  const [profileOpen, setProfileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [barangayActiveEmergencies, setBarangayActiveEmergencies] = useState(0)

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"

  const hasOngoingAlerts = barangayActiveEmergencies > 0

  const streetLabel = streetLabelFromAddress(user?.address)

  /** Live rail map — real OSM (same embed style as report maps), street when known */
  const [railMap, setRailMap] = useState<{ lat: number; lng: number }>({
    lat: MARIKINA_HEIGHTS_CENTER.lat,
    lng: MARIKINA_HEIGHTS_CENTER.lng,
  })
  const railMapSrc = useMemo(
    () => railLiveMapSrc(railMap.lat, railMap.lng),
    [railMap.lat, railMap.lng],
  )

  useEffect(() => {
    let cancelled = false
    async function resolveRailMap() {
      if (!streetLabel) {
        setRailMap({
          lat: MARIKINA_HEIGHTS_CENTER.lat,
          lng: MARIKINA_HEIGHTS_CENTER.lng,
        })
        return
      }
      // streetLabel may be "123 Champaca Street" — geocode as full street line
      const hit = await geocodeMarikinaStreet(streetLabel)
      if (cancelled) return
      if (hit) {
        setRailMap({ lat: hit.lat, lng: hit.lng })
      } else {
        setRailMap({
          lat: MARIKINA_HEIGHTS_CENTER.lat,
          lng: MARIKINA_HEIGHTS_CENTER.lng,
        })
      }
    }
    void resolveRailMap()
    return () => {
      cancelled = true
    }
  }, [streetLabel])

  const sessionUserAsPublic: PublicUser | null = user
    ? {
        id: user.id,
        full_name: displayName,
        role: user.role,
        initials:
          `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?",
        last_seen_at: null,
        street: streetLabel ?? undefined,
        barangay: user.barangay || BARANGAY,
      }
    : null

  async function loadHome() {
    setError("")
    try {
      const [nextAnnouncements, nextConcerns, nextEvents, summary] = await Promise.all([
        listAnnouncements(),
        listFeedConcerns("all"),
        listBarangayEventCalendar(),
        getResidentDashboardSummary().catch(() => null),
      ])
      setAnnouncements(nextAnnouncements)
      setConcerns(nextConcerns)
      setEvents(nextEvents)
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

  useEffect(() => {
    if (authLoading) return
    const initialLoad = window.setTimeout(() => void loadHomeRef.current(), 0)
    function refresh() {
      void loadHomeRef.current()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [authLoading])

  async function handleVote(post: Concern) {
    const nextVote = post.user_vote === 1 ? 0 : 1
    const result = await voteConcern(post.id, nextVote)
    setConcerns((items) =>
      items.map((item) =>
        item.id === post.id
          ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count }
          : item,
      ),
    )
  }

  async function submitComment(postId: number, body: string, parentId?: number | null) {
    const trimmed = body.trim()
    if (!trimmed) return
    try {
      await commentOnConcern(postId, {
        body: trimmed,
        parent: parentId ?? null,
      })
      await loadHome()
      setExpandedComments((current) => new Set(current).add(postId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post comment.")
    }
  }

  async function saveCommentEdit(postId: number, commentId: number, body: string) {
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
      toast.error(err instanceof Error ? err.message : "Could not update comment.")
    }
  }

  async function removeComment(postId: number, commentId: number) {
    if (!window.confirm("Delete this comment?")) return
    try {
      await deleteConcernComment(postId, commentId)
      await loadHome()
      toast.success("Comment deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete comment.")
    }
  }

  useEffect(() => {
    if (feedTab !== "nearby" && feedTab !== "for_you") return
    if (origin || !navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) {
          setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude })
        }
      },
      () => void 0,
      { maximumAge: 300_000, timeout: 8_000 },
    )
    return () => {
      cancelled = true
    }
  }, [feedTab, origin])

  const sortedConcerns = useMemo(
    () => rankFeed(concerns, feedTab, origin),
    [concerns, feedTab, origin],
  )

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
        .resident-home-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-mobile-top { display: block; }
          .resident-home-desktop-grid { display: block !important; }
          .resident-home-rail { display: none !important; }
        }
        /* Live Carto-light map badge; scan rings only on the green status dot */
        .rail-live-dot {
          position: relative;
          display: inline-flex;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
        }
        .rail-live-dot__map {
          position: relative;
          z-index: 1;
          width: 40px;
          height: 40px;
          overflow: hidden;
          border-radius: 9999px;
          background: #e8eef5;
        }
        .rail-live-dot__map img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        /* Green live dot — centered on the map; rings attach only to this dot */
        .rail-live-dot__status-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 2;
          width: 12px;
          height: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
        }
        .rail-live-dot__status {
          position: relative;
          z-index: 2;
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          background: var(--color-brand-navy);
          border: 1.5px solid #fff;
          box-shadow: 0 0 0 1px rgb(7 20 95 / 0.25);
        }
        .rail-live-dot__status--alert {
          background: var(--color-sos);
          box-shadow: 0 0 0 1px rgb(242 59 53 / 0.35);
        }
        .rail-live-dot__ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 10px;
          margin-left: -5px;
          margin-top: -5px;
          border-radius: 9999px;
          border: 1.5px solid rgba(34, 197, 94, 0.55);
          animation: rail-live-scan 3.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
          pointer-events: none;
        }
        .rail-live-dot__ring--alert {
          border-color: rgba(239, 68, 68, 0.6);
        }
        .rail-live-dot__ring--delay {
          animation-delay: 1.9s;
        }
        @keyframes rail-live-scan {
          0% {
            transform: scale(1);
            opacity: 0.65;
          }
          70% {
            transform: scale(2.6);
            opacity: 0;
          }
          100% {
            transform: scale(2.6);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rail-live-dot__ring { animation: none; opacity: 0.3; transform: scale(1.4); }
        }
      `}</style>
      {/* Mobile top: map+status dot · Marikina Heights · notif · avatar */}
      <header className="resident-mobile-top sticky top-0 z-30 bg-white">
        <div className="flex h-12 items-center gap-2 px-4">
          <Link
            to="/dashboard/alerts-map"
            className="rail-live-dot shrink-0 no-underline"
            aria-label={
              hasOngoingAlerts
                ? `Live map — ${barangayActiveEmergencies} ongoing alert${barangayActiveEmergencies === 1 ? "" : "s"}`
                : "Live map — Marikina Heights"
            }
            title="Open alerts map"
          >
            <span className="rail-live-dot__map">
              <img src={railMapSrc} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="rail-live-dot__status-wrap">
              <span
                className={cn(
                  "rail-live-dot__ring",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "rail-live-dot__ring rail-live-dot__ring--delay",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "rail-live-dot__status",
                  hasOngoingAlerts && "rail-live-dot__status--alert",
                )}
                aria-hidden
              />
            </span>
          </Link>
          <p className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900">
            {BARANGAY}
          </p>

          <ResidentNotificationsButton />
          <ProfileAccountMenu
            placeLabel={BARANGAY}
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
      <ResidentContentGrid className="resident-home-desktop-grid min-w-0 flex-1 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 max-lg:pt-3.5 lg:pb-8 lg:pt-3">
        {/* CENTER feed column */}
        <div className="min-w-0 w-full max-lg:px-3.5">


          {/* Composer — mobile: rounded pill (avatar→Report); filter sits beside outside */}
          <ComposerCard
            user={sessionUserAsPublic}
            onOpenComposer={() => setCreateOpen(true)}
            onOpenFilter={() => setFeedFilterOpen(true)}
          />

          {/* Desktop: inline chips only */}
          <div className="mb-3 hidden flex-wrap items-center gap-1.5 lg:flex">
            {FEED_TABS.map((tab) => {
              const active = feedTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedTab(tab.id)}
                  className={cn(
                    "h-8 rounded-sm border-2 px-3.5 text-[13px] font-semibold transition-colors outline-none",
                    "focus-visible:border-brand-navy focus-visible:text-brand-navy",
                    active
                      ? "border-brand-navy bg-white text-brand-navy"
                      : "border-card-line-strong bg-white text-neutral-600 hover:border-brand-navy hover:bg-neutral-50 hover:text-brand-navy",
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {error ? <p className="mb-3 text-[15px] text-destructive">{error}</p> : null}

          {hasOngoingAlerts ? (
            <Link
              to="/dashboard/alerts-map"
              className="mb-3 flex items-center gap-3 rounded-2xl border border-sos/30 bg-sos/10 px-3.5 py-3 no-underline transition-colors hover:bg-sos/10/80 lg:mb-2.5 lg:rounded-lg lg:border"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sos/10 text-sos">
                <AlertTriangleIcon className="size-5" strokeWidth={2.25} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-sos">
                  {barangayActiveEmergencies} ongoing alert
                  {barangayActiveEmergencies === 1 ? "" : "s"} in {BARANGAY}
                </span>
                <span className="mt-0.5 block text-[13px] font-medium text-sos/90">
                  See concerns, emergencies, and announcements on the map
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-sos" strokeWidth={2} />
            </Link>
          ) : null}

          <div className="flex flex-col gap-3 lg:gap-2.5">
            <AnnouncementCarousel announcements={announcements} />

            {sortedConcerns.map((post) => (
              <FeedPostCard
                key={post.id}
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
            ))}

            {sortedConcerns.length === 0 && concerns.length > 0 && !error ? (
              <div className="rounded-lg border border-neutral-200 bg-white px-5 py-8 text-center">
                <p className="text-[15px] font-semibold text-neutral-700">
                  {feedTab === "nearby"
                    ? "Nothing reported within 1.5 km of you."
                    : "No posts match this filter."}
                </p>
                <button
                  type="button"
                  onClick={() => setFeedTab("recent")}
                  className="mt-2 text-[14px] font-semibold text-brand-orange"
                >
                  Show all recent posts
                </button>
              </div>
            ) : null}

            {announcements.length === 0 && concerns.length === 0 && !error ? (
              <div className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white px-6 py-10 text-center">
                <img
                  src="/contents/feed-header.webp"
                  alt=""
                  className="mb-4 h-44 w-auto max-w-[90%] object-contain opacity-95 sm:h-52"
                />
                <p className="text-[15px] font-semibold text-neutral-700">Nothing in the feed yet.</p>
                <p className="mt-1 text-[14px] text-neutral-500">
                  Be the first to post in {BARANGAY}.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT RAIL — sticky while feed scrolls */}
        <HomeRail
          hasOngoingAlerts={hasOngoingAlerts}
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
          <div className="rounded-t-3xl border border-neutral-200 border-b-0 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.14)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300" />
            <h2 className="mb-2 px-1 text-[20px] font-bold tracking-tight text-neutral-900">
              Filter by
            </h2>
            <ul className="pb-2">
              {FEED_TABS.map((tab) => {
                const active = feedTab === tab.id
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedTab(tab.id)
                        setFeedFilterOpen(false)
                      }}
                      className="flex min-h-12 w-full items-center justify-between px-1 py-3 text-left text-[16px] text-neutral-800 transition-colors hover:bg-neutral-50"
                    >
                      <span className={cn(active && "font-semibold text-neutral-900")}>
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