import { ArrowBendUpLeft as ReplyIcon, ArrowUp as ArrowUpIcon, ChatCircle, MagnifyingGlass as SearchIcon, PaperPlaneRight, Leaf as LeafIcon, ShieldCheck as ShieldCheckIcon, TrafficCone as TrafficConeIcon, Wrench as WrenchIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import { concernBodyText } from "@/features/dashboard/utils/feed-post-card-utils"
import { PostMoreMenu } from "@/features/dashboard/components/report-post-dialog"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import type { Concern, ConcernCategory, ConcernComment, PublicUser } from "@/features/dashboard/api"

const categoryStyles: Record<ConcernCategory, { icon: typeof WrenchIcon; bg: string; text: string }> = {
  infrastructure: { icon: TrafficConeIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]" },
  environment: { icon: LeafIcon, bg: "bg-[#e9f9ef]", text: "text-[#16a34a]" },
  public_safety: { icon: ShieldCheckIcon, bg: "bg-[#ffeceb]", text: "text-[#ff5003]" },
  others: { icon: SearchIcon, bg: "bg-[#fff1ea]", text: "text-[#ff6a1a]" },
}

function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const m = Math.max(1, Math.floor(diffMs / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const avatarColors = [
  "bg-primary/10 text-primary", "bg-secondary text-secondary-foreground", "bg-accent/10 text-accent",
  "bg-muted text-foreground", "bg-primary/15 text-primary", "bg-secondary/70 text-secondary-foreground",
]
const avatarGrey = "bg-muted text-muted-foreground"

function Avatar({ user }: { user: PublicUser }) {
  const online = Boolean(user.last_seen_at)
  const colorIdx = user.id % avatarColors.length
  const letter = (user.full_name?.[0] || user.initials?.[0] || "?").toUpperCase()
  return (
    <div className="relative inline-flex shrink-0 self-start overflow-visible">
      <div className={cn("flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-bold", online ? avatarColors[colorIdx] : avatarGrey)}>
        {letter}
      </div>
      <span className={cn("absolute bottom-0 right-0 z-10 size-3 translate-x-1/4 translate-y-1/4 rounded-full border-2 border-card", online ? "bg-primary" : "bg-muted-foreground/50")} />
    </div>
  )
}

function CommentItem({ postId, comment, depth = 0, expandedReplies, replyInputs, onToggleReply, onReplyInputChange, onSubmitReply }: {
  postId: number; comment: ConcernComment; depth?: number; expandedReplies: Set<string>; replyInputs: Record<string, string>
  onToggleReply: (key: string) => void; onReplyInputChange: (key: string, value: string) => void; onSubmitReply: (postId: number, parentId: number, key: string) => void
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
            Reply{comment.replies.length > 0 && <span>&middot; {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}</span>}
          </button>
          {isReplyExpanded && (
            <div className="mt-2 flex gap-2">
              <Input type="text" value={replyInputs[replyKey] ?? ""} onChange={(e) => onReplyInputChange(replyKey, e.target.value)} placeholder={`Reply to ${comment.author.full_name}...`} className="h-8 min-w-0 flex-1 text-xs" />
              <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary" onClick={() => onSubmitReply(postId, comment.id, replyKey)}><PaperPlaneRight /></Button>
            </div>
          )}
          {comment.replies.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {comment.replies.map((reply) => (
                <CommentItem key={reply.id} postId={postId} comment={reply} depth={depth + 1} expandedReplies={expandedReplies} replyInputs={replyInputs} onToggleReply={onToggleReply} onReplyInputChange={onReplyInputChange} onSubmitReply={onSubmitReply} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function FeedConcernCard({
  post, isExpanded, expandedReplies, replyInputs, commentInput, menuOpen,
  onToggleComments, onToggleReply, onReplyInputChange, onSubmitReply,
  onSubmitComment, onVote, onCommentInputChange, onMenuOpenChange, onReport,
}: {
  post: Concern; isExpanded: boolean; expandedReplies: Set<string>; replyInputs: Record<string, string>
  commentInput: string; menuOpen: boolean; onToggleComments: () => void; onToggleReply: (key: string) => void
  onReplyInputChange: (key: string, value: string) => void; onSubmitReply: (postId: number, parentId: number, key: string) => void
  onSubmitComment: () => void; onVote: () => void; onCommentInputChange: (v: string) => void
  onMenuOpenChange: (open: boolean) => void; onReport: () => void
}) {
  const style = categoryStyles[post.category]
  const CategoryIcon = style.icon
  const feedImage = post.media.find((m) => m.mime_type?.startsWith("image/") && (m.preview_url || m.raw_url))

  return (
    <article className="relative rounded-2xl border border-[#dfe7f5] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[64px_minmax(0,1fr)_120px_150px] md:items-center">
        <div className="flex items-start gap-3 md:contents">
          <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-full", style.bg, style.text)}>
            <CategoryIcon className="size-7" />
          </div>
          <div className="min-w-0 flex-1 md:min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border-0 text-[10px] font-extrabold uppercase hover:bg-transparent", style.bg, style.text)}>{categoryLabel(post.category)}</Badge>
            </div>
            <p className="mt-2 truncate text-xs font-bold text-[#2447b3]">
              {post.reporter.full_name} <span className="mx-1 text-[#8b96b8]">•</span> Verified Resident <span className="mx-1 text-[#8b96b8]">•</span> {timeAgo(post.created_at)}
            </p>
          </div>
        </div>

        <p className="-mt-3 line-clamp-3 text-sm font-semibold leading-6 text-[#07145f] md:col-span-4 md:mt-0">{concernBodyText(post)}</p>

        <div className="hidden md:block">
          {feedImage ? <AuthenticatedMediaImage src={feedImage.preview_url || feedImage.raw_url} alt="" className="h-20 w-full rounded-lg object-cover" /> : null}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[#dfe7f5] pt-3 md:border-l md:border-t-0 md:pt-0 md:pl-6">
          <div className="grid gap-3">
            <button type="button" onClick={onVote} className={cn("flex items-center gap-2 text-sm font-extrabold transition-colors", post.user_vote === 1 ? "text-[#ff6a1a]" : "text-[#2447b3] hover:text-[#ff6a1a]")}>
              <ArrowUpIcon className="size-5" /><span>{post.vote_count}</span><span className="text-xs font-semibold text-[#43507f]">Upvotes</span>
            </button>
            <button type="button" onClick={onToggleComments} className="flex items-center gap-2 text-sm font-extrabold text-[#2447b3] transition-colors hover:text-[#ff6a1a]">
              <ChatCircle className="size-5" /><span>{post.comment_count}</span><span className="text-xs font-semibold text-[#43507f]">Comments</span>
            </button>
          </div>
          <PostMoreMenu open={menuOpen} onOpenChange={onMenuOpenChange} onReport={onReport} triggerClassName="size-9 rounded-lg text-[#2447b3] hover:bg-[#fff1ea] hover:text-[#ff6a1a]" />
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[#dfe7f5] pt-4">
          {post.comments.map((comment) => (
            <CommentItem key={comment.id} postId={post.id} comment={comment} expandedReplies={expandedReplies} replyInputs={replyInputs} onToggleReply={onToggleReply} onReplyInputChange={onReplyInputChange} onSubmitReply={onSubmitReply} />
          ))}
          <div className="flex gap-2 pt-1">
            <Input type="text" value={commentInput} onChange={(e) => onCommentInputChange(e.target.value)} placeholder="Write a comment..." className="h-8 flex-1 text-xs" />
            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" onClick={onSubmitComment}><PaperPlaneRight /></Button>
          </div>
        </div>
      )}
    </article>
  )
}
