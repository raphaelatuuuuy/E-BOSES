import { SendIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { UserAvatar, type AvatarUser } from "@/features/dashboard/components/home/user-avatar"
import { MentionTextField } from "@/features/dashboard/components/mention-text-field"
import type { MentionUser } from "@/features/dashboard/components/comment-mentions"

export const COMMENT_MIN_LENGTH = 2

export function CommentComposer({
  id,
  value,
  onChange,
  onSubmit,
  placeholder = "Add a comment",
  sessionUser,
  mentionUsers = [],
  compact = false,
  autoFocus = false,
  disabled = false,
  className,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  placeholder?: string
  sessionUser?: AvatarUser | null
  mentionUsers?: MentionUser[]
  compact?: boolean
  autoFocus?: boolean
  disabled?: boolean
  className?: string
}) {
  const ready = value.trim().length >= COMMENT_MIN_LENGTH && !disabled

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <UserAvatar
        user={sessionUser}
        size="sm"
        className={compact ? "!size-7 !text-[12px]" : "!size-8 !text-[13px]"}
      />
      <div className="relative min-w-0 flex-1">
        <MentionTextField
          id={id}
          autoFocus={autoFocus}
          compact={compact}
          value={value}
          onChange={onChange}
          onSubmit={() => ready && onSubmit()}
          placeholder={placeholder}
          localUsers={mentionUsers}
        />
        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          aria-label="Send comment"
          className={cn(
            "absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full transition-colors",
            compact ? "size-7" : "size-8",
            ready
              ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
              : "cursor-not-allowed text-neutral-300",
          )}
        >
          <SendIcon className={compact ? "size-4" : "size-4.5"} />
        </button>
      </div>
    </div>
  )
}
