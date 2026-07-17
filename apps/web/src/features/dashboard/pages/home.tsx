import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowBigUpIcon,
  AtSignIcon,
  CalendarDaysIcon,
  CameraIcon,
  ChevronRightIcon,
  FileTextIcon,
  FlagIcon,
  GlobeIcon,
  ImageIcon,
  MapPinIcon,
  MessageCircleIcon,
  PencilIcon,
  ShareIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  commentOnConcern,
  flagConcern,
  listAnnouncements,
  listFeedConcerns,
  listTodayBarangayEvents,
  voteConcern,
  type Announcement,
  type BarangayEvent,
  type Concern,
  type PublicUser,
} from "@/features/dashboard/api"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useResidentSearch } from "@/features/dashboard/components/resident-search-context"
import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
  RESIDENT_FEED_MAX,
  RESIDENT_RAIL_W,
} from "@/features/dashboard/components/resident-top-bar"
import { RotatingSearchField } from "@/features/dashboard/components/rotating-search-field"
import { usePageTitle } from "@/hooks/use-page-title"

/** Type scale — bumped larger for readability (shared with sidebar nav sizing) */
const FS = {
  logo: "text-[20px]",
  place: "text-[19px]",
  search: "text-[16px]",
  composer: "text-[16px]",
  chip: "text-[15px]",
  author: "text-[16px]",
  meta: "text-[14px]",
  body: "text-[16px]",
  railTitle: "text-[16px]",
  railBody: "text-[15px]",
  railLink: "text-[13px]",
  engage: "text-[15px]",
  label: "text-[12px]",
  footer: "text-[15px]",
  /** Sidebar / primary nav + Report CTA */
  sidebar: "text-[16px]",
  section: "text-[17px]",
} as const

const IC = {
  /** 22px — sidebar / primary UI icons */
  md: "size-[22px]",
  /** 20px — engagement, search, chrome */
  sm: "size-5",
  /** 18px — meta / chevrons */
  xs: "size-[18px]",
  /** 16px — tiny meta (globe) */
  xxs: "size-4",
} as const

const STROKE = 1.5

const reportReasons = [
  "Spam or off topic",
  "Hate speech or harassment",
  "False or misleading content",
  "Others (please specify)",
] as const

const FEED_TABS = [
  { id: "for_you", label: "For you" },
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" },
] as const

type FeedTab = (typeof FEED_TABS)[number]["id"]

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: PublicUser | null
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  // Letter-only avatars (no image)
  const sizeClass =
    size === "sm"
      ? "size-9 text-[16px]"
      : size === "lg"
        ? "size-11 text-[18px]"
        : "size-10 text-[17px]"

  const letter = (
    user?.full_name?.[0] ||
    user?.initials?.[0] ||
    "?"
  ).toUpperCase()

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        sizeClass,
        className,
      )}
    >
      {letter}
    </span>
  )
}

const GET_STARTED_KEY = "eboses-home-get-started-dismissed"
const BARANGAY = "Marikina Heights"

/** Match Nextdoor column proportions (shared with top bar search) */
const FEED_MAX = RESIDENT_FEED_MAX
const RAIL_W = RESIDENT_RAIL_W

/** Extra-large chevrons on rail action rows (Nextdoor-style) */
const RAIL_CHEVRON = "size-7 shrink-0"

/**
 * Prefer the street line under Marikina Heights.
 * Address is typically: "123 Champaca Street, Marikina Heights, Marikina City"
 */
function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}

export default function HomePage() {
  usePageTitle("Home")
  const { user, loading: authLoading } = useAuthSession()
  const { search, setSearch } = useResidentSearch()
  const [createOpen, setCreateOpen] = useState(false)
  const [feedTab, setFeedTab] = useState<FeedTab>("for_you")
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [getStartedOpen, setGetStartedOpen] = useState(() => {
    try {
      return localStorage.getItem(GET_STARTED_KEY) !== "1"
    } catch {
      return true
    }
  })
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({})
  const [reportOpen, setReportOpen] = useState<number | null>(null)
  const [reportReason, setReportReason] = useState("")
  const [reportOther, setReportOther] = useState("")
  const [flaggingPost, setFlaggingPost] = useState<number | null>(null)

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"

  const streetLabel = streetLabelFromAddress(user?.address)

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
      const [nextAnnouncements, nextConcerns, nextEvents] = await Promise.all([
        listAnnouncements(),
        listFeedConcerns("all", undefined, undefined, search || undefined),
        listTodayBarangayEvents(),
      ])
      setAnnouncements(nextAnnouncements)
      setConcerns(nextConcerns)
      setEvents(nextEvents)
    } catch {
      setError("Could not load home feed.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (authLoading) return
    void loadHome()
    function refresh() {
      void loadHome()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [authLoading, search])

  function dismissGetStarted() {
    setGetStartedOpen(false)
    try {
      localStorage.setItem(GET_STARTED_KEY, "1")
    } catch {
      /* ignore */
    }
  }

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

  async function submitComment(postId: number) {
    const body = commentInputs[postId]?.trim()
    if (!body) return
    await commentOnConcern(postId, { body })
    setCommentInputs((current) => ({ ...current, [postId]: "" }))
    await loadHome()
    setExpandedComments((current) => new Set(current).add(postId))
  }

  async function submitFlag(postId: number) {
    const reason = reportReason === "Others (please specify)" ? reportOther.trim() : reportReason
    if (!reason) {
      toast.error("Choose a reason before submitting.")
      return
    }
    setFlaggingPost(postId)
    try {
      await flagConcern(postId, { reason, note: reportOther.trim() })
      toast.success("Post flagged for review")
      setReportOpen(null)
      setReportReason("")
      setReportOther("")
    } catch (flagError) {
      toast.error(flagError instanceof Error ? flagError.message : "Could not flag this post.")
    } finally {
      setFlaggingPost(null)
    }
  }

  const sortedConcerns = useMemo(() => {
    const list = [...concerns]
    if (feedTab === "trending") {
      return list.sort(
        (a, b) => b.vote_count + b.comment_count - (a.vote_count + a.comment_count),
      )
    }
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [concerns, feedTab])

  if (!loaded) {
    return (
      <div className="min-h-0 flex-1 bg-white">
        <div className="px-4 py-3">
          <Skeleton className="mx-auto h-10 w-full max-w-md rounded-full" />
        </div>
        <div
          className="mx-auto grid w-full gap-4 p-4 md:px-5"
          style={{
            maxWidth: FEED_MAX + RAIL_W + 16,
            gridTemplateColumns: `minmax(0, ${FEED_MAX}px) ${RAIL_W}px`,
          }}
        >
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <div className="hidden min-w-0 space-y-3 md:block">
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
        .resident-mobile-only { display: none; }
        .resident-home-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-mobile-top { display: block; }
          .resident-mobile-only { display: block; }
          .resident-home-desktop-grid { display: block !important; }
          .resident-home-rail { display: none !important; }
        }
      `}</style>
      <header className="resident-mobile-top sticky top-0 z-30 bg-white">
        <div className="flex h-12 items-center gap-2 px-3">
          <p className={cn("min-w-0 flex-1 truncate font-bold tracking-tight text-neutral-900", FS.place)}>
            {BARANGAY}
          </p>
          <NotificationPopover />
          <ProfileAccountMenu placeLabel={BARANGAY} />
        </div>
        <div className="px-3 py-2">
          <RotatingSearchField
            value={search}
            onChange={setSearch}
            maxWidth="100%"
            inputClassName="h-10 bg-neutral-50"
          />
        </div>
      </header>

      {/*
        EXACT same ResidentContentGrid as main top bar — avatar right edge = rail right edge.
      */}
      <ResidentContentGrid className="resident-home-desktop-grid min-w-0 flex-1 pb-28 pt-3 md:pb-8">
        {/* CENTER feed column */}
        <div className="min-w-0 w-full">
          {/* Composer — taller Nextdoor density */}
          <section className="mb-2 w-full rounded-lg border-[1.5px] border-[#d0d0d0] bg-white px-3.5 py-3.5">
            <div className="flex min-h-12 items-center gap-2.5">
              <UserAvatar user={sessionUserAsPublic} size="md" className="size-10 text-[17px]" />
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className={cn(
                  "min-h-11 min-w-0 flex-1 rounded-md bg-neutral-100 px-4 py-2.5 text-left font-normal text-neutral-600 transition-colors hover:bg-neutral-200/70",
                  "text-[15px]",
                )}
              >
                What&apos;s happening in your barangay?
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="hidden size-10 shrink-0 items-center justify-center rounded-md text-[#07145f] transition-colors hover:bg-[#07145f]/8 sm:flex"
                aria-label="Add photo"
              >
                <ImageIcon className="size-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-10 shrink-0 rounded-[9999px] bg-[#ff6a1a] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#e85f12] active:scale-[0.98] sm:px-6"
              >
                Report
              </button>
            </div>
          </section>

          {/* Filter chips — tight under composer */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {FEED_TABS.map((tab) => {
              const active = feedTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedTab(tab.id)}
                  className={cn(
                    "h-8 rounded-sm border-2 px-3.5 text-[13px] font-semibold transition-colors outline-none",
                    "focus-visible:border-[#07145f] focus-visible:text-[#07145f]",
                    active
                      ? "border-[#07145f] bg-white text-[#07145f]"
                      : "border-[#d0d0d0] bg-white text-neutral-600 hover:border-[#07145f] hover:bg-neutral-50 hover:text-[#07145f]",
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {getStartedOpen ? (
            <section className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <h2 className={cn("font-bold text-neutral-900", FS.section)}>Get started on E-Boses</h2>
                <button
                  type="button"
                  onClick={dismissGetStarted}
                  className="flex size-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                  aria-label="Dismiss"
                >
                  <XIcon className={IC.xs} strokeWidth={STROKE} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-3">
                <GetStartedCard
                  icon={<PencilIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Report a concern"
                  body="Tell the barangay about issues near you."
                  cta="Report"
                  onClick={() => setCreateOpen(true)}
                />
                <GetStartedCard
                  icon={<FileTextIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Track your reports"
                  body="Follow status updates on what you submitted."
                  cta="View reports"
                  to="/dashboard/reports"
                />
                <GetStartedCard
                  icon={<AlertTriangleIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Emergency SOS"
                  body="Get urgent help from barangay responders."
                  cta="How it works"
                  onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
                />
              </div>
            </section>
          ) : null}

          {events.length > 0 ? (
            <section className="resident-mobile-only mb-3 rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5">
              <div className="flex items-center gap-2 text-[#07145f]">
                <CalendarDaysIcon className="size-5" strokeWidth={STROKE} />
                <h2 className="text-[16px] font-bold">Today in your barangay</h2>
              </div>
              <div className="mt-3 divide-y divide-neutral-200">
                {events.map((event) => (
                  <div key={event.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-[15px] font-bold text-neutral-900">{event.title}</p>
                    <p className="mt-1 text-[14px] leading-5 text-neutral-600">{event.detail}</p>
                    <p className="mt-1 text-[13px] font-medium text-[#07145f]">
                      {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {error ? <p className="mb-3 text-[15px] text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2.5">
            {announcements.map((announcement) => (
              <article
                key={`a-${announcement.id}`}
                className="rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5"
              >
                <div className="flex gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff1ea]">
                    <img src="/contents/announcements.png" alt="" className="size-5 object-contain" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={cn("truncate font-bold text-neutral-900", FS.author)}>
                          Barangay Hall
                        </p>
                        <p
                          className={cn(
                            "flex flex-wrap items-center gap-1 text-neutral-500",
                            FS.meta,
                          )}
                        >
                          <span>{BARANGAY}</span>
                          <span>·</span>
                          <span>{announcement.date_label}</span>
                          <GlobeIcon className={IC.xxs} strokeWidth={STROKE} />
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-md bg-[#fff1ea] px-1.5 py-0.5 font-bold uppercase text-[#ff6a1a]",
                          FS.label,
                        )}
                      >
                        {announcement.tag || "Announcement"}
                      </span>
                    </div>
                    <h3 className={cn("mt-2 font-bold leading-snug text-neutral-900", FS.body)}>
                      {announcement.title}
                    </h3>
                    <p className={cn("mt-1 leading-relaxed text-neutral-800", FS.body)}>
                      {announcement.body}
                    </p>
                  </div>
                </div>
              </article>
            ))}

            {sortedConcerns.map((post) => {
              const isExpanded = expandedComments.has(post.id)
              const reporterStreet = streetLabelFromAddress(post.reporter.street)
              return (
                <article
                  key={post.id}
                  className="rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5"
                >
                  <div className="flex gap-2.5">
                    <UserAvatar user={post.reporter} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn("truncate font-bold text-neutral-900", FS.author)}>
                            {post.reporter.full_name}
                          </p>
                          <p
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 overflow-hidden text-neutral-500",
                              FS.meta,
                            )}
                          >
                            {reporterStreet ? (
                              <>
                                <span className="min-w-0 truncate">{reporterStreet}</span>
                                <span className="shrink-0" aria-hidden>
                                  ·
                                </span>
                              </>
                            ) : null}
                            <span className="shrink-0">{categoryLabel(post.category)}</span>
                            <span className="shrink-0" aria-hidden>
                              ·
                            </span>
                            <span className="shrink-0">{timeAgo(post.created_at)}</span>
                            <GlobeIcon className={cn(IC.xxs, "shrink-0")} strokeWidth={STROKE} />
                          </p>
                        </div>
                        <Popover
                          open={reportOpen === post.id}
                          onOpenChange={(open) => {
                            if (!open) {
                              setReportOpen(null)
                              setReportReason("")
                              setReportOther("")
                            } else setReportOpen(post.id)
                          }}
                        >
                          <PopoverTrigger
                            className="flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            aria-label="More"
                          >
                            <span className="text-[16px] leading-none">⋯</span>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-0">
                            <div className="flex flex-col gap-3 p-4">
                              <div className="flex items-center gap-2">
                                <FlagIcon className={IC.xs} strokeWidth={STROKE} />
                                <h4 className="text-[16px] font-semibold">Report this post</h4>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                {reportReasons.map((reason) => (
                                  <label
                                    key={reason}
                                    className="flex cursor-pointer items-center gap-2 text-[14px]"
                                  >
                                    <input
                                      type="radio"
                                      name={`report-home-${post.id}`}
                                      checked={reportReason === reason}
                                      onChange={() => setReportReason(reason)}
                                    />
                                    {reason}
                                  </label>
                                ))}
                              </div>
                              {reportReason === "Others (please specify)" ? (
                                <Input
                                  value={reportOther}
                                  onChange={(e) => setReportOther(e.target.value)}
                                  placeholder="Please specify…"
                                  className="h-9 text-[14px]"
                                />
                              ) : null}
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="w-full text-[14px]"
                                disabled={flaggingPost === post.id}
                                onClick={() => void submitFlag(post.id)}
                              >
                                {flaggingPost === post.id ? "Submitting…" : "Submit report"}
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>

                      <p className={cn("mt-2 leading-relaxed text-neutral-900", FS.body)}>
                        {post.title}
                        {post.description ? <> {post.description}</> : null}
                      </p>

                      {post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? (
                        <img
                          src={post.media[0].preview_url}
                          alt=""
                          className="mt-2.5 max-h-72 w-full rounded-xl object-cover"
                        />
                      ) : null}

                      {/* Engagement + comment — FB-style (screenshot) */}
                      <div className="mt-3 space-y-2.5">
                        {/* Top: circular action icons — flush left like screenshot */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleVote(post)}
                            aria-label={post.user_vote === 1 ? "Remove upvote" : "Upvote"}
                            aria-pressed={post.user_vote === 1}
                            className={cn(
                              "group inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2 text-neutral-500 transition-colors",
                              "hover:bg-neutral-200 hover:text-[#ff6a1a]",
                              "active:bg-neutral-200 active:text-[#ff6a1a]",
                              post.user_vote === 1 && "bg-[#fff1ea] text-[#ff6a1a]",
                            )}
                          >
                            <ArrowBigUpIcon
                              className={cn(
                                "size-5 shrink-0 transition-[fill,color]",
                                "fill-none group-hover:fill-current group-active:fill-current",
                                post.user_vote === 1 && "fill-current",
                              )}
                              strokeWidth={STROKE}
                            />
                            {post.vote_count > 0 ? (
                              <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                                {post.vote_count}
                              </span>
                            ) : null}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setExpandedComments((prev) => {
                                const next = new Set(prev)
                                next.add(post.id)
                                return next
                              })
                              window.requestAnimationFrame(() => {
                                document.getElementById(`home-comment-${post.id}`)?.focus()
                              })
                            }}
                            aria-label="Comment"
                            className={cn(
                              "group inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2 text-neutral-500 transition-colors",
                              "hover:bg-neutral-200 hover:text-[#2447b3]",
                              "active:bg-neutral-200 active:text-[#2447b3]",
                              isExpanded && "bg-[#eef3ff] text-[#2447b3]",
                            )}
                          >
                            <MessageCircleIcon
                              className={cn(
                                "size-5 shrink-0 transition-[fill,color]",
                                "fill-none group-hover:fill-current group-active:fill-current",
                                isExpanded && "fill-current",
                              )}
                              strokeWidth={STROKE}
                            />
                            {post.comment_count > 0 ? (
                              <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                                {post.comment_count}
                              </span>
                            ) : null}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(
                                `${window.location.origin}/dashboard/home`,
                              )
                              toast.success("Link copied")
                            }}
                            aria-label="Share"
                            className={cn(
                              "group ml-auto inline-flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors",
                              "hover:bg-neutral-200 hover:text-neutral-800",
                              "active:bg-neutral-200 active:text-neutral-800",
                            )}
                          >
                            <ShareIcon
                              className="size-5 fill-none transition-[fill,color] group-hover:fill-current group-active:fill-current"
                              strokeWidth={STROKE}
                            />
                          </button>
                        </div>

                        {/* Existing comments */}
                        {isExpanded && post.comments.length > 0 ? (
                          <div className="space-y-2 pt-0.5">
                            {post.comments.map((c) => (
                              <div key={c.id} className="flex gap-2">
                                <UserAvatar user={c.author} size="sm" className="size-8 text-[14px]" />
                                <div className="min-w-0 flex-1 rounded-2xl bg-neutral-100 px-3 py-1.5">
                                  <p className="text-[14px] font-bold text-neutral-900">
                                    {c.author.full_name}{" "}
                                    <span className="font-medium text-neutral-400">
                                      {timeAgo(c.created_at)}
                                    </span>
                                  </p>
                                  <p className="text-[15px] text-neutral-700">{c.body}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Composer: avatar + pill input */}
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            user={sessionUserAsPublic}
                            size="sm"
                            className="size-8 text-[14px]"
                          />
                          <input
                            id={`home-comment-${post.id}`}
                            type="text"
                            value={commentInputs[post.id] ?? ""}
                            onChange={(e) =>
                              setCommentInputs((prev) => ({
                                ...prev,
                                [post.id]: e.target.value,
                              }))
                            }
                            onFocus={() =>
                              setExpandedComments((prev) => new Set(prev).add(post.id))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                void submitComment(post.id)
                              }
                            }}
                            placeholder="Add a comment..."
                            className={cn(
                              "h-10 min-w-0 flex-1 rounded-full border border-neutral-200 bg-white px-4 text-[15px] text-neutral-900 outline-none",
                              "placeholder:text-neutral-400",
                              "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
                            )}
                          />
                        </div>

                        {/* Bottom: attach icons + Comment — flush left (same edge as upvote row) */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Add photo"
                            onClick={() =>
                              toast.info("Photo attachments on comments coming soon.")
                            }
                            className={cn(
                              "group inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors",
                              "hover:bg-neutral-100 hover:text-neutral-700",
                              "active:bg-neutral-100 active:text-neutral-700",
                            )}
                          >
                            <CameraIcon
                              className="size-[18px] fill-none transition-[fill,color] group-hover:fill-current group-active:fill-current"
                              strokeWidth={STROKE}
                            />
                          </button>
                          <button
                            type="button"
                            aria-label="Add location"
                            onClick={() => toast.info("Location on comments coming soon.")}
                            className={cn(
                              "group inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors",
                              "hover:bg-neutral-100 hover:text-neutral-700",
                              "active:bg-neutral-100 active:text-neutral-700",
                            )}
                          >
                            <MapPinIcon
                              className="size-[18px] fill-none transition-[fill,color] group-hover:fill-current group-active:fill-current"
                              strokeWidth={STROKE}
                            />
                          </button>
                          <button
                            type="button"
                            aria-label="Mention someone"
                            onClick={() => toast.info("Mentions coming soon.")}
                            className={cn(
                              "group inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors",
                              "hover:bg-neutral-100 hover:text-neutral-700",
                              "active:bg-neutral-100 active:text-neutral-700",
                            )}
                          >
                            <AtSignIcon
                              className="size-[18px] fill-none transition-[fill,color] group-hover:fill-current group-active:fill-current"
                              strokeWidth={STROKE}
                            />
                          </button>

                          <button
                            type="button"
                            disabled={!(commentInputs[post.id] ?? "").trim()}
                            onClick={() => void submitComment(post.id)}
                            className={cn(
                              "ml-auto h-8 rounded-full px-4 text-[14px] font-semibold transition-colors",
                              (commentInputs[post.id] ?? "").trim()
                                ? "bg-neutral-800 text-white hover:bg-neutral-900 active:bg-neutral-900"
                                : "cursor-not-allowed bg-neutral-100 text-neutral-400",
                            )}
                          >
                            Comment
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}

            {announcements.length === 0 && sortedConcerns.length === 0 && !error ? (
              <div className="flex flex-col items-center rounded-lg border-[1.5px] border-solid border-[#d0d0d0] bg-white px-6 py-10 text-center">
                <img
                  src="/contents/feed-header.png"
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

        {/* RIGHT RAIL — Nextdoor-style location + CTA cards */}
        <aside className="resident-home-rail flex w-full min-w-0 flex-col gap-2.5">
          <div className="overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white">
            <div className="min-w-0 px-3.5 py-3">
              <p className={cn("truncate font-semibold text-neutral-900", FS.railTitle)}>
                {BARANGAY}
              </p>
              {streetLabel ? (
                <p className={cn("truncate font-normal text-neutral-500", FS.meta)}>{streetLabel}</p>
              ) : null}
            </div>
            <Link
              to="/dashboard/reports"
              className={cn(
                "flex items-center justify-between border-t border-[#ececec] px-3.5 py-2.5 font-semibold text-[#07145f] no-underline transition-colors hover:bg-[#07145f]/5",
                FS.railLink,
              )}
            >
              <span>See all alerts</span>
              <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-[#07145f]")} strokeWidth={2} />
            </Link>
          </div>

          {events.length > 0 ? (
            <section className="overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5">
              <div className="flex items-center gap-2 text-[#07145f]">
                <CalendarDaysIcon className="size-5" strokeWidth={STROKE} />
                <h2 className={cn("font-bold", FS.railTitle)}>Today</h2>
              </div>
              <div className="mt-2 divide-y divide-neutral-200">
                {events.slice(0, 3).map((event) => (
                  <div key={event.id} className="py-2.5 first:pt-1 last:pb-0">
                    <p className={cn("font-bold text-neutral-900", FS.railBody)}>{event.title}</p>
                    <p className={cn("mt-0.5 text-neutral-500", FS.meta)}>
                      {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white">
            <div className="p-3">
              <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-[#e8f0fa]">
                <img
                  src="/contents/marikina-area-2.png"
                  alt="Marikina City landmark"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="px-3.5 pb-3">
              <p className={cn("font-bold text-neutral-900", FS.railTitle)}>
                Report a local concern
              </p>
              <p className={cn("mt-1 leading-relaxed text-neutral-600", FS.railBody)}>
                Share issues with neighbors and barangay officials so they can take action.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className={cn(
                "flex w-full items-center justify-between border-t border-[#ececec] px-3.5 py-2.5 text-left font-semibold text-[#07145f] transition-colors hover:bg-[#07145f]/5",
                FS.railLink,
              )}
            >
              <span>Report</span>
              <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-[#07145f]")} strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
            className="flex w-full items-center justify-between rounded-lg border-[1.5px] border-red-400 bg-red-50/80 px-3.5 py-3 text-left transition-colors hover:border-red-500 hover:bg-red-50"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-red-600 text-white">
                <AlertTriangleIcon className={IC.xs} strokeWidth={STROKE} />
              </span>
              <div>
                <p className={cn("font-bold text-red-900", FS.railTitle)}>Emergency SOS</p>
                <p className={cn("text-red-700/80", FS.meta)}>Get help from responders</p>
              </div>
            </div>
            <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-red-400")} strokeWidth={2} />
          </button>
        </aside>
      </ResidentContentGrid>

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function GetStartedCard({
  icon,
  title,
  body,
  cta,
  to,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  to?: string
  onClick?: () => void
}) {
  const inner = (
    <>
      <span className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
        {icon}
      </span>
      <p className="mt-2.5 text-[15px] font-bold leading-snug text-neutral-900">{title}</p>
      <p className="mt-1 flex-1 text-[14px] leading-relaxed text-neutral-500">{body}</p>
      <span className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-[14px] font-bold text-white">
        {cta}
      </span>
    </>
  )

  const className =
    "flex min-w-0 flex-col rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5 no-underline transition-colors hover:bg-neutral-50/80"

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cn(className, "text-left")}>
      {inner}
    </button>
  )
}
