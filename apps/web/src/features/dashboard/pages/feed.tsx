import { useState } from "react"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import {
  ArrowUpIcon,
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

const samplePosts = [
  {
    id: 1,
    name: "Maria Santos",
    time: "2 hours ago",
    avatar: "MS",
    colorIdx: 0,
    online: true,
    content: "May butas sa kalsada sa may Bayan-Bayanan. Delikado lalo na sa gabi. Sana maayos na agad.",
    votes: 12,
    commentCount: 3,
    category: "Infrastructure",
    comments: [
      {
        name: "Juan Dela Cruz",
        avatar: "JD",
        colorIdx: 1,
        online: true,
        text: "Oo nga po, nakakatakot dumaan diyan.",
        time: "1h ago",
        replies: [
          { name: "Maria Santos", avatar: "MS", colorIdx: 0, online: true, text: "Kaya nga po eh, lalo na pag gabi.", time: "50m ago" },
        ],
      },
      {
        name: "Ana Reyes",
        avatar: "AR",
        colorIdx: 2,
        online: false,
        text: "Nag-report na rin ako sa barangay kanina.",
        time: "45m ago",
        replies: [],
      },
    ],
  },
  {
    id: 2,
    name: "Juan Dela Cruz",
    time: "5 hours ago",
    avatar: "JD",
    colorIdx: 1,
    online: true,
    content: "Flood warning sa may Barangay Hall. Mataas na ang tubig sa ilog. Mag-ingat po tayong lahat.",
    votes: 24,
    commentCount: 8,
    category: "Environment",
    comments: [
      {
        name: "Pedro Garcia",
        avatar: "PG",
        colorIdx: 3,
        online: true,
        text: "Salamat sa babala! Ingat po tayong lahat.",
        time: "4h ago",
        replies: [
          { name: "Elena Torres", avatar: "ET", colorIdx: 5, online: true, text: "Nasa evacuation center na po kami. Salamat!", time: "3h ago" },
        ],
      },
    ],
  },
  {
    id: 3,
    name: "Ana Reyes",
    time: "1 day ago",
    avatar: "AR",
    colorIdx: 2,
    online: false,
    content: "Salamat sa mga tanod na nagpatrol kagabi. Naramdaman namin ang mas ligtas na kapaligiran.",
    votes: 18,
    commentCount: 5,
    category: "Public Safety",
    comments: [],
  },
]

const activeResponders = [
  { name: "Pedro Garcia", role: "Tanod", avatar: "PG", colorIdx: 3, online: true },
  { name: "Rosa Mendoza", role: "BHW", avatar: "RM", colorIdx: 4, online: true },
  { name: "Carlos Lim", role: "Kagawad", avatar: "CL", colorIdx: 5, online: false },
  { name: "Elena Torres", role: "Tanod", avatar: "ET", colorIdx: 0, online: true },
]

export default function FeedPage() {
  usePageTitle("Feed")
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [votes, setVotes] = useState<Record<number, number>>(
    Object.fromEntries(samplePosts.map((p) => [p.id, p.votes]))
  )
  const [userVote, setUserVote] = useState<Record<number, 1 | -1 | 0>>({})
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [expandedSubReplies, setExpandedSubReplies] = useState<Set<string>>(new Set())
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({})
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})
  const [subReplyInputs, setSubReplyInputs] = useState<Record<string, string>>({})
  const [reportOpen, setReportOpen] = useState<number | null>(null)
  const [reportReason, setReportReason] = useState<string>("")
  const [reportOther, setReportOther] = useState<string>("")

  function handleVote(postId: number) {
    const current = userVote[postId] ?? 0
    if (current === 1) {
      setVotes((v) => ({ ...v, [postId]: v[postId] - 1 }))
      setUserVote((v) => ({ ...v, [postId]: 0 }))
    } else {
      setVotes((v) => ({ ...v, [postId]: v[postId] + 1 }))
      setUserVote((v) => ({ ...v, [postId]: 1 }))
    }
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

  function toggleSubReplies(key: string) {
    setExpandedSubReplies((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />

      <div className="flex-1 p-4 md:p-10">
        <div className="rounded-2xl bg-primary px-6 py-4">
          <p className="text-xs text-[#020c4e]/70">Marikina Heights</p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-[#020c4e] md:text-3xl">
            Community Feed
          </h1>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-7">
          {/* Left: Filters + Posts */}
          <section className="flex flex-col gap-4 lg:col-span-5">
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={activeFilter === f ? "default" : "outline"}
                  aria-pressed={activeFilter === f}
                  onClick={() => setActiveFilter(f)}
                  className={cn("h-8 rounded-full px-3 text-xs", activeFilter !== f && "bg-white")}
                >
                  {f}
                </Button>
              ))}
            </div>

            {/* Posts */}
            <div className="flex flex-col gap-4">
              {samplePosts.map((post) => {
                const uv = userVote[post.id] ?? 0
                const isExpanded = expandedComments.has(post.id)
                return (
                  <div key={post.id} className="rounded-lg border border-border bg-card p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className={cn("flex size-10 items-center justify-center rounded-full text-sm font-bold", post.online ? avatarColors[post.colorIdx] : avatarGrey)}>
                            {post.avatar}
                          </div>
                          <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card", post.online ? "bg-primary" : "bg-muted-foreground/50")} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">{post.name}</p>
                            <Badge variant="secondary">{post.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{post.time}</p>
                        </div>
                      </div>

                      {/* Flag popover */}
                      <div className="relative">
                      <Popover open={reportOpen === post.id} onOpenChange={(o) => { if (!o) { setReportOpen(null); setReportReason(""); setReportOther("") } else { setReportOpen(post.id) } }}>
                        <PopoverTrigger className="text-muted-foreground hover:text-destructive">
                          <FlagIcon className="size-4" />
                        </PopoverTrigger>
                        <PopoverContent className="w-72 right-0 left-auto top-full mt-1">
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
                            <p className="text-xs text-muted-foreground">Help us keep this community safe.</p>
                            <div className="flex flex-col gap-1.5">
                              {reportReasons.map((r) => (
                                <label key={r} className="flex items-center gap-2 cursor-pointer text-xs text-foreground">
                                  <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", reportReason === r ? "border-primary" : "border-muted-foreground")}>
                                    {reportReason === r && <span className="size-1.5 rounded-full bg-primary" />}
                                  </span>
                                  <input type="radio" name={`report-${post.id}`} value={r} checked={reportReason === r} onChange={() => setReportReason(r)} className="sr-only" />
                                  {r}
                                </label>
                              ))}
                            </div>
                            {reportReason === "Others (please specify)" && (
                              <Input type="text" value={reportOther} onChange={(e) => setReportOther(e.target.value)} placeholder="Please specify..." className="h-8 text-xs" />
                            )}
                            <Button type="button" variant="destructive" size="sm" className="w-full text-xs">
                              Submit Report
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      </div>
                    </div>

                    {/* Content */}
                    <p className="mt-3 text-sm leading-relaxed text-foreground">{post.content}</p>

                    {/* Image placeholder */}
                    <div className="mt-3 flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <ImageIcon className="size-6" />
                        <span className="text-xs">No image attached</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                      {/* Vote — upvote only */}
                      <div className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                        <button
                          type="button"
                          onClick={() => handleVote(post.id)}
                          className={cn("rounded-full p-0.5 transition-colors", uv === 1 ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary")}
                        >
                          <ArrowUpIcon className="size-4" />
                        </button>
                        <span className={cn("min-w-[12px] text-center text-xs font-bold", uv === 1 ? "text-primary" : "text-foreground")}>
                          {votes[post.id]}
                        </span>
                      </div>

                      {/* Comments */}
                      <button
                        type="button"
                        onClick={() => toggleComments(post.id)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                      >
                        <MessageCircleIcon className="size-4" />
                        {post.commentCount}
                      </button>
                    </div>

                    {/* Comments section */}
                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                        {post.comments.map((c, ci) => {
                          const replyKey = `${post.id}-${ci}`
                          const isReplyExpanded = expandedReplies.has(replyKey)
                          return (
                            <div key={ci}>
                              <div className="flex gap-2">
                                <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", c.online ? avatarColors[c.colorIdx] : avatarGrey)}>
                                  {c.avatar}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-foreground">{c.name}</span>
                                    <span className="text-xs text-muted-foreground">{c.time}</span>
                                  </div>
                                  <p className="text-xs text-foreground">{c.text}</p>
                                  <button
                                    type="button"
                                    onClick={() => toggleReplies(replyKey)}
                                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                                  >
                                    <ReplyIcon className="size-3" />
                                    Reply
                                    {c.replies.length > 0 && <span>&middot; {c.replies.length} {c.replies.length === 1 ? "reply" : "replies"}</span>}
                                  </button>

                                  {/* Replies */}
                                  {c.replies.length > 0 && (
                                    <div className="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
                                      {c.replies.map((r, ri) => {
                                        const subReplyKey = `${replyKey}-${ri}`
                                        const isSubReplyExpanded = expandedSubReplies.has(subReplyKey)
                                        return (
                                          <div key={ri}>
                                            <div className="flex gap-2">
                                              <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", r.online ? avatarColors[r.colorIdx] : avatarGrey)}>
                                                {r.avatar}
                                              </div>
                                              <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-xs font-semibold text-foreground">{r.name}</span>
                                                  <span className="text-xs text-muted-foreground">{r.time}</span>
                                                </div>
                                                <p className="text-xs text-foreground">{r.text}</p>
                                                <button
                                                  type="button"
                                                  onClick={() => toggleSubReplies(subReplyKey)}
                                                  className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                                                >
                                                  <ReplyIcon className="size-3" />
                                                  Reply
                                                </button>
                                                {isSubReplyExpanded && (
                                                  <div className="mt-2 flex gap-2">
                                                    <Input
                                                      type="text"
                                                      value={subReplyInputs[subReplyKey] ?? ""}
                                                      onChange={(e) => setSubReplyInputs((prev) => ({ ...prev, [subReplyKey]: e.target.value }))}
                                                      placeholder={`Reply to ${r.name}...`}
                                                      className="h-7 flex-1 text-xs"
                                                    />
                                                    <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-primary">
                                                      <SendIcon />
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {/* Reply input */}
                                  {isReplyExpanded && (
                                    <div className="mt-2 flex gap-2">
                                      <Input
                                        type="text"
                                        value={replyInputs[replyKey] ?? ""}
                                        onChange={(e) => setReplyInputs((prev) => ({ ...prev, [replyKey]: e.target.value }))}
                                        placeholder="Write a reply..."
                                        className="h-8 flex-1 text-xs"
                                      />
                                      <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
                                        <SendIcon />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}

                        {/* Add comment */}
                        <div className="flex gap-2 pt-1">
                          <Input
                            type="text"
                            value={commentInputs[post.id] ?? ""}
                            onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))}
                            placeholder="Write a comment..."
                            className="h-8 flex-1 text-xs"
                          />
                          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
                            <SendIcon />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Right: Trending + Active Responders */}
          <aside className="flex flex-col gap-6 lg:col-span-2">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <TrendingUpIcon className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Trending in Marikina Heights</h3>
              </div>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 border border-border bg-card" />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Active Responders</h3>
              </div>
              <div className="flex flex-col gap-2">
                {activeResponders.map((r) => (
                  <div key={r.name} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <div className="relative">
                      <div className={cn("flex size-8 items-center justify-center rounded-full text-xs font-bold", r.online ? avatarColors[r.colorIdx] : avatarGrey)}>
                        {r.avatar}
                      </div>
                      <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card", r.online ? "bg-primary" : "bg-muted-foreground/50")} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
