import { useEffect, useRef, useState } from "react"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  ImageIcon,
  MessageCircleIcon,
  ReplyIcon,
  SendIcon,
  TrendingUpIcon,
  UsersIcon,
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

function Avatar({ user, index = 0 }: { user: PublicUser; index?: number }) {
  const online = Boolean(user.last_seen_at)
  const avatarKey = user.avatar || (user.gender && user.gender !== "prefer_not_to_say" && user.date_of_birth
    ? (() => {
        const age = new Date().getFullYear() - new Date(user.date_of_birth!).getFullYear()
        const bucket = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
        const icon = user.gender === "male" ? "man" : "woman"
        return `${bucket}-${icon}`
      })()
    : "")
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
  const filterRailRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
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
  const [error, setError] = useState("")

  async function loadFeed() {
    setLoaded(false)
    setError("")
    try {
      const category = filterCategoryMap[activeFilter]
      const [nextConcerns, nextAnnouncements, responders] = await Promise.all([
        activeFilter === "Announcements" ? Promise.resolve([]) : listFeedConcerns(category),
        activeFilter === "All" || activeFilter === "Announcements" ? listAnnouncements() : Promise.resolve([]),
        listActiveResponders(),
      ])
      setConcerns(nextConcerns)
      setAnnouncements(nextAnnouncements)
      setActiveResponders(responders)
    } catch {
      setError("Could not load feed.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void loadFeed()
    function refresh() { void loadFeed() }
    window.addEventListener("eboses:report-created", refresh)
    return () => window.removeEventListener("eboses:report-created", refresh)
  }, [activeFilter])

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

  function scrollFilterRail(direction: -1 | 1) {
    const rail = filterRailRef.current
    const buttons = Array.from(rail?.querySelectorAll<HTMLButtonElement>("[data-filter-option]") ?? [])
    if (!rail || buttons.length === 0) return
    const currentIndex = buttons.findIndex((button) => button.offsetLeft + button.offsetWidth > rail.scrollLeft + 4)
    const fallbackIndex = direction > 0 ? 0 : buttons.length - 1
    const targetIndex = Math.min(buttons.length - 1, Math.max(0, (currentIndex === -1 ? fallbackIndex : currentIndex) + direction * 2))
    rail.scrollTo({ left: buttons[targetIndex].offsetLeft - buttons[0].offsetLeft, behavior: "smooth" })
  }

  return (
    <div className="flex flex-col">
      <Topbar />

      <div className="flex-1 p-4 md:p-10">
        {/* Header image */}
        <div className="flex h-32 w-full items-center justify-center md:h-48">
          <img src="/contents/feed-header.png" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="mt-4 text-center">
          <p className="text-xs text-muted-foreground">Marikina Heights</p>
          <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">Community Feed</h1>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-7">
          <section className="flex min-w-0 flex-col gap-4 lg:col-span-5">
            {/* Category pills */}
            <div className="relative w-full min-w-0">
              <button type="button" aria-label="Scroll filters left" onClick={() => scrollFilterRail(-1)} className="absolute left-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden">
                <ChevronLeftIcon className="size-4" />
              </button>
              <div ref={filterRailRef} className="scrollbar-hide mx-10 min-w-0 overflow-x-hidden lg:mx-0 lg:overflow-visible">
                <div className="flex min-w-max flex-nowrap gap-2 lg:grid lg:min-w-0 lg:grid-cols-6">
                  {filters.map((f) => (
                    <Button key={f} data-filter-option type="button" size="sm" variant={activeFilter === f ? "default" : "outline"} aria-pressed={activeFilter === f} onClick={() => setActiveFilter(f)} className={cn("h-8 shrink-0 rounded-full px-3 text-xs whitespace-nowrap lg:w-full lg:min-w-0 lg:shrink", activeFilter !== f && "bg-card")}>
                      {f}
                    </Button>
                  ))}
                </div>
              </div>
              <button type="button" aria-label="Scroll filters right" onClick={() => scrollFilterRail(1)} className="absolute right-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden">
                <ChevronRightIcon className="size-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              {announcements.map((announcement) => (
                <div key={`announcement-${announcement.id}`} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{announcement.title}</p>
                        <Badge variant="secondary">{announcement.tag}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{announcement.date_label}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground">{announcement.body}</p>
                </div>
              ))}

              {concerns.map((post, index) => {
                const isExpanded = expandedComments.has(post.id)
                return (
                  <div key={post.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar user={post.reporter} index={index} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">{post.reporter.full_name}</p>
                            <Badge variant="secondary">{categoryLabel(post.category)}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{timeAgo(post.created_at)}</p>
                        </div>
                      </div>

                      <div className="relative">
                        <Popover open={reportOpen === post.id} onOpenChange={(open) => { if (!open) { setReportOpen(null); setReportReason(""); setReportOther("") } else { setReportOpen(post.id) } }}>
                        <PopoverTrigger className="text-muted-foreground hover:text-destructive">
                          <FlagIcon className="size-4" />
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
                            <p className="text-xs text-muted-foreground">Flagging posts will be connected in the moderation module.</p>
                            <div className="flex flex-col gap-1.5">
                              {reportReasons.map((reason) => (
                                <label key={reason} className="flex items-center gap-2 cursor-pointer text-xs text-foreground">
                                  <input type="radio" name={`report-${post.id}`} value={reason} checked={reportReason === reason} onChange={() => setReportReason(reason)} />
                                  {reason}
                                </label>
                              ))}
                            </div>
                            {reportReason === "Others (please specify)" && <Input type="text" value={reportOther} onChange={(e) => setReportOther(e.target.value)} placeholder="Please specify..." className="h-8 text-xs" />}
                            <Button type="button" variant="destructive" size="sm" className="w-full text-xs" disabled>Submit Report</Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-foreground">{post.description || post.title}</p>

                    {/* Media: display image if available, nothing if none */}
                    {post.media.length > 0 ? (
                      post.media[0].mime_type?.startsWith("image/") ? (
                        <img src={post.media[0].preview_url} alt="" className="mt-3 max-h-96 w-full rounded-lg border border-border object-contain" />
                      ) : (
                        <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          {post.media[0].original_filename}
                        </div>
                      )
                    ) : null}

                    <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                      <div className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors", post.user_vote === 1 ? "border-primary bg-primary/10" : "border-border")}>
                        <button type="button" onClick={() => void handleVote(post)} className={cn("rounded-full p-0.5 transition-colors", post.user_vote === 1 ? "text-primary" : "text-muted-foreground hover:text-primary")}>
                          <ArrowUpIcon className="size-4" />
                        </button>
                        <span className={cn("min-w-[12px] text-center text-xs font-bold", post.user_vote === 1 ? "text-primary" : "text-foreground")}>{post.vote_count}</span>
                      </div>

                      <button type="button" onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                        <MessageCircleIcon className="size-4" />
                        {post.comment_count}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
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
                  </div>
                )
              })}

              {announcements.length === 0 && concerns.length === 0 && !error ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  Nothing to show yet.
                </div>
              ) : null}
            </div>
          </section>

          <aside className="flex flex-col gap-6 lg:col-span-2">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <TrendingUpIcon className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Trending in Marikina Heights</h3>
              </div>
              <div className="flex flex-col gap-2">
                {concerns.slice(0, 3).map((item) => (
                  <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.vote_count} upvotes</p>
                  </div>
                ))}
                {concerns.length === 0 ? <Skeleton className="h-16 border border-border bg-card" /> : null}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Active Responders</h3>
              </div>
              <div className="flex flex-col gap-2">
                {activeResponders.map((responder, index) => (
                  <div key={responder.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <Avatar user={responder} index={index} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{responder.full_name}</p>
                      <p className="text-xs text-muted-foreground">{responderRoleLabel(responder.role)}</p>
                    </div>
                  </div>
                ))}
                {activeResponders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                    No active responders right now.
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
