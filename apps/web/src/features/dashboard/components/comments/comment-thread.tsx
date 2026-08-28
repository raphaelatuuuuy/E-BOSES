import { useEffect, useState, type ReactNode } from "react"
import { MessageCircleIcon, MoreHorizontalIcon } from "lucide-react"

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

/**
 * A pseudo-comment row (resolution banner, neighbour report) that pins root
 * comments beneath it so replies to it render nested instead of at the end.
 */
export interface CommentThreadAnchor {
  key: string | number
  node: ReactNode
  comments: UnifiedComment[]
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
  /** Pseudo-comment rows whose replies render nested beneath them. */
  anchors?: CommentThreadAnchor[]
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
  anchors,
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
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  useEffect(() => {
    if (openMenuId == null) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest?.("[data-comment-menu]")) return
      setOpenMenuId(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenuId(null)
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDocClick)
      document.addEventListener("keydown", onKeyDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [openMenuId])

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

    const hasMenuActions =
      allowReplies ||
      (comment.isMine && Boolean(onEdit || onDelete)) ||
      (!comment.isMine && Boolean(onRemove || onReport))

    const menu = hasMenuActions ? (
      <div data-comment-menu className="relative">
        <button
          type="button"
          aria-label="Comment actions"
          aria-haspopup="menu"
          aria-expanded={openMenuId === comment.id}
          title="Comment actions"
          onClick={() => setOpenMenuId((current) => (current === comment.id ? null : comment.id))}
          className="-my-1 inline-flex size-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
        >
          <MoreHorizontalIcon className="size-4" strokeWidth={2} />
        </button>
        {openMenuId === comment.id ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg"
          >
            {allowReplies ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-neutral-700 hover:bg-neutral-100"
                onClick={() => {
                  const opening = !isReplying
                  setOpenMenuId(null)
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
                {isReplying ? "Cancel reply" : "Reply"}
              </button>
            ) : null}
            {comment.isMine && onEdit ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-neutral-700 hover:bg-neutral-100"
                onClick={() => {
                  setOpenMenuId(null)
                  setEditingId(comment.id)
                  setEditDraft(comment.body)
                }}
              >
                Edit
              </button>
            ) : null}
            {comment.isMine && onDelete ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-neutral-700 hover:bg-neutral-100"
                onClick={() => {
                  setOpenMenuId(null)
                  void onDelete(comment.id)
                }}
              >
                Delete
              </button>
            ) : null}
            {!comment.isMine && onRemove ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-neutral-700 hover:bg-neutral-100"
                onClick={() => {
                  setOpenMenuId(null)
                  void onRemove(comment.id)
                }}
              >
                Hide
              </button>
            ) : null}
            {!comment.isMine && onReport ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-red-600 hover:bg-red-50"
                onClick={() => {
                  setOpenMenuId(null)
                  onReport(comment.id)
                }}
              >
                Report
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null

    const replyCount =
      !isReply && comment.replies.length > 0 ? (
        <span className="text-[12px] font-medium text-neutral-400">
          {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
        </span>
      ) : null

    return (
      <div key={comment.id} className="space-y-3">
        <CommentRow
          comment={comment}
          meta={isEditing ? null : menu}
          actions={replyCount}
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

      {anchors?.map((group) => (
        <div key={group.key} className="space-y-3">
          {group.node}
          {group.comments.length > 0 ? (
            <div className={cn("space-y-3", REPLY_INDENT)}>
              {group.comments.map((member, index) => (
                <div key={member.id} className="relative">
                  <span aria-hidden className={REPLY_CURVE} />
                  {index < group.comments.length - 1 ? (
                    <span aria-hidden className={REPLY_TRUNK} />
                  ) : null}
                  {renderComment(member, member.id, false)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}

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
