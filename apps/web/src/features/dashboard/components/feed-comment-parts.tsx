import { useEffect, useRef } from "react"
import { PaperPlaneTilt } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"
import type { PublicUser } from "@/features/dashboard/api"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"
import { MentionTextField } from "@/features/dashboard/components/comment-mentions"
import {
  firstNameOf,
  type MentionUser,
} from "@/features/dashboard/utils/comment-mentions-utils"

export function CommentEditForm({
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  commentId,
}: {
  editDraft: string
  onEditDraftChange: (value: string) => void
  onSaveEdit: (commentId: number) => void
  onCancelEdit: () => void
  commentId: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { textareaRef.current?.focus() }, [])

  return (
    <div className="mt-1 space-y-2">
      <textarea
        ref={textareaRef}
        value={editDraft}
        onChange={(e) => onEditDraftChange(e.target.value.slice(0, 1000))}
        rows={2}
        aria-label="Edit post content"
        className={cn(
          "w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[15px] text-neutral-900 outline-none",
          "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
        )}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!editDraft.trim()}
          onClick={() => onSaveEdit(commentId)}
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
  )
}

export function CommentReplyForm({
  replyDraft,
  onReplyDraftChange,
  onSubmitReply,
  sessionUser,
  mentionUsers,
  rootCommentId,
  authorName,
}: {
  replyDraft: string
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (rootParentId: number) => void
  onToggleReply: () => void
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  rootCommentId: number
  authorName: string
  isReplying: boolean
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <FeedUserAvatar user={sessionUser} size="sm" className="!size-7 !text-[12px]" />
      <div className="relative min-w-0 flex-1">
        <MentionTextField
          autoFocus
          compact
          value={replyDraft}
          onChange={onReplyDraftChange}
          onSubmit={() => onSubmitReply(rootCommentId)}
          placeholder={`Reply to ${firstNameOf(authorName)}…`}
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
          <PaperPlaneTilt className="size-4" aria-hidden weight="bold" />
        </button>
      </div>
    </div>
  )
}
