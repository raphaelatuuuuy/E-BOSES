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
  // Same footer affordance as the concern feed card — small icon plus
  // "N comments" text — minus the upvote part, which announcements do
  // not have. Right-aligned on its own, matching the feed card footer.
  return (
    <div className="-mx-3.5 rounded-b-lg px-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-expanded={active}
        aria-label={label}
        className={cn(
          "flex min-h-12 w-full items-center justify-center gap-2 text-[14px] font-semibold transition-colors",
          active
            ? "text-neutral-800"
            : "text-neutral-500 hover:text-neutral-800"
        )}
      >
        <MessageCircleIcon className="size-[22px] shrink-0" strokeWidth={2} />
        <span className="leading-none">{count > 0 ? `${count} ${count === 1 ? "comment" : "comments"}` : "Comment"}</span>
      </button>
    </div>
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
  onSubmit: (
    body: string,
    parentId: number | null,
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  onEdit?: (commentId: number, body: string) => Promise<void> | void
  onDelete?: (commentId: number) => Promise<void> | void
  /** Moderation removal, distinct from an author deleting their own comment. */
  onRemove?: (commentId: number) => Promise<void> | void
  /** A resident flagging someone else's comment for staff review. */
  onReport?: (commentId: number) => void
  allowReplies?: boolean
  /** Render the root comment composer. Disable for read-only discussions. */
  showComposer?: boolean
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
  showComposer = true,
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
    collapseToLatest && !showAll && comments.length > 1
      ? comments.slice(-1)
      : comments

  async function run(
    action: () => Promise<boolean | void> | boolean | void
  ): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      return (await action()) !== false
    } finally {
      setBusy(false)
    }
  }

  async function submitRoot(media: File | null = null): Promise<boolean> {
    const body = draft.trim()
    if (body.length < COMMENT_MIN_LENGTH && !media) return false
    return run(async () => {
      const result = await onSubmit(body, null, media)
      if (result === false) return false
      setDraft("")
      return true
    })
  }

  async function submitReply(
    parentId: number,
    media: File | null = null
  ): Promise<boolean> {
    const body = replyDraft.trim()
    if (body.length < COMMENT_MIN_LENGTH && !media) return false
    return run(async () => {
      const result = await onSubmit(body, parentId, media)
      if (result === false) return false
      setReplyDraft("")
      setReplyOpenId(null)
      return true
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

  function renderComment(
    comment: UnifiedComment,
    rootId: number,
    isReply: boolean
  ) {
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
          onClick={() =>
            setOpenMenuId((current) =>
              current === comment.id ? null : comment.id
            )
          }
          className="-my-1 inline-flex size-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
        >
          <MoreHorizontalIcon className="size-4" strokeWidth={2} />
        </button>
        {openMenuId === comment.id ? (
          <div
            role="menu"
            className="absolute top-full right-0 z-20 mt-1 min-w-32 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg"
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
                      : ""
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
          {comment.replies.length}{" "}
          {comment.replies.length === 1 ? "reply" : "replies"}
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
                onChange={(event) =>
                  setEditDraft(event.target.value.slice(0, 1000))
                }
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
                      : "cursor-not-allowed bg-neutral-200 text-neutral-400"
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
              onSubmit={(media) => submitReply(rootId, media)}
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
        <p className="text-[13px] leading-relaxed text-neutral-500">
          {emptyState}
        </p>
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
        <p className="text-[13px] leading-relaxed text-neutral-500">
          {closedNotice}
        </p>
      ) : showComposer ? (
        <CommentComposer
          id={composerId}
          value={draft}
          onChange={setDraft}
          onSubmit={submitRoot}
          placeholder={placeholder}
          sessionUser={sessionUser}
          mentionUsers={mentionUsers}
          autoFocus={autoFocusComposer}
          disabled={busy}
        />
      ) : null}
    </div>
  )
}
