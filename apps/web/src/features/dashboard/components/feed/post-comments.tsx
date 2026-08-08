import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { SendIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  type Concern,
  type ConcernComment,
  type PublicUser,
} from "@/features/dashboard/api"
import {
  collectThreadMentionUsers,
  firstNameOf,
  renderCommentBody,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import { MentionTextField } from "@/features/dashboard/components/mention-text-field"
import { CommentMoreMenu } from "@/features/dashboard/components/report-post-dialog"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { commentPlaceLabel, timeAgo } from "@/features/dashboard/components/home/home-style"

/**
 * Nextdoor-style comment + one-level replies only (no reply-to-reply stack).
 * Own comments: ⋯ menu → Edit / Delete.
 */
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
  /** Top-level comment id (for attaching replies only once) */
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
  // Reply allowed on top-level and nested; still stores under rootCommentId
  const isReplying = replyOpenId === comment.id
  const isEditing = editingId === comment.id
  const menuOpen = menuOpenId === comment.id
  const place = commentPlaceLabel(comment.author)
  const [showOriginal, setShowOriginal] = useState(false)
  const isEdited = Boolean(comment.is_edited)
  const originalText = (comment.original_body || "").trim()

  // Reset original preview when comment body changes after reload
  useEffect(() => {
    const timer = window.setTimeout(() => setShowOriginal(false), 0)
    return () => window.clearTimeout(timer)
  }, [comment.id, comment.body, comment.is_edited])

  const hasReplies = !isReply && comment.replies.length > 0
  const threadRootRef = useRef<HTMLDivElement>(null)
  const lastReplyAvatarRef = useRef<HTMLDivElement>(null)
  const [threadBox, setThreadBox] = useState({
    top: 32,
    height: 80,
    left: 15,
    width: 29,
  })

  // Always pin the L-curve to the last reply avatar center (from top),
  // so opening the reply composer below does not slide the elbow away.
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
      typeof ResizeObserver !== "undefined" && rootEl
        ? new ResizeObserver(() => measure())
        : null
    if (rootEl && ro) ro.observe(rootEl)
    window.addEventListener("resize", measure)
    return () => {
      window.cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [hasReplies, comment.replies.length, comment.replies])

  /** Shared header + body + actions (used for root and nested) */
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
              {comment.replies.length}{" "}
              {comment.replies.length === 1 ? "reply" : "replies"}
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
              <SendIcon className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )

  // Nested reply content only (parent draws avatar + thread path)
  if (isReply) {
    return <div className="min-w-0 flex-1">{commentMain}</div>
  }

  /**
   * Thread style (matches Nextdoor screenshot):
   *   [Main avatar]
   *        |
   *        └──── [Latest reply avatar]
   * Curve is measured to the last reply avatar so opening the reply
   * composer does not move the line until a new reply is submitted.
   */
  return (
    <div ref={threadRootRef} className="relative">
      <div className="flex items-start gap-2.5">
        <UserAvatar
          user={comment.author}
          size="sm"
          className="relative z-10 !size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"
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
                  <div
                    ref={isLast ? lastReplyAvatarRef : undefined}
                    className="shrink-0"
                  >
                    <UserAvatar
                      user={reply.author}
                      size="sm"
                      className="!size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"
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

export function PostCommentsBlock({
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
}) {
  if (!isExpanded) return null

  const roots = post.comments
  const hiddenCount = Math.max(0, roots.length - 1)
  const visibleRoots =
    showAllComments || roots.length <= 1 ? roots : roots.slice(-1)
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
              postId={post.id}
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
        <UserAvatar user={sessionUser} size="sm" className="size-8 text-[14px]" />
        <div className="relative min-w-0 flex-1">
          <MentionTextField
            id={`home-comment-${post.id}`}
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