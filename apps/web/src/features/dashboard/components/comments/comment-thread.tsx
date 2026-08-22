import { useState, type ReactNode } from "react"
import { MessageCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  firstNameOf,
  mentionToken,
  toMentionUser,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import type { AvatarUser } from "@/features/dashboard/components/home/user-avatar"
import { CommentComposer, COMMENT_MIN_LENGTH } from "./comment-composer"
import {
  CommentAction,
  CommentRow,
  REPLY_CURVE,
  REPLY_INDENT,
  REPLY_TRUNK,
} from "./comment-row"
import type { UnifiedComment } from "./comment-types"

export function CommentToggleButton({
  count,
  active,
  onClick,
  label = "Comments",
}: {
  count: number
  active: boolean
  onClick: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={label}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 transition-colors",
        active ? "bg-neutral-200/90" : "bg-neutral-100 hover:bg-neutral-200/70",
      )}
    >
      <MessageCircleIcon className="size-6 text-neutral-700" strokeWidth={1.8} />
      {count > 0 ? (
        <span className="text-[13px] font-semibold tabular-nums text-neutral-700">{count}</span>
      ) : null}
    </button>
  )
}

export interface CommentThreadProps {
  comments: UnifiedComment[]
  sessionUser?: AvatarUser | null
  mentionUsers?: MentionUser[]
  composerId?: string
  placeholder?: string
  autoFocusComposer?: boolean
  /** Collapse to the newest root comment until the reader asks for more. */
  collapseToLatest?: boolean
  emptyState?: ReactNode
  closedNotice?: ReactNode
  header?: ReactNode
  /** Controlled composer text. Omit to let the thread own its own draft. */
  value?: string
  onValueChange?: (next: string) => void
  onSubmit: (body: string, parentId: number | null) => Promise<void> | void
  onEdit?: (commentId: number, body: string) => Promise<void> | void
  onDelete?: (commentId: number) => Promise<void> | void
  /** Moderation removal, distinct from an author deleting their own comment. */
  onRemove?: (commentId: number) => Promise<void> | void
  /** A resident flagging someone else's comment for staff review. */
  onReport?: (commentId: number) => void
  allowReplies?: boolean
  renderTrailing?: (comment: UnifiedComment) => ReactNode
  className?: string
}

export function CommentThread({
  comments,
  sessionUser = null,
  mentionUsers = [],
  composerId,
  placeholder = "Add a comment",
  autoFocusComposer = false,
  collapseToLatest = false,
  emptyState,
  closedNotice,
  header,
  value,
  onValueChange,
  onSubmit,
  onEdit,
  onDelete,
  onRemove,
  onReport,
  allowReplies = false,
  renderTrailing,
  className,
}: CommentThreadProps) {
  const [ownDraft, setOwnDraft] = useState("")
  const draft = value ?? ownDraft
  const setDraft = onValueChange ?? setOwnDraft
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")

  const hiddenCount = collapseToLatest ? Math.max(0, comments.length - 1) : 0
  const visible =
    collapseToLatest && !showAll && comments.length > 1 ? comments.slice(-1) : comments

  async function run(action: () => Promise<void> | void) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function submitRoot() {
    const body = draft.trim()
    if (body.length < COMMENT_MIN_LENGTH) return
    await run(async () => {
      await onSubmit(body, null)
      setDraft("")
    })
  }

  async function submitReply(parentId: number) {
    const body = replyDraft.trim()
    if (body.length < COMMENT_MIN_LENGTH) return
    await run(async () => {
      await onSubmit(body, parentId)
      setReplyDraft("")
      setReplyOpenId(null)
    })
  }

  async function saveEdit(commentId: number) {
    const body = editDraft.trim()
    if (!body || !onEdit) return
    await run(async () => {
      await onEdit(commentId, body)
      setEditingId(null)
      setEditDraft("")
    })
  }

  function renderComment(comment: UnifiedComment, rootId: number, isReply: boolean) {
    const isEditing = editingId === comment.id
    const isReplying = replyOpenId === comment.id

    const actions = (
      <>
        {allowReplies ? (
          <CommentAction
            onClick={() => {
              const opening = !isReplying
              setReplyOpenId(opening ? comment.id : null)
              // Replies flatten onto the root comment, so a reply-to-a-reply
              // has to carry who it answers as a real mention token.
              setReplyDraft(
                opening && isReply && comment.author.user
                  ? `${mentionToken(toMentionUser(comment.author.user))} `
                  : "",
              )
            }}
          >
            {isReplying ? "Cancel" : "Reply"}
          </CommentAction>
        ) : null}
        {!isReply && comment.replies.length > 0 ? (
          <span className="text-[12px] font-medium text-neutral-400">
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
          </span>
        ) : null}
        {comment.isMine && onEdit ? (
          <CommentAction
            onClick={() => {
              setEditingId(comment.id)
              setEditDraft(comment.body)
            }}
          >
            Edit
          </CommentAction>
        ) : null}
        {comment.isMine && onDelete ? (
          <CommentAction onClick={() => void onDelete(comment.id)}>Delete</CommentAction>
        ) : null}
        {!comment.isMine && onRemove ? (
          <CommentAction onClick={() => void onRemove(comment.id)}>Hide</CommentAction>
        ) : null}
        {!comment.isMine && onReport ? (
          <CommentAction onClick={() => onReport(comment.id)}>Report</CommentAction>
        ) : null}
      </>
    )

    return (
      <div key={comment.id} className="space-y-3">
        <CommentRow
          comment={comment}
          actions={isEditing ? null : actions}
          trailing={renderTrailing?.(comment)}
          trunk={!isReply && comment.replies.length > 0}
        >
          {isEditing ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value.slice(0, 1000))}
                rows={2}
                autoFocus
                className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[15px] text-neutral-900 outline-none focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editDraft.trim() || busy}
                  onClick={() => void saveEdit(comment.id)}
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
                  onClick={() => setEditingId(null)}
                  className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : undefined}
        </CommentRow>

        {/* Replies sit directly under the parent so the trunk stays unbroken;
            the composer goes below them, at the end of the thread. */}
        {!isReply && comment.replies.length > 0 ? (
          <div className={cn("space-y-3", REPLY_INDENT)}>
            {comment.replies.map((reply, index) => (
              <div key={reply.id} className="relative">
                <span aria-hidden className={REPLY_CURVE} />
                {index < comment.replies.length - 1 ? (
                  <span aria-hidden className={REPLY_TRUNK} />
                ) : null}
                {renderComment(reply, rootId, true)}
              </div>
            ))}
          </div>
        ) : null}

        {isReplying ? (
          <div className={isReply ? undefined : REPLY_INDENT}>
            <CommentComposer
              key={`reply-${comment.id}`}
              compact
              autoFocus
              value={replyDraft}
              onChange={setReplyDraft}
              onSubmit={() => void submitReply(rootId)}
              placeholder={`Reply to ${firstNameOf(comment.author.label)}…`}
              sessionUser={sessionUser}
              mentionUsers={mentionUsers}
              disabled={busy}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      {header}

      {comments.length === 0 && emptyState ? (
        <p className="text-[13px] leading-relaxed text-neutral-500">{emptyState}</p>
      ) : null}

      {hiddenCount > 0 ? (
        <CommentAction onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show less" : `See previous comments (${hiddenCount})`}
        </CommentAction>
      ) : null}

      {visible.length > 0 ? (
        <div className="space-y-3.5">
          {visible.map((comment) => renderComment(comment, comment.id, false))}
        </div>
      ) : null}

      {closedNotice ? (
        <p className="text-[13px] leading-relaxed text-neutral-500">{closedNotice}</p>
      ) : (
        <CommentComposer
          id={composerId}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submitRoot()}
          placeholder={placeholder}
          sessionUser={sessionUser}
          mentionUsers={mentionUsers}
          autoFocus={autoFocusComposer}
          disabled={busy}
        />
      )}
    </div>
  )
}
