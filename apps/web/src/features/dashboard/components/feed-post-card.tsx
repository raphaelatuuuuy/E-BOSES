/**
 * Shared feed post card — same markup as Home feed (avatar, body, media, votes, comments).
 * Used by Home and Resident Alerts Map expanded panel.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { GlobeIcon, SendIcon, MessageCircleIcon, CircleArrowUp } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Concern, ConcernComment, PublicUser } from "@/features/dashboard/api"
import {
  collectThreadMentionUsers,
  firstNameOf,
  MentionTextField,
  mentionToken,
  renderCommentBody,
  toMentionUser,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import {
  CommentMoreMenu,
  PostMoreMenu,
  ReportPostDialog,
} from "@/features/dashboard/components/report-post-dialog"

const BARANGAY = "Marikina Heights"
const STROKE = 1.5

const FS = {
  author: "text-[16px]",
  meta: "text-[14px]",
  body: "text-[16px]",
} as const

const IC = {
  xxs: "size-4",
} as const

/**
 * Create-report stores `title` as the first ~80 chars of `description`.
 * Prefer a single body so the feed never shows the text twice.
 */
export function concernBodyText(post: {
  title?: string | null
  description?: string | null
}): string {
  const title = (post.title || "").trim()
  const description = (post.description || "").trim()
  if (!description) return title
  if (!title) return description
  // Auto-title is a prefix (often mid-word) of the full description
  if (description.startsWith(title) || title.startsWith(description)) {
    return description.length >= title.length ? description : title
  }
  return description
}

/** Short label for lists when title is only a hard-sliced description. */
export function concernTitleText(post: {
  title?: string | null
  description?: string | null
}): string {
  const body = concernBodyText(post)
  const title = (post.title || "").trim()
  if (!title) return body.slice(0, 80) || "Report"
  // Mid-word slice looks broken in list headers — clean at word boundary
  if (body.startsWith(title) && title.length < body.length) {
    const cut = title.replace(/\s+\S*$/, "").trim()
    return cut.length >= 24 ? cut : title
  }
  return title
}

export function feedTimeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function feedCategoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}

function commentPlaceLabel(author: PublicUser) {
  const street =
    streetLabelFromAddress(author.street) ||
    (author.street && author.street.toLowerCase() !== "pending" ? author.street : null)
  if (street && street.toLowerCase() !== "marikina heights") return street
  if (author.barangay && author.barangay.toLowerCase() !== "pending") return author.barangay
  return BARANGAY
}

/** Letter avatar — matches Home feed (no portrait images) */
export function FeedUserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: PublicUser | null
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const sizeClass =
    size === "sm" ? "size-9 text-[16px]" : size === "lg" ? "size-11 text-[18px]" : "size-10 text-[17px]"
  const letter = (user?.full_name?.[0] || user?.initials?.[0] || "?").toUpperCase()
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

function FeedCommentItem({
  comment,
  isReply = false,
  rootCommentId,
  replyOpenId,
  replyDraft,
  onToggleReply,
  onReplyDraftChange,
  onSubmitReply,
  sessionUser,
  mentionUsers,
  menuOpenId,
  onMenuOpenChange,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  comment: ConcernComment
  isReply?: boolean
  rootCommentId: number
  replyOpenId: number | null
  replyDraft: string
  onToggleReply: (comment: ConcernComment) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (rootParentId: number) => void
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  menuOpenId: number | null
  onMenuOpenChange: (id: number | null) => void
  editingId: number | null
  editDraft: string
  onStartEdit: (comment: ConcernComment) => void
  onEditDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: (commentId: number) => void
  onDelete: (commentId: number) => void
}) {
  const isOwn = sessionUser != null && comment.author.id === sessionUser.id
  const isReplying = replyOpenId === comment.id
  const isEditing = editingId === comment.id
  const menuOpen = menuOpenId === comment.id
  const place = commentPlaceLabel(comment.author)
  const [showOriginal, setShowOriginal] = useState(false)
  const isEdited = Boolean(comment.is_edited)
  const originalText = (comment.original_body || "").trim()

  useEffect(() => {
    setShowOriginal(false)
  }, [comment.id, comment.body, comment.is_edited])

  const hasReplies = !isReply && comment.replies.length > 0
  const threadRootRef = useRef<HTMLDivElement>(null)
  const lastReplyAvatarRef = useRef<HTMLDivElement>(null)
  const [threadBox, setThreadBox] = useState({ top: 32, height: 80, left: 15, width: 29 })

  useLayoutEffect(() => {
    if (!hasReplies) return
    function measure() {
      const rootEl = threadRootRef.current
      const avEl = lastReplyAvatarRef.current
      if (!rootEl || !avEl) return
      const rootRect = rootEl.getBoundingClientRect()
      const avRect = avEl.getBoundingClientRect()
      const avCenterY = avRect.top + avRect.height / 2
      const top = 32
      const height = Math.max(24, avCenterY - rootRect.top - top)
      const left = 15
      const avLeft = avRect.left - rootRect.left
      const width = Math.max(20, avLeft - left)
      setThreadBox({ top, height, left, width })
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    const rootEl = threadRootRef.current
    const ro =
      typeof ResizeObserver !== "undefined" && rootEl ? new ResizeObserver(() => measure()) : null
    if (rootEl && ro) ro.observe(rootEl)
    window.addEventListener("resize", measure)
    return () => {
      window.cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [hasReplies, comment.replies.length, comment.replies.map((r) => r.id).join(",")])

  const commentMain = (
    <>
      <div className="flex items-start gap-0.5">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] font-normal leading-[1.3] text-neutral-400">
            <span className="font-bold text-neutral-900">{comment.author.full_name}</span>
            <span className="mx-1">·</span>
            <span>{feedTimeAgo(comment.created_at)}</span>
            {place ? (
              <>
                <span className="mx-1">·</span>
                <span>{place}</span>
              </>
            ) : null}
            {isEdited ? (
              <>
                <span className="mx-1">·</span>
                <button
                  type="button"
                  onClick={() => originalText && setShowOriginal((v) => !v)}
                  className={cn(
                    "inline p-0 font-medium text-neutral-400 align-baseline",
                    originalText && "hover:text-neutral-700 hover:underline",
                  )}
                  title={originalText ? "View original comment" : undefined}
                >
                  (edited)
                </button>
              </>
            ) : null}
          </p>

          {isEditing ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraftChange(e.target.value.slice(0, 1000))}
                rows={2}
                autoFocus
                className={cn(
                  "w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[15px] text-neutral-900 outline-none",
                  "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
                )}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editDraft.trim()}
                  onClick={() => onSaveEdit(comment.id)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-[13px] font-semibold",
                    editDraft.trim()
                      ? "bg-neutral-900 text-white hover:bg-neutral-800"
                      : "cursor-not-allowed bg-neutral-200 text-neutral-400",
                  )}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="m-0 whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.35] text-neutral-800">
                {renderCommentBody(comment.body)}
              </p>
              {isEdited && showOriginal && originalText ? (
                <div className="mt-1.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 ring-1 ring-neutral-100">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    Original comment
                  </p>
                  <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug text-neutral-600">
                    {renderCommentBody(originalText)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowOriginal(false)}
                    className="mt-0.5 text-[12px] font-semibold text-neutral-500 hover:text-neutral-800"
                  >
                    Hide original
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {isOwn ? (
          <div className="-mt-0.5 shrink-0">
            <CommentMoreMenu
              open={menuOpen}
              onOpenChange={(open) => onMenuOpenChange(open ? comment.id : null)}
              onEdit={() => onStartEdit(comment)}
              onDelete={() => onDelete(comment.id)}
            />
          </div>
        ) : null}
      </div>

      {!isEditing ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 leading-none">
          <button
            type="button"
            onClick={() => onToggleReply(comment)}
            className="text-[13px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
          >
            {isReplying ? "Cancel" : "Reply"}
          </button>
          {!isReply && comment.replies.length > 0 ? (
            <span className="text-[12px] font-medium text-neutral-400">
              {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
            </span>
          ) : null}
        </div>
      ) : null}

      {isReplying ? (
        <div className="mt-2 flex items-center gap-2">
          <FeedUserAvatar user={sessionUser} size="sm" className="!size-7 !text-[12px]" />
          <div className="relative min-w-0 flex-1">
            <MentionTextField
              autoFocus
              compact
              value={replyDraft}
              onChange={onReplyDraftChange}
              onSubmit={() => onSubmitReply(rootCommentId)}
              placeholder={`Reply to ${firstNameOf(comment.author.full_name)}…`}
              localUsers={mentionUsers}
            />
            <button
              type="button"
              disabled={!replyDraft.trim()}
              onClick={() => onSubmitReply(rootCommentId)}
              aria-label="Send reply"
              className={cn(
                "absolute right-1 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
                replyDraft.trim()
                  ? "text-neutral-700 hover:bg-neutral-100"
                  : "cursor-not-allowed text-neutral-300",
              )}
            >
              <SendIcon className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )

  if (isReply) {
    return <div className="min-w-0 flex-1">{commentMain}</div>
  }

  return (
    <div ref={threadRootRef} className="relative">
      <div className="flex items-start gap-2.5">
        <FeedUserAvatar
          user={comment.author}
          size="sm"
          className="relative z-10 !size-8 !text-[13px] leading-none !bg-[#c5d0e6] !text-[#2c3a5a]"
        />
        <div className="min-w-0 flex-1">{commentMain}</div>
      </div>

      {hasReplies ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute z-0 rounded-bl-[14px] border-b-[1.5px] border-l-[1.5px] border-neutral-300"
            style={{
              left: threadBox.left,
              top: threadBox.top,
              width: threadBox.width,
              height: threadBox.height,
            }}
          />
          <div className="relative z-[1] space-y-3 pl-10 pt-3">
            {comment.replies.map((reply, index) => {
              const isLast = index === comment.replies.length - 1
              return (
                <div key={reply.id} className="flex items-start gap-2.5">
                  <div ref={isLast ? lastReplyAvatarRef : undefined} className="shrink-0">
                    <FeedUserAvatar
                      user={reply.author}
                      size="sm"
                      className="!size-8 !text-[13px] leading-none !bg-[#c5d0e6] !text-[#2c3a5a]"
                    />
                  </div>
                  <FeedCommentItem
                    comment={reply}
                    isReply
                    rootCommentId={rootCommentId}
                    replyOpenId={replyOpenId}
                    replyDraft={replyDraft}
                    onToggleReply={onToggleReply}
                    onReplyDraftChange={onReplyDraftChange}
                    onSubmitReply={onSubmitReply}
                    sessionUser={sessionUser}
                    mentionUsers={mentionUsers}
                    menuOpenId={menuOpenId}
                    onMenuOpenChange={onMenuOpenChange}
                    editingId={editingId}
                    editDraft={editDraft}
                    onStartEdit={onStartEdit}
                    onEditDraftChange={onEditDraftChange}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveEdit}
                    onDelete={onDelete}
                  />
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PostCommentsBlock({
  post,
  isExpanded,
  showAllComments,
  onToggleShowAll,
  commentInput,
  onCommentInputChange,
  onSubmitTopLevel,
  replyOpenId,
  replyDraft,
  onToggleReply,
  onReplyDraftChange,
  onSubmitReply,
  sessionUser,
  menuOpenId,
  onMenuOpenChange,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  commentFieldId,
}: {
  post: Concern
  isExpanded: boolean
  showAllComments: boolean
  onToggleShowAll: () => void
  commentInput: string
  onCommentInputChange: (value: string) => void
  onSubmitTopLevel: () => void
  replyOpenId: number | null
  replyDraft: string
  onToggleReply: (comment: ConcernComment) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (parentId: number) => void
  sessionUser: PublicUser | null
  menuOpenId: number | null
  onMenuOpenChange: (id: number | null) => void
  editingId: number | null
  editDraft: string
  onStartEdit: (comment: ConcernComment) => void
  onEditDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: (commentId: number) => void
  onDelete: (commentId: number) => void
  commentFieldId: string
}) {
  if (!isExpanded) return null

  const roots = post.comments
  const hiddenCount = Math.max(0, roots.length - 1)
  const visibleRoots = showAllComments || roots.length <= 1 ? roots : roots.slice(-1)
  const mentionUsers = collectThreadMentionUsers(post, sessionUser)

  return (
    <div className="space-y-3 pt-1">
      {roots.length > 0 ? (
        <div className="space-y-3.5">
          {hiddenCount > 0 && !showAllComments ? (
            <button
              type="button"
              onClick={onToggleShowAll}
              className="text-[13px] font-semibold text-neutral-600 transition-colors hover:text-neutral-900"
            >
              See previous comments ({hiddenCount})
            </button>
          ) : null}
          {showAllComments && roots.length > 1 ? (
            <button
              type="button"
              onClick={onToggleShowAll}
              className="text-[13px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
            >
              Show less
            </button>
          ) : null}

          {visibleRoots.map((c) => (
            <FeedCommentItem
              key={c.id}
              comment={c}
              rootCommentId={c.id}
              replyOpenId={replyOpenId}
              replyDraft={replyDraft}
              onToggleReply={onToggleReply}
              onReplyDraftChange={onReplyDraftChange}
              onSubmitReply={onSubmitReply}
              sessionUser={sessionUser}
              mentionUsers={mentionUsers}
              menuOpenId={menuOpenId}
              onMenuOpenChange={onMenuOpenChange}
              editingId={editingId}
              editDraft={editDraft}
              onStartEdit={onStartEdit}
              onEditDraftChange={onEditDraftChange}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-0.5">
        <FeedUserAvatar user={sessionUser} size="sm" className="size-8 text-[14px]" />
        <div className="relative min-w-0 flex-1">
          <MentionTextField
            id={commentFieldId}
            value={commentInput}
            onChange={onCommentInputChange}
            onSubmit={onSubmitTopLevel}
            placeholder="Add a comment"
            localUsers={mentionUsers}
          />
          <button
            type="button"
            disabled={!commentInput.trim()}
            onClick={onSubmitTopLevel}
            aria-label="Send comment"
            className={cn(
              "absolute right-1.5 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
              commentInput.trim()
                ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
                : "cursor-not-allowed text-neutral-300",
            )}
          >
            <SendIcon className="size-7" />
          </button>
        </div>
      </div>
    </div>
  )
}

export type FeedPostCardProps = {
  post: Concern
  sessionUser: PublicUser | null
  /** When true, comments section is open (alerts map always wants this on expand) */
  commentsExpanded?: boolean
  onCommentsExpandedChange?: (open: boolean) => void
  focusCommentOnMount?: boolean
  onVote: (post: Concern) => void
  onComment: (postId: number, body: string, parent?: number | null) => Promise<void>
  onEditComment: (postId: number, commentId: number, body: string) => Promise<void>
  onDeleteComment: (postId: number, commentId: number) => Promise<void>
  /** Optional outer class (e.g. strip border when nested in panel) */
  className?: string
  /** Hide report menu (default false) */
  hideMoreMenu?: boolean
}

/**
 * Exact Home-feed post layout: header, body, media, vote/comment, threaded comments.
 */
export function FeedPostCard({
  post,
  sessionUser,
  commentsExpanded: commentsExpandedProp,
  onCommentsExpandedChange,
  focusCommentOnMount,
  onVote,
  onComment,
  onEditComment,
  onDeleteComment,
  className,
  hideMoreMenu = false,
}: FeedPostCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(true)
  const isExpanded = commentsExpandedProp ?? internalExpanded
  const setExpanded = (open: boolean) => {
    onCommentsExpandedChange?.(open)
    if (commentsExpandedProp === undefined) setInternalExpanded(open)
  }

  const [showAllComments, setShowAllComments] = useState(false)
  const [commentInput, setCommentInput] = useState("")
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [menuOpenPost, setMenuOpenPost] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const reporterStreet = streetLabelFromAddress(post.reporter.street)
  const commentFieldId = `feed-post-comment-${post.id}`

  useEffect(() => {
    if (!focusCommentOnMount) return
    setExpanded(true)
    window.requestAnimationFrame(() => {
      document.getElementById(commentFieldId)?.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCommentOnMount, post.id])

  async function submitTopLevel() {
    const body = commentInput.trim()
    if (!body) return
    await onComment(post.id, body, null)
    setCommentInput("")
  }

  async function submitReply(parentId: number) {
    const body = replyDraft.trim()
    if (!body) return
    await onComment(post.id, body, parentId)
    setReplyDraft("")
    setReplyOpenId(null)
  }

  return (
    <>
      <article
        className={cn(
          "relative rounded-lg border-[1.5px] border-[#d0d0d0] bg-white",
          className,
        )}
      >
        <div className="flex gap-2.5 p-3.5 pb-0">
          <FeedUserAvatar user={post.reporter} size="lg" />
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
                  <span className="shrink-0">{feedCategoryLabel(post.category)}</span>
                  <span className="shrink-0" aria-hidden>
                    ·
                  </span>
                  <span className="shrink-0">{feedTimeAgo(post.created_at)}</span>
                  <GlobeIcon className={cn(IC.xxs, "shrink-0")} strokeWidth={STROKE} />
                </p>
              </div>
              {!hideMoreMenu ? (
                <PostMoreMenu
                  open={menuOpenPost}
                  onOpenChange={setMenuOpenPost}
                  onReport={() => setReportOpen(true)}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 p-3.5 pt-2">
          <p className={cn("leading-relaxed text-neutral-900", FS.body)}>
            {concernBodyText(post)}
          </p>
        </div>

        {post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? (
          <div className="mt-2.5 border-y border-neutral-200">
            <img
              src={post.media[0].preview_url}
              alt=""
              className="max-h-80 w-full object-cover"
            />
          </div>
        ) : null}

        <div className="space-y-2.5 p-3.5 pt-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onVote(post)}
              aria-label={post.user_vote === 1 ? "Remove upvote" : "Upvote"}
              aria-pressed={post.user_vote === 1}
              className={cn(
                "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2.5 text-neutral-500 transition-colors",
                "hover:bg-neutral-200/80 hover:text-neutral-800",
                "active:text-neutral-800",
                post.user_vote === 1 && "bg-neutral-200/90 text-neutral-800",
              )}
            >
              <CircleArrowUp className="size-7 shrink-" strokeWidth={STROKE} />
              {post.vote_count > 0 ? (
                <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                  {post.vote_count}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !isExpanded
                setExpanded(next)
                window.requestAnimationFrame(() => {
                  if (next) document.getElementById(commentFieldId)?.focus()
                })
              }}
              aria-label={isExpanded ? "Hide comments" : "Show comments"}
              aria-expanded={isExpanded}
              className={cn(
                "group inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2.5 text-neutral-700 transition-colors",
                "hover:bg-neutral-200/80",
                isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100 active:opacity-100",
              )}
            >
              <MessageCircleIcon className="size-6 shrink-0" />
              {post.comment_count > 0 ? (
                <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                  {post.comment_count}
                </span>
              ) : null}
            </button>
          </div>

          <PostCommentsBlock
            post={post}
            isExpanded={isExpanded}
            showAllComments={showAllComments}
            onToggleShowAll={() => setShowAllComments((v) => !v)}
            commentInput={commentInput}
            onCommentInputChange={setCommentInput}
            onSubmitTopLevel={() => void submitTopLevel()}
            replyOpenId={replyOpenId}
            replyDraft={replyDraft}
            onToggleReply={(c) => {
              setReplyOpenId((cur) => {
                if (cur === c.id) {
                  setReplyDraft("")
                  return null
                }
                setReplyDraft(`${mentionToken(toMentionUser(c.author))} `)
                return c.id
              })
            }}
            onReplyDraftChange={setReplyDraft}
            onSubmitReply={(parentId) => void submitReply(parentId)}
            sessionUser={sessionUser}
            menuOpenId={menuOpenId}
            onMenuOpenChange={setMenuOpenId}
            editingId={editingId}
            editDraft={editDraft}
            onStartEdit={(c) => {
              setEditingId(c.id)
              setEditDraft(c.body)
              setReplyOpenId(null)
            }}
            onEditDraftChange={setEditDraft}
            onCancelEdit={() => {
              setEditingId(null)
              setEditDraft("")
            }}
            onSaveEdit={(commentId) => {
              void onEditComment(post.id, commentId, editDraft.trim()).then(() => {
                setEditingId(null)
                setEditDraft("")
              })
            }}
            onDelete={(commentId) => void onDeleteComment(post.id, commentId)}
            commentFieldId={commentFieldId}
          />
        </div>
      </article>

      <ReportPostDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        concernId={post.id}
      />
    </>
  )
}
