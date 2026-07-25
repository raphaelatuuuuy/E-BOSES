import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { PaperPlaneTilt as PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import type { ConcernComment, PublicUser } from "@/features/dashboard/api"
import { MentionTextField } from "@/features/dashboard/components/comment-mentions"
import {
  firstNameOf,
  renderCommentBody,
  type MentionUser,
} from "@/features/dashboard/utils/comment-mentions-utils"
import { CommentMoreMenu } from "@/features/dashboard/components/report-post-dialog"
import { commentPlaceLabel } from "@/features/dashboard/pages/feed-comment-item.utils"
import { CommentEditForm } from "@/features/dashboard/components/feed-comment-parts"

function UserAvatar({ user, size = "sm", className }: { user?: { full_name?: string; first_name?: string } | null; size?: string; className?: string }) {
  const letter = (user?.first_name?.[0] || user?.full_name?.[0] || "?").toUpperCase()
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
      size === "sm" ? "size-9 text-[16px]" : "size-10 text-[17px]",
      className,
    )}>
      {letter}
    </span>
  )
}

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

export function FeedCommentItem({
  postId,
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
  postId: number
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
    const timer = window.setTimeout(() => setShowOriginal(false), 0)
    return () => window.clearTimeout(timer)
  }, [comment.id, comment.body, comment.is_edited])

  const hasReplies = !isReply && comment.replies.length > 0
  const replyIdsKey = comment.replies.map((reply) => reply.id).join(",")
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
    const ro = typeof ResizeObserver !== "undefined" && rootEl ? new ResizeObserver(() => measure()) : null
    if (rootEl && ro) ro.observe(rootEl)
    window.addEventListener("resize", measure)
    return () => {
      window.cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [hasReplies, comment.replies.length, replyIdsKey])

  const commentMain = (
    <>
      <div className="flex items-start gap-0.5">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] font-normal leading-[1.3] text-neutral-400">
            <span className="font-bold text-neutral-900">{comment.author.full_name}</span>
            <span className="mx-1">·</span>
            <span>{timeAgo(comment.created_at)}</span>
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
            <CommentEditForm
              editDraft={editDraft}
              onEditDraftChange={onEditDraftChange}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              commentId={comment.id}
            />
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
          <UserAvatar user={sessionUser} size="sm" className="!size-7 !text-[12px]" />
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
              <PaperPlaneTiltIcon className="size-4" aria-hidden weight="bold" />
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
        <UserAvatar
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
            style={{ left: threadBox.left, top: threadBox.top, width: threadBox.width, height: threadBox.height }}
          />
          <div className="relative z-[1] space-y-3 pl-10 pt-3">
            {comment.replies.map((reply, index) => {
              const isLast = index === comment.replies.length - 1
              return (
                <div key={reply.id} className="flex items-start gap-2.5">
                  <div ref={isLast ? lastReplyAvatarRef : undefined} className="shrink-0">
                    <UserAvatar
                      user={reply.author}
                      size="sm"
                      className="!size-8 !text-[13px] leading-none !bg-[#c5d0e6] !text-[#2c3a5a]"
                    />
                  </div>
                  <FeedCommentItem
                    postId={postId}
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
