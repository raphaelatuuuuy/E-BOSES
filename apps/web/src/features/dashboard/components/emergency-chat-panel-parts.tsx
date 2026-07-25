import { PaperPlaneRight, Paperclip, Spinner, Users, X } from "@phosphor-icons/react"
import { Spinner as Loader2Icon } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"

import type { EmergencyChatMessage } from "@/features/dashboard/emergency-api"
import type { PublicUser } from "@/features/dashboard/api"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"

const chatTimeFormatter = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
})

function formatChatTime(value: string) {
  return chatTimeFormatter.format(new Date(value))
}

function unitLabel(unit?: string) {
  if (unit === "tanod") return "Tanod"
  if (unit === "bhw") return "BHW"
  if (unit === "bdrrmo") return "BDRRMO"
  if (unit === "other") return "Responder"
  return ""
}

function roleLabel(user?: PublicUser | null) {
  if (!user) return ""
  if (user.role === "resident") return "Resident"
  const unit = unitLabel(user.responder_unit)
  if (unit) return unit
  if (user.role === "first_responder") return "Responder"
  if (user.role === "barangay_official") return "Official"
  return user.role?.replace(/_/g, " ") || ""
}

export function ChatHeader({
  participantHint,
  connectionState,
  loading,
  isDark,
}: {
  participantHint?: string
  connectionState: "connecting" | "live" | "polling"
  loading: boolean
  isDark: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b px-4 py-3.5",
        isDark ? "border-white/10 bg-white/5" : "border-slate-100 bg-gradient-to-b from-white to-slate-50/80",
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "text-[12px] font-semibold tracking-wide uppercase",
            isDark ? "text-white/60" : "text-[#68739c]",
          )}
        >
          Live chat
        </p>
        <p
          className={cn(
            "flex items-center gap-1 text-[11px]",
            isDark ? "text-white/45" : "text-[#68739c]",
          )}
        >
          <Users className="size-3 shrink-0" />
          <span className="truncate">
            {participantHint || "Group room · resident + assigned responders"}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{connectionState === "live" ? "Live" : connectionState === "connecting" ? "Connecting" : "Polling"}</span>
        </p>
      </div>
      {loading ? (
        <Loader2Icon
          className={cn("size-4 animate-spin", isDark ? "text-white/50" : "text-slate-400")}
        />
      ) : null}
    </div>
  )
}

export function ChatMessagesList({
  messages,
  hasOlder,
  loadError,
  loading,
  isDark,
  isMine,
  typingNames,
  bottomRef,
  onLoadOlder,
  onRetry,
}: {
  messages: EmergencyChatMessage[]
  hasOlder: boolean
  loadError: string
  loading: boolean
  isDark: boolean
  isMine: (msg: EmergencyChatMessage) => boolean
  typingNames: string[]
  bottomRef: React.RefObject<HTMLDivElement | null>
  onLoadOlder: () => void
  onRetry: () => void
}) {
  return (
    <div className={cn("max-h-[520px] min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4", isDark ? "bg-black/10" : "bg-[radial-gradient(circle_at_top_left,rgba(255,106,26,0.08),transparent_28%),linear-gradient(180deg,#fbfbfc,#f6f7f9)]")}>
      {hasOlder ? (
        <button type="button" onClick={onLoadOlder} className={cn("mx-auto block rounded-full border px-3 py-1.5 text-xs font-bold", isDark ? "border-white/20 text-white/70 hover:bg-white/10" : "border-slate-200 text-[#07145f] hover:bg-slate-50")}>
          Load older messages
        </button>
      ) : null}
      {loadError && messages.length === 0 && !loading ? (
        <div className="py-6 text-center">
          <p className={cn("text-[12px]", isDark ? "text-red-200" : "text-red-600")}>{loadError}</p>
          <button type="button" onClick={onRetry} className={cn("mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold", isDark ? "border-white/20 text-white" : "border-slate-200 text-[#07145f]")}>Try again</button>
        </div>
      ) : messages.length === 0 && !loading ? (
        <p
          className={cn(
            "py-6 text-center text-[12px]",
            isDark ? "text-white/45" : "text-[#68739c]",
          )}
        >
          Group chat is open. Status updates (en route, nearby, arrived) appear here automatically.
          Everyone assigned to this alert can read and reply.
        </p>
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
            <div className={cn("min-w-0 max-w-[78%]", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-0.5",
                  mine ? "justify-end" : "justify-start",
                )}
              >
                <span
                  className={cn(
                    "text-[12px] font-semibold",
                    isDark ? "text-white" : "text-[#07145f]",
                  )}
                >
                  {mine ? "You" : name}
                </span>
                {role && !mine ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px text-[10px] font-medium",
                      isDark
                        ? "bg-white/15 text-white/70"
                        : "bg-[#eaf0ff] text-[#07145f]",
                    )}
                  >
                    {role}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isDark ? "text-white/40" : "text-slate-400",
                  )}
                >
                  {formatChatTime(msg.created_at)}
                </span>
              </div>
              <div
                className={cn(
                  "rounded-[1.15rem] px-3.5 py-2.5 text-[13px] leading-5 shadow-sm ring-1",
                  mine
                    ? "rounded-br-md bg-[#ff6a1a] text-white ring-[#ff6a1a]/20 shadow-[0_10px_24px_rgba(255,106,26,0.22)]"
                    : isDark
                      ? "rounded-bl-md bg-white text-neutral-900 ring-white/20"
                      : "rounded-bl-md bg-white text-[#1a2340] ring-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]",
                )}
              >
                {msg.body ? <p>{msg.body}</p> : null}
                {msg.attachment ? (
                  <div className="mt-2 space-y-1">
                    {msg.attachment.media_type === "image" && msg.attachment.preview_url ? (
                      <AuthenticatedMediaImage
                        src={msg.attachment.preview_url}
                        alt={msg.attachment.original_filename}
                        className="max-h-40 max-w-full rounded-lg object-cover"
                      />
                    ) : (
                      <button
                        type="button"
                        className="text-left text-[12px] underline"
                        onClick={() => void openAuthenticatedMedia(msg.attachment!.raw_url, msg.attachment!.original_filename)}
                      >
                        Open {msg.attachment.original_filename}
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
        <p className={cn("px-2 text-xs font-semibold", isDark ? "text-white/55" : "text-slate-500")}>
          {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.length} people are typing…`}
        </p>
      ) : null}
      <div ref={bottomRef} />
    </div>
  )
}

export function ChatInputBar({
  draft,
  sending,
  attachment,
  isDark,
  alertId,
  onDraftChange,
  onSend,
  onAttachmentChange,
  onAttachmentRemove,
  onBlur,
}: {
  draft: string
  sending: boolean
  attachment: File | null
  disabled?: boolean
  isDark: boolean
  alertId: number
  onDraftChange: (value: string) => void
  onSend: () => void
  onAttachmentChange: (file: File | null) => void
  onAttachmentRemove: () => void
  onBlur: () => void
}) {
  return (
    <div
      className={cn(
        "relative flex items-end gap-2 border-t p-3 shadow-[0_-10px_30px_rgba(15,23,42,0.04)]",
        isDark ? "border-white/10 bg-black/10" : "border-slate-100 bg-white/95",
      )}
    >
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
        aria-label="Message the group" placeholder="Message the group…"
        className={cn(
          "max-h-32 min-h-11 flex-1 resize-none rounded-[1.1rem] border px-3.5 py-2.5 text-[13px] outline-none transition-colors focus:border-[#ff6a1a]",
          isDark
            ? "border-white/15 bg-black/25 text-white placeholder:text-white/40"
            : "border-slate-200 bg-[#f8fafc] text-[#07145f] placeholder:text-slate-400",
        )}
      />
      <input
        id={`emergency-chat-media-${alertId}`}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          if (!file) return
          if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return
          if (file.size > 25 * 1024 * 1024) return
          onAttachmentChange(file)
        }}
      />
      <label
        htmlFor={`emergency-chat-media-${alertId}`}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
        aria-label="Attach image or video"
      >
        <Paperclip className="size-4" />
      </label>
      {attachment ? (
        <button
          type="button"
          className="absolute bottom-14 left-3 flex max-w-[70%] items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
          onClick={onAttachmentRemove}
          aria-label="Remove attachment"
        >
          <span className="truncate">{attachment.name}</span><X className="size-3 shrink-0" />
        </button>
      ) : null}
      <button
        type="button"
        disabled={sending || (!draft.trim() && !attachment)}
        onClick={onSend}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17] disabled:opacity-50"
        aria-label="Send message"
      >
        {sending ? <Spinner className="size-4 animate-spin" /> : <PaperPlaneRight className="size-4" />}
      </button>
    </div>
  )
}
