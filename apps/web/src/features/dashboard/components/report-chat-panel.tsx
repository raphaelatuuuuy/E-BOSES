import { useCallback, useEffect, useRef, useState } from "react"
import { FileImageIcon, Loader2Icon, MessageCircleIcon, PaperclipIcon, SendIcon, VideoIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  listConcernChat,
  sendConcernChat,
  type ConcernChatMessage,
  type PublicUser,
} from "@/features/dashboard/api"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"
import { ApiError } from "@/lib/api"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"

function formatChatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function roleLabel(user?: PublicUser | null) {
  if (!user) return ""
  if (user.role === "resident") return "Resident"
  if (user.role === "barangay_official") return "Official"
  if (user.role === "first_responder") return "Responder"
  return user.role?.replace(/_/g, " ") || ""
}

export function ReportChatPanel({
  concernId,
  open = true,
  disabled,
  title = "Report chat",
  subtitle = "Private thread · you and barangay staff",
  emptyMessage = "Message the barangay team about this report — updates and questions stay here.",
  showHistory = true,
  onMessageSent,
  className,
}: {
  concernId: number
  open?: boolean
  /** When true, hide composer (e.g. rejected-only view) */
  disabled?: boolean
  title?: string
  subtitle?: string
  emptyMessage?: string
  showHistory?: boolean
  onMessageSent?: () => void | Promise<void>
  className?: string
}) {
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<ConcernChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isMine = useCallback(
    (msg: ConcernChatMessage) => {
      if (user?.id != null && msg.sender?.id != null) return msg.sender.id === user.id
      return Boolean(msg.is_mine)
    },
    [user],
  )

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
  }, [])

  const load = useCallback(async () => {
    if (!open || !concernId || !showHistory) return
    setLoading(true)
    setLoadError(null)
    try {
      const next = await listConcernChat(concernId)
      setMessages(next)
      scrollToBottom()
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403
        ? "You do not have access to this report chat."
        : error instanceof Error ? error.message : "Could not load chat."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [concernId, open, scrollToBottom, showHistory])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!open || !concernId || !showHistory) return
    const id = window.setInterval(() => {
      void listConcernChat(concernId)
        .then((next) => {
          setMessages((prev) => {
            if (next.length === prev.length && next.at(-1)?.id === prev.at(-1)?.id) return prev
            return next
          })
        })
      .catch(() => {
          /* A failed refresh should not erase a working conversation. */
        })
    }, 6000)
    return () => window.clearInterval(id)
  }, [open, concernId, showHistory])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  async function handleSend() {
    const body = draft.trim()
    if ((!body && !attachment) || sending || disabled) return
    setSending(true)
    try {
      const created = await sendConcernChat(concernId, body, attachment)
      setDraft("")
      setAttachment(null)
      setAttachmentError(null)
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev
        return [...prev, created]
      })
      await onMessageSent?.()
      scrollToBottom()
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403
        ? "You do not have permission to send messages in this report."
        : error instanceof Error ? error.message : "Could not send message."
      toast.error(message)
    } finally {
      setSending(false)
    }
  }

  function chooseAttachment(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setAttachmentError("Only image or video files can be attached.")
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setAttachmentError("Attachments must be 25MB or smaller.")
      return
    }
    setAttachment(file)
    setAttachmentError(null)
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white",
        showHistory && "min-h-[300px]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-900">
            <MessageCircleIcon className="size-4 shrink-0 text-[#ff6a1a]" strokeWidth={2.25} />
            {title}
          </p>
          <p className="mt-0.5 text-[12px] font-medium text-neutral-500">
            {subtitle}
          </p>
        </div>
        {loading ? <Loader2Icon className="size-4 animate-spin text-neutral-400" /> : null}
      </div>

      {showHistory ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.length === 0 && !loading ? (
          loadError ? (
            <div className="py-8 text-center">
              <p className="text-[13px] leading-5 text-red-600">{loadError}</p>
              <button type="button" onClick={() => void load()} className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Try again</button>
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
                    "rounded-2xl px-3 py-2 text-[13px] leading-5 shadow-sm",
                    mine
                      ? "rounded-br-md bg-[#ff6a1a] text-white"
                      : "rounded-bl-md border border-neutral-100 bg-[#f4f6fb] text-[#1a2340]",
                  )}
                >
                  {msg.body ? <p>{msg.body}</p> : null}
                  {msg.attachment ? (
                    <div className={cn(msg.body && "mt-2", "space-y-2")}>
                      {msg.attachment.kind === "image" ? (
                        <AuthenticatedMediaImage src={msg.attachment.raw_url} alt={msg.attachment.original_filename} className="max-h-48 w-full rounded-xl object-cover" />
                      ) : (
                        <button type="button" onClick={() => void openAuthenticatedMedia(msg.attachment!.raw_url, msg.attachment!.original_filename)} className="flex w-full items-center gap-2 rounded-xl border border-current/20 px-3 py-3 text-left text-xs font-bold hover:bg-white/10">
                          <VideoIcon className="size-5 shrink-0" /> Open video attachment
                        </button>
                      )}
                      <p className="flex items-center gap-1 text-[11px] font-semibold opacity-80">
                        {msg.attachment.kind === "image" ? <FileImageIcon className="size-3.5" /> : <VideoIcon className="size-3.5" />}
                        {msg.attachment.authenticity_status === "clear" ? "No obvious edit detected" : msg.attachment.authenticity_status === "flagged" ? "Potentially edited media · review manually" : "Authenticity review required"}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div> : null}

      {!disabled ? (
        <div className="border-t border-neutral-100 p-2.5 sm:p-3">
          {attachment ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#cbd8ee] bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#07145f]">
              <span className="flex min-w-0 items-center gap-2 truncate"><PaperclipIcon className="size-4 shrink-0" />{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} className="rounded-full p-1 hover:bg-white" aria-label="Remove attachment"><XIcon className="size-4" /></button>
            </div>
          ) : null}
          {attachmentError ? <p className="mb-2 text-xs font-semibold text-red-600">{attachmentError}</p> : null}
          <div className="flex items-end gap-2">
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-neutral-200 text-neutral-500 hover:bg-neutral-50" aria-label="Attach image or video">
            <PaperclipIcon className="size-4" />
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(event) => { chooseAttachment(event.target.files?.[0]); event.currentTarget.value = "" }} />
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-neutral-200 bg-[#f8fafc] px-3 py-2.5 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[#ff6a1a]"
          />
          <button
            type="button"
            disabled={sending || (!draft.trim() && !attachment)}
            onClick={() => void handleSend()}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17] disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" strokeWidth={2.25} />
            )}
          </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-neutral-100 px-3 py-2.5 text-center text-[12px] text-neutral-400">
          Chat is closed for this report.
        </p>
      )}
    </div>
  )
}
