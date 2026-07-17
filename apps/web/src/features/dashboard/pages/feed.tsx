import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  LeafIcon,
  MessageCircleIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TrafficConeIcon,
  MegaphoneIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
  commentOnConcern,
  flagConcern,
  listActiveResponders,
  listAnnouncements,
  listFeedConcerns,
  voteConcern,
  type Announcement,
  type Concern,
  type ConcernCategory,
  type ConcernComment,
  type PublicUser,
} from "@/features/dashboard/api"

const filters = ["All", "Announcements", "Infrastructure", "Environment", "Public Safety", "Others"] as const

import { computeDefaultAvatar } from "@/features/dashboard/avatar-utils"

const avatarColors = [
  "bg-primary/10 text-primary",
  "bg-secondary text-secondary-foreground",
  "bg-accent/10 text-accent",
  "bg-muted text-foreground",
  "bg-primary/15 text-primary",
  "bg-secondary/70 text-secondary-foreground",
]

const avatarGrey = "bg-muted text-muted-foreground"

const reportReasons = [
  "Spam or off topic",
  "Hate speech or harassment",
  "False or misleading content",
  "Others (please specify)",
] as const

const filterCategoryMap: Record<string, ConcernCategory | "all"> = {
  All: "all",
  Infrastructure: "infrastructure",
  Environment: "environment",
  "Public Safety": "public_safety",
  Others: "others",
}

const categoryStyles: Record<ConcernCategory, { icon: typeof WrenchIcon; bg: string; text: string; label: string }> = {
  infrastructure: { icon: TrafficConeIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", label: "Infrastructure" },
  environment: { icon: LeafIcon, bg: "bg-[#e9f9ef]", text: "text-[#16a34a]", label: "Environment" },
  public_safety: { icon: ShieldCheckIcon, bg: "bg-[#ffeceb]", text: "text-[#ff5003]", label: "Public Safety" },
  others: { icon: SearchIcon, bg: "bg-[#fff1ea]", text: "text-[#ff6a1a]", label: "Others" },
}

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function responderRoleLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function Avatar({ user }: { user: PublicUser }) {
  const online = Boolean(user.last_seen_at)
  const avatarKey = computeDefaultAvatar(user)
  // Use user.id for deterministic color instead of index
  const colorIdx = user.id % avatarColors.length
  return (
    <div className="relative inline-flex shrink-0 self-start overflow-visible">
      <div className={cn("flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-bold", online ? avatarColors[colorIdx] : avatarGrey)}>
        {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" /> : user.initials}
      </div>
      <span className={cn("absolute bottom-0 right-0 z-10 size-3 translate-x-1/4 translate-y-1/4 rounded-full border-2 border-card", online ? "bg-primary" : "bg-muted-foreground/50")} />
    </div>
  )
}

function CommentItem({
  postId,
  comment,
  depth = 0,
  expandedReplies,
  replyInputs,
  onToggleReply,
  onReplyInputChange,
  onSubmitReply,
}: {
  postId: number
  comment: ConcernComment
  depth?: number
  expandedReplies: Set<string>
  replyInputs: Record<string, string>
  onToggleReply: (key: string) => void
  onReplyInputChange: (key: string, value: string) => void
  onSubmitReply: (postId: number, parentId: number, key: string) => void
}) {
  const replyKey = `${postId}-${comment.id}`
  const isReplyExpanded = expandedReplies.has(replyKey)
  const nested = depth > 0

  return (
    <div className={cn(nested && "border-l-2 border-border pl-3")}>
      <div className="flex gap-2">
        <Avatar user={comment.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold text-foreground">{comment.author.full_name}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="break-words text-xs text-foreground">{comment.body}</p>
          <button type="button" onClick={() => onToggleReply(replyKey)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <ReplyIcon className="size-3" />
            Reply
            {comment.replies.length > 0 && <span>&middot; {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}</span>}
          </button>

          {isReplyExpanded && (
            <div className="mt-2 flex gap-2">
              <Input
                type="text"
                value={replyInputs[replyKey] ?? ""}
                onChange={(e) => onReplyInputChange(replyKey, e.target.value)}
                placeholder={`Reply to ${comment.author.full_name}...`}
                className="h-8 min-w-0 flex-1 text-xs"
              />
              <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary" onClick={() => onSubmitReply(postId, comment.id, replyKey)}>
                <SendIcon />
              </Button>
            </div>
          )}

          {comment.replies.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  postId={postId}
                  comment={reply}
                  depth={depth + 1}
                  expandedReplies={expandedReplies}
                  replyInputs={replyInputs}
                  onToggleReply={onToggleReply}
                  onReplyInputChange={onReplyInputChange}
                  onSubmitReply={onSubmitReply}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FeedPage() {
  usePageTitle("Feed")
  const hasLoadedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [search, setSearch] = useState("")
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [activeResponders, setActiveResponders] = useState<PublicUser[]>([])
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({})
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})
  const [reportOpen, setReportOpen] = useState<number | null>(null)
  const [reportReason, setReportReason] = useState<string>("")
  const [reportOther, setReportOther] = useState<string>("")
  const [flaggingPost, setFlaggingPost] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [filterPageSize, setFilterPageSize] = useState(() => {
    if (typeof window === "undefined") return filters.length
    if (window.innerWidth >= 1024) return filters.length
    return window.innerWidth >= 640 ? 2 : 1
  })
  const [filterStart, setFilterStart] = useState(0)

  function moveFilterRail(direction: -1 | 1) {
    setFilterStart((current) =>
      Math.min(
        filters.length - filterPageSize,
        Math.max(0, current + direction * filterPageSize),
      ),
    )
  }

  useEffect(() => {
    function syncFilterPageSize() {
      if (window.innerWidth >= 1024) setFilterPageSize(filters.length)
      else setFilterPageSize(window.innerWidth >= 640 ? 2 : 1)
    }

    window.addEventListener("resize", syncFilterPageSize)
    return () => window.removeEventListener("resize", syncFilterPageSize)
  }, [])

  useEffect(() => {
    setFilterStart((current) => Math.min(current, Math.max(0, filters.length - filterPageSize)))
  }, [filterPageSize])

  async function loadFeed() {
    if (!hasLoadedRef.current) {
      setLoaded(false)
    }
    setError("")
    try {
      const category = filterCategoryMap[activeFilter]
      const [nextConcerns, nextAnnouncements, responders] = await Promise.all([
        activeFilter === "Announcements" ? Promise.resolve([]) : listFeedConcerns(category, undefined, undefined, search),
        activeFilter === "All" || activeFilter === "Announcements" ? listAnnouncements() : Promise.resolve([]),
        listActiveResponders(),
      ])
      setConcerns(nextConcerns)
      setAnnouncements(nextAnnouncements)
      setActiveResponders(responders)
    } catch {
      setError("Could not load feed.")
    } finally {
      hasLoadedRef.current = true
      setLoaded(true)
    }
  }

  useEffect(() => {
    void loadFeed()
    function refresh() { void loadFeed() }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [activeFilter, search])

  if (!loaded)
    return (
      <div className="flex flex-col">
        <Topbar />
        <div className="flex-1 p-4 md:p-10">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="mt-6 flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-72 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )

  async function handleVote(post: Concern) {
    const nextVote = post.user_vote === 1 ? 0 : 1
    const result = await voteConcern(post.id, nextVote)
    setConcerns((items) =>
      items.map((item) =>
        item.id === post.id ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count } : item,
      ),
    )
  }

  async function submitComment(postId: number) {
    const body = commentInputs[postId]?.trim()
    if (!body) return
    await commentOnConcern(postId, { body })
    setCommentInputs((current) => ({ ...current, [postId]: "" }))
    await loadFeed()
    setExpandedComments((current) => new Set(current).add(postId))
  }

  async function submitReply(postId: number, parent: number, key: string) {
    const body = replyInputs[key]?.trim()
    if (!body) return
    await commentOnConcern(postId, { body, parent })
    setReplyInputs((current) => ({ ...current, [key]: "" }))
    await loadFeed()
    setExpandedComments((current) => new Set(current).add(postId))
    setExpandedReplies((current) => new Set(current).add(key))
  }

  function updateReplyInput(key: string, value: string) {
    setReplyInputs((prev) => ({ ...prev, [key]: value }))
  }

  function toggleComments(postId: number) {
    setExpandedComments((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function toggleReplies(key: string) {
    setExpandedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  const trendingConcerns = [...concerns]
    .sort((a, b) => b.vote_count - a.vote_count || b.priority_score - a.priority_score)
    .slice(0, 5)

  return (
    <div className="flex flex-col">
      <Topbar />

      <div className="flex-1 bg-[#f7f8fc] p-4 md:p-8 xl:p-10">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0">
            <div className="grid items-center gap-5 md:grid-cols-[minmax(0,0.72fr)_minmax(320px,1fr)]">
              <div>
                <p className="text-sm font-bold text-[#2447b3]">Marikina Heights</p>
                <h1 className="mt-2 font-heading text-3xl font-extrabold leading-tight text-[#07145f] md:text-4xl">
                  Community Feed
                </h1>
                <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-[#43507f]">
                  Stay informed with the latest announcements, updates, and community concerns in your barangay.
                </p>
              </div>
              <img src="/contents/feed-header.png" alt="" className="mx-auto h-32 w-full object-contain md:h-40" />
            </div>

            <div className="mt-7">
              <div className="flex w-full min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => moveFilterRail(-1)}
                  disabled={filterStart === 0}
                  className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white text-[#07145f] transition-colors hover:text-[#ff6a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a1a]/30 disabled:cursor-default disabled:opacity-35 lg:hidden"
                  aria-label="Show previous filters"
                >
                  <ChevronLeftIcon className="size-5" />
                </button>
                <div
                  className="grid min-w-0 flex-1 gap-3"
                  style={{ gridTemplateColumns: `repeat(${filterPageSize}, minmax(0, 1fr))` }}
                >
                    {filters.slice(filterStart, filterStart + filterPageSize).map((f) => (
                      <button
                        key={f}
                        data-filter-option
                        type="button"
                        aria-pressed={activeFilter === f}
                        onClick={() => setActiveFilter(f)}
                        className={cn(
                          "h-10 min-w-0 rounded-full border px-3 text-sm font-bold transition-colors whitespace-nowrap sm:px-6",
                          activeFilter === f
                            ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                            : "border-[#cbd8ee] bg-white text-[#07145f] hover:border-[#ff6a1a] hover:text-[#ff6a1a]",
                        )}
                      >
                        {f}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => moveFilterRail(1)}
                  disabled={filterStart + filterPageSize >= filters.length}
                  className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white text-[#07145f] transition-colors hover:text-[#ff6a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a1a]/30 disabled:cursor-default disabled:opacity-35 lg:hidden"
                  aria-label="Show next filters"
                >
                  <ChevronRightIcon className="size-5" />
                </button>
              </div>
            </div>

            {activeFilter !== "Announcements" ? (
              <div className="mt-5 flex gap-3">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#2447b3]" />
                  <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search posts, concerns, or keywords"
                    className="h-12 rounded-lg border-[#cbd8ee] bg-white pl-12 text-sm font-semibold text-[#07145f] placeholder:text-[#8b96b8] focus-visible:border-[#ff6a1a] focus-visible:ring-[#ff6a1a]/20"
                    aria-label="Search validated community concerns"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter("All")
                    setSearch("")
                  }}
                  className="hidden h-12 items-center gap-2 rounded-lg border border-[#cbd8ee] bg-white px-5 text-sm font-bold text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a] sm:inline-flex"
                >
                  <SlidersHorizontalIcon className="size-4" />
                  Reset
                </button>
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-3">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              {announcements.map((announcement) => (
                <article key={`announcement-${announcement.id}`} className="rounded-2xl border border-[#dfe7f5] bg-white p-4 shadow-sm">
                  <div className="grid gap-4 md:grid-cols-[64px_minmax(0,1fr)_120px_150px] md:items-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-[#fff1ea] text-[#2447b3]">
                      <MegaphoneIcon className="size-7" />
                    </div>
                    <div className="min-w-0">
                      <Badge className="mb-2 border-0 bg-[#fff1ea] text-[10px] font-extrabold uppercase text-[#ff6a1a] hover:bg-[#fff1ea]">{announcement.tag || "Announcement"}</Badge>
                      <h2 className="truncate text-lg font-extrabold text-[#07145f]">{announcement.title}</h2>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[#43507f]">{announcement.body}</p>
                      <p className="mt-2 text-xs font-bold text-[#2447b3]">Barangay Hall <span className="mx-2 text-[#8b96b8]">•</span>{announcement.date_label}</p>
                    </div>
                    <img src="/contents/feed-header.png" alt="" className="hidden h-20 w-full rounded-lg object-cover md:block" />
                    <div className="flex items-center justify-end gap-5 border-[#dfe7f5] text-[#07145f] md:border-l md:pl-6">
                      <div className="text-center">
                        <p className="text-sm font-extrabold">0</p>
                        <p className="text-xs font-semibold text-[#43507f]">Upvotes</p>
                      </div>
                      <FlagIcon className="size-5 text-[#2447b3]" />
                    </div>
                  </div>
                </article>
              ))}

              {concerns.map((post) => {
                const isExpanded = expandedComments.has(post.id)
                const style = categoryStyles[post.category]
                const CategoryIcon = style.icon
                return (
                  <article key={post.id} className="rounded-2xl border border-[#dfe7f5] bg-white p-4 shadow-sm">
                    <div className="grid gap-4 md:grid-cols-[64px_minmax(0,1fr)_120px_150px] md:items-center">
                      <div className={cn("flex size-14 items-center justify-center rounded-full", style.bg, style.text)}>
                        <CategoryIcon className="size-7" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={cn("border-0 text-[10px] font-extrabold uppercase hover:bg-transparent", style.bg, style.text)}>
                            {categoryLabel(post.category)}
                          </Badge>
                        </div>
                        <h2 className="mt-1 truncate text-lg font-extrabold text-[#07145f]">{post.title}</h2>
                        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[#43507f]">{post.description}</p>
                        <p className="mt-2 truncate text-xs font-bold text-[#2447b3]">
                          {post.reporter.full_name} <span className="mx-1 text-[#8b96b8]">•</span> Verified Resident <span className="mx-1 text-[#8b96b8]">•</span> {timeAgo(post.created_at)}
                        </p>
                      </div>

                      <div className="hidden md:block">
                        {post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? (
                          <img src={post.media[0].preview_url} alt="" className="h-20 w-full rounded-lg object-cover" />
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between gap-4 border-[#dfe7f5] md:border-l md:pl-6">
                        <div className="grid gap-3">
                          <button type="button" onClick={() => void handleVote(post)} className={cn("flex items-center gap-2 text-sm font-extrabold transition-colors", post.user_vote === 1 ? "text-[#ff6a1a]" : "text-[#2447b3] hover:text-[#ff6a1a]")}>
                            <ArrowUpIcon className="size-5" />
                            <span>{post.vote_count}</span>
                            <span className="text-xs font-semibold text-[#43507f]">Upvotes</span>
                          </button>
                          <button type="button" onClick={() => toggleComments(post.id)} className="flex items-center gap-2 text-sm font-extrabold text-[#2447b3] transition-colors hover:text-[#ff6a1a]">
                            <MessageCircleIcon className="size-5" />
                            <span>{post.comment_count}</span>
                            <span className="text-xs font-semibold text-[#43507f]">Comments</span>
                          </button>
                        </div>
                        <Popover open={reportOpen === post.id} onOpenChange={(open) => { if (!open) { setReportOpen(null); setReportReason(""); setReportOther("") } else { setReportOpen(post.id) } }}>
                        <PopoverTrigger className="flex size-9 items-center justify-center rounded-lg text-[#2447b3] transition-colors hover:bg-[#fff1ea] hover:text-[#ff6a1a]" aria-label="Flag post">
                          <FlagIcon className="size-5" />
                        </PopoverTrigger>
                        <PopoverContent className="w-72 max-sm:w-[calc(100vw-2rem)] right-0 left-auto">
                          <div className="flex flex-col gap-3 p-4">
                            <div className="flex items-center gap-2">
                              <div className="flex size-7 items-center justify-center rounded-full bg-destructive/10">
                                <FlagIcon className="size-3.5 text-destructive" />
                              </div>
                              <h4 className="flex-1 text-sm font-semibold text-foreground">Report this post</h4>
                              <button type="button" onClick={() => setReportOpen(null)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                <XIcon className="size-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">Barangay moderators will review this report.</p>
                            <div className="flex flex-col gap-1.5">
                              {reportReasons.map((reason) => (
                                <label key={reason} className="flex items-center gap-2 cursor-pointer text-xs text-foreground">
                                  <input type="radio" name={`report-${post.id}`} value={reason} checked={reportReason === reason} onChange={() => setReportReason(reason)} />
                                  {reason}
                                </label>
                              ))}
                            </div>
                            {reportReason === "Others (please specify)" && <Input type="text" value={reportOther} onChange={(e) => setReportOther(e.target.value)} placeholder="Please specify..." className="h-8 text-xs" />}
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="w-full text-xs"
                              disabled={flaggingPost === post.id}
                              onClick={() => void submitFlag(post.id)}
                            >
                              {flaggingPost === post.id ? "Submitting..." : "Submit Report"}
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 flex flex-col gap-3 border-t border-[#dfe7f5] pt-4">
                        {post.comments.map((comment) => (
                          <CommentItem
                            key={comment.id}
                            postId={post.id}
                            comment={comment}
                            expandedReplies={expandedReplies}
                            replyInputs={replyInputs}
                            onToggleReply={toggleReplies}
                            onReplyInputChange={updateReplyInput}
                            onSubmitReply={(targetPostId, parentId, key) => void submitReply(targetPostId, parentId, key)}
                          />
                        ))}

                        <div className="flex gap-2 pt-1">
                          <Input type="text" value={commentInputs[post.id] ?? ""} onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))} placeholder="Write a comment..." className="h-8 flex-1 text-xs" />
                          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" onClick={() => void submitComment(post.id)}>
                            <SendIcon />
                          </Button>
                        </div>
                      </div>
                    )}
                </article>
              )
            })}

              {announcements.length === 0 && concerns.length === 0 && !error ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#cbd8ee] bg-white p-8 text-center text-sm font-semibold text-[#68739c]">
                  <img src="/contents/feed.png" alt="" className="mb-4 h-32 w-auto" aria-hidden="true" />
                  Nothing to show yet.
                </div>
              ) : null}
            </div>
          </section>

          <aside className="flex flex-col gap-5 xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <img src="/contents/trending.png" alt="" className="size-10" />
                <h3 className="text-lg font-extrabold text-[#07145f]">Trending in<br/>Marikina Heights</h3>
              </div>
              <div className="mt-4 divide-y divide-[#eef3ff]">
                {trendingConcerns.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-3 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#fff1ea] text-sm font-extrabold text-[#ff6a1a]">{index + 1}</span>
                    <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#07145f]">{item.title}</p>
                    <p className="shrink-0 text-xs font-extrabold text-[#2447b3]">{item.vote_count} upvotes</p>
                  </div>
                ))}
                {concerns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#cbd8ee] bg-white p-4 text-center">
                    <img src="/contents/share.png" alt="" className="mb-2 h-12 w-auto" aria-hidden="true" />
                    <p className="text-sm font-semibold text-[#68739c]">No trending concerns yet.</p>
                    <p className="mt-1 text-xs text-[#68739c]">Share your concern to start a discussion.</p>
                    <Link
                      to="/dashboard/reports"
                      className="mt-3 inline-flex h-9 items-center rounded-full bg-primary px-5 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
                    >
                      Share your concern
                    </Link>
                    <div className="h-2" />
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("All")
                  setSearch("")
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                className="mt-3 flex w-full items-center justify-between text-sm font-extrabold text-[#2447b3] transition-colors hover:text-[#ff6a1a]"
              >
                View all trending
                <ChevronRightIcon className="size-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/contents/responders.png" alt="" className="size-10" />
                  <h3 className="text-lg font-extrabold text-[#07145f]">Active Responders</h3>
                </div>
                <button type="button" onClick={() => toast.info(`${activeResponders.length} responders are currently on duty.`)} className="text-sm font-extrabold text-[#2447b3] hover:text-[#ff6a1a]">View all</button>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                {activeResponders.map((responder) => (
                  <div key={responder.id} className="flex items-center gap-3">
                    <Avatar user={responder} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-[#07145f]">{responder.full_name}</p>
                      <p className="text-xs font-semibold text-[#68739c]">{responderRoleLabel(responder.role)}</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#2447b3]"><span className="size-2 rounded-full bg-green-500" />Online</span>
                  </div>
                ))}
                {activeResponders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#cbd8ee] bg-white p-4 text-sm font-semibold text-[#68739c]">
                    No active responders right now.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <ShieldCheckIcon className="size-5 text-[#2447b3]" />
                <h3 className="text-lg font-extrabold text-[#07145f]">Community Guidelines</h3>
              </div>
              <p className="mt-4 text-sm font-semibold leading-6 text-[#43507f]">
                Let's keep our community safe, respectful, and helpful to everyone.
              </p>
              <button type="button" onClick={() => toast.info("Community posts can be upvoted, discussed, or flagged for official moderation.")} className="mt-4 flex w-full items-center justify-between text-sm font-extrabold text-[#2447b3] transition-colors hover:text-[#ff6a1a]">
                View guidelines
                <ChevronRightIcon className="size-4" />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
