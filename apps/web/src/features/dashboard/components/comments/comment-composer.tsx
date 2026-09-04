import { Loader2Icon, PaperclipIcon, SendIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { UserAvatar, type AvatarUser } from "@/features/dashboard/components/home/user-avatar"
import { MentionTextField } from "@/features/dashboard/components/mention-text-field"
import type { MentionUser } from "@/features/dashboard/components/comment-mentions"

export const COMMENT_MIN_LENGTH = 2

/** A small local preview used by every message/comment composer. */
export function LocalAttachmentPreview({
  file,
  onRemove,
  className,
  compact = false,
}: {
  file: File
  onRemove: () => void
  className?: string
  compact?: boolean
}) {
  const image = file.type.startsWith("image/")
  const url = useMemo(() => (image ? URL.createObjectURL(file) : null), [file, image])

  useEffect(() => {
    if (!url) return
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [url])

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-visible rounded-lg border border-neutral-200 bg-neutral-50",
        compact ? "size-8" : "size-9",
        className,
      )}
      title={image ? "Attached image" : "Attached video"}
    >
      {image && url ? (
        <img src={url} alt="Attached image" className="size-full rounded-[7px] object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-neutral-500">
          <PaperclipIcon className="size-4" aria-hidden />
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-950"
      >
        <XIcon className="size-2.5" />
      </button>
    </div>
  )
}

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
  onSubmit: (media: File | null) => Promise<boolean | void> | boolean | void
  placeholder?: string
  sessionUser?: AvatarUser | null
  mentionUsers?: MentionUser[]
  compact?: boolean
  autoFocus?: boolean
  disabled?: boolean
  className?: string
}) {
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const ready = value.trim().length >= COMMENT_MIN_LENGTH && !disabled

  async function submit() {
    if (!ready || sending) return
    setSending(true)
    setFeedback(null)
    try {
      const result = await onSubmit(null)
      if (result === false) {
        setFeedback("Could not send. Please try again.")
        return
      }
      setFeedback("Comment sent")
      window.setTimeout(() => setFeedback(null), 2200)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not send. Please try again.")
    } finally {
      setSending(false)
    }
  }

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
          onSubmit={() => void submit()}
          placeholder={placeholder}
          localUsers={mentionUsers}
          inputClassName={cn(sending && "pointer-events-none opacity-60")}
        />
        <button
          type="button"
          disabled={!ready || sending}
          onClick={() => void submit()}
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
        {feedback ? (
          <span
            role="status"
            className={cn(
              "absolute right-11 top-full z-10 mt-1 text-[11px] font-medium",
              feedback.startsWith("Could") || feedback.includes("try again")
                ? "text-red-500"
                : "text-neutral-500",
            )}
          >
            {sending ? <Loader2Icon className="mr-1 inline size-3 animate-spin" /> : null}
            {feedback}
          </span>
        ) : sending ? (
          <span role="status" className="absolute right-11 top-full z-10 mt-1 text-[11px] font-medium text-neutral-500">
            <Loader2Icon className="mr-1 inline size-3 animate-spin" />Sending…
          </span>
        ) : null}
      </div>
    </div>
  )
}
