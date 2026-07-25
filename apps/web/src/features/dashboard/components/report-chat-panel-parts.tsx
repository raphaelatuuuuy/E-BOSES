import { ChatCircle, PaperPlaneRight, Paperclip, Spinner, Video, X } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"
import type { ConcernChatMessage, PublicUser } from "@/features/dashboard/api"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"

const chatTimeFormatter = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
})

function formatChatTime(value: string) {
  return chatTimeFormatter.format(new Date(value))
}

function roleLabel(user?: PublicUser | null) {
  if (!user) return ""
  if (user.role === "resident") return "Resident"
  if (user.role === "barangay_official") return "Official"
  if (user.role === "first_responder") return "Responder"
  return user.role?.replace(/_/g, " ") || ""
}

export function ReportChatHeader({
  title,
  subtitle,
  connectionState,
  loading,
}: {
  title: string
  subtitle: string
  connectionState: "connecting" | "live" | "degraded"
  loading: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-gradient-to-b from-white to-neutral-50/80 px-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-900">
          <ChatCircle className="size-4 shrink-0 text-[#ff6a1a]" weight="bold" />
          {title}
        </p>
        <p className="mt-0.5 text-[12px] font-medium text-neutral-500">
          {subtitle} · {connectionState === "live" ? "Live" : connectionState === "connecting" ? "Connecting…" : "Polling"}
        </p>
      </div>
      {loading ? <Spinner className="size-4 animate-spin text-neutral-400" /> : null}
    </div>
  )
}

export function ReportChatMessagesList({
  messages,
  hasOlder,
  loadError,
  loading,
  emptyMessage,
  isMine,
  typingNames,
  showHistory,
  bottomRef,
  onLoadOlder,
  onRetry,
}: {
  messages: ConcernChatMessage[]
  hasOlder: boolean
  loadError: string | null
  loading: boolean
  emptyMessage: string
  isMine: (msg: ConcernChatMessage) => boolean
  typingNames: string[]
  showHistory: boolean
  bottomRef: React.RefObject<HTMLDivElement | null>
  onLoadOlder: () => void
  onRetry: () => void
}) {
  if (!showHistory) return null

  return (
    <div className="max-h-[520px] min-h-0 flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(255,106,26,0.08),transparent_28%),linear-gradient(180deg,#fbfbfc,#f6f7f9)] px-3 py-4 sm:px-4">
      {hasOlder ? (
        <button type="button" onClick={onLoadOlder} className="mx-auto block rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50">
          Load older messages
        </button>
      ) : null}
      {messages.length === 0 && !loading ? (
        loadError ? (
          <div className="py-8 text-center">
            <p className="text-[13px] leading-5 text-red-600">{loadError}</p>
            <button type="button" onClick={onRetry} className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Try again</button>
          </div>
        ) : <p className="py-8 text-center text-[13px] leading-5 text-neutral-500">{emptyMessage}</p>
      ) : null}

      {messages.map((msg) => {
        const mine = isMine(msg)
        const name = msg.sender?.full_name || "User"
        const role = roleLabel(msg.sender)
        return (
          <div
            key={msg.id}
            className={cn("flex gap-2", mine ? "flex-row-reverse" : "flex-row")}
          >
            <FeedUserAvatar user={msg.sender} size="sm" className="!size-8 !text-[13px]" />
            <div className="min-w-0 max-w-[80%]">
              <div
                className={cn(
                  "mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-0.5",
                  mine ? "justify-end" : "justify-start",
                )}
              >
                <span className="text-[12px] font-semibold text-neutral-900">
                  {mine ? "You" : name}
                </span>
                {role && !mine ? (
                  <span className="rounded-full bg-[#eef3ff] px-1.5 py-px text-[10px] font-semibold text-[#07145f]">
                    {role}
                  </span>
                ) : null}
                <span className="text-[10px] tabular-nums text-neutral-400">
                  {formatChatTime(msg.created_at)}
                </span>
              </div>
              <div
                className={cn(
                  "rounded-[1.15rem] px-3.5 py-2.5 text-[13px] leading-5 shadow-sm ring-1",
                  mine
                    ? "rounded-br-md bg-[#ff6a1a] text-white ring-[#ff6a1a]/20 shadow-[0_10px_24px_rgba(255,106,26,0.22)]"
                    : "rounded-bl-md bg-white text-[#1a2340] ring-neutral-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]",
                )}
              >
                {msg.body ? <p>{msg.body}</p> : null}
                {msg.attachment ? (
                  <div className={cn(msg.body && "mt-2", "space-y-2")}>
                    {msg.attachment.kind === "image" ? (
                      <AuthenticatedMediaImage src={msg.attachment.raw_url} alt={msg.attachment.original_filename} className="max-h-48 w-full rounded-xl object-cover" />
                    ) : (
                      <button type="button" onClick={() => void openAuthenticatedMedia(msg.attachment!.raw_url, msg.attachment!.original_filename)} className="flex w-full items-center gap-2 rounded-xl border border-current/20 px-3 py-3 text-left text-xs font-bold hover:bg-white/10">
                        <Video className="size-5 shrink-0" /> Open video attachment
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
      {typingNames.length ? (
        <p className="px-2 text-xs font-semibold text-neutral-500">
          {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.length} people are typing…`}
        </p>
      ) : null}
      <div ref={bottomRef} />
    </div>
  )
}

export function ReportChatInput({
  draft,
  sending,
  attachment,
  attachmentError,
  onDraftChange,
  onSend,
  onAttachmentChange,
  onAttachmentRemove,
  onBlur,
}: {
  draft: string
  sending: boolean
  attachment: File | null
  attachmentError: string | null
  disabled?: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
  onAttachmentChange: (file: File | null) => void
  onAttachmentRemove: () => void
  onBlur: () => void
}) {
  return (
    <div className="border-t border-neutral-100 bg-white/95 p-3 shadow-[0_-10px_30px_rgba(15,23,42,0.04)] sm:p-3.5">
      {attachment ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#cbd8ee] bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#07145f]">
          <span className="flex min-w-0 items-center gap-2 truncate"><Paperclip className="size-4 shrink-0" />{attachment.name}</span>
          <button type="button" onClick={onAttachmentRemove} className="rounded-full p-1 hover:bg-white" aria-label="Remove attachment"><X className="size-4" /></button>
        </div>
      ) : null}
      {attachmentError ? <p className="mb-2 text-xs font-semibold text-red-600">{attachmentError}</p> : null}
      <div className="flex items-end gap-2">
        <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:border-[#ff6a1a]/40 hover:bg-[#fff4ee] hover:text-[#ff6a1a]" aria-label="Attach image or video">
          <Paperclip className="size-4" />
          <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(event) => { onAttachmentChange(event.target.files?.[0] ?? null); event.currentTarget.value = "" }} />
        </label>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={1}
          aria-label="Write a message" placeholder="Write a message…"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[1.1rem] border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400 transition-colors focus:border-[#ff6a1a] focus:bg-white"
        />
        <button
          type="button"
          disabled={sending || (!draft.trim() && !attachment)}
          onClick={onSend}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#ff6a1a] text-white shadow-[0_10px_22px_rgba(255,106,26,0.28)] transition-colors hover:bg-[#e85f17] disabled:opacity-50 disabled:shadow-none"
          aria-label="Send message"
        >
          {sending ? (
            <Spinner className="size-4 animate-spin" />
          ) : (
            <PaperPlaneRight className="size-4" weight="bold" />
          )}
        </button>
      </div>
    </div>
  )
}
