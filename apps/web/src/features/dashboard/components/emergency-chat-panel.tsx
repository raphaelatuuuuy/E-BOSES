import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, PaperclipIcon, SendIcon, UsersIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { useAuthSession } from "@/features/auth/auth-session"
import type { PublicUser } from "@/features/dashboard/api"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"
import {
  listEmergencyChat,
  sendEmergencyChat,
  type EmergencyChatMessage,
} from "@/features/dashboard/emergency-api"

function formatChatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
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

export function EmergencyChatPanel({
  alertId,
  open,
  disabled,
  incomingMessage,
  participantHint,
  realtime = true,
  theme = "dark",
  className,
}: {
  alertId: number
  open: boolean
  /** When true, hide input (e.g. cancelled) */
  disabled?: boolean
  /** Real-time message from websocket parent */
  incomingMessage?: EmergencyChatMessage | null
  /** e.g. "2 responders in this room" */
  participantHint?: string
  /** Disable when a parent tracking socket already supplies incomingMessage. */
  realtime?: boolean
  /** dark = resident SOS dock; light = responder/official ops */
  theme?: "dark" | "light"
  className?: string
}) {
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<EmergencyChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "polling">("connecting")
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isDark = theme === "dark"
  const userId = user?.id

  const isMine = useCallback(
    (msg: EmergencyChatMessage) => {
      if (userId != null && msg.sender?.id != null) {
        return msg.sender.id === userId
      }
      return Boolean(msg.is_mine)
    },
    [userId],
  )

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
  }, [])

  const load = useCallback(async () => {
    if (!open || !alertId) return
    setLoading(true)
    setLoadError("")
    try {
      const next = await listEmergencyChat(alertId)
      setMessages(next)
      scrollToBottom()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load chat."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [alertId, open, scrollToBottom])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!open || !alertId || !realtime) return
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false
    let attempts = 0

    async function connect() {
      setConnectionState("connecting")
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        setConnectionState("polling")
        attempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
        return
      }
      socket.onopen = () => {
        attempts = 0
        setConnectionState("live")
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: EmergencyChatMessage }
          if (message.type !== "emergency.chat" || !message.payload || message.payload.alert !== alertId) return
          setMessages((current) => current.some((item) => item.id === message.payload!.id)
            ? current
            : [...current, message.payload!])
        } catch {
          // The REST poll remains the fallback for malformed frames.
        }
      }
      socket.onclose = () => {
        if (closed) return
        setConnectionState("polling")
        attempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [alertId, open, realtime])

  useEffect(() => {
    if (!open || !alertId) return
    const id = window.setInterval(() => {
      void listEmergencyChat(alertId)
        .then((next) => {
          setMessages((prev) => {
            if (next.length === prev.length && next.at(-1)?.id === prev.at(-1)?.id) return prev
            return next
          })
        })
        .catch(() => {
          /* ignore poll errors */
        })
    }, 8000)
    return () => window.clearInterval(id)
  }, [open, alertId])

  useEffect(() => {
    if (!incomingMessage || incomingMessage.alert !== alertId) return
    const timer = window.setTimeout(() => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === incomingMessage.id)) return prev
        return [...prev, { ...incomingMessage }]
      })
      scrollToBottom()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [incomingMessage, alertId, scrollToBottom])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  async function handleSend() {
    const body = draft.trim()
    if ((!body && !attachment) || sending || disabled) return
    setSending(true)
    try {
      const created = await sendEmergencyChat(alertId, body, attachment)
      setDraft("")
      setAttachment(null)
      setLoadError("")
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev
        return [...prev, created]
      })
      scrollToBottom()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send message.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col rounded-xl border",
        isDark ? "border-white/10 bg-white/10" : "border-slate-200 bg-white",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-3 py-2.5",
          isDark ? "border-white/10" : "border-slate-100",
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
            <UsersIcon className="size-3 shrink-0" />
            <span className="truncate">
              {participantHint || "Group room · resident + assigned responders"}
            </span>
            <span aria-hidden="true"> · </span>
            <span>{!realtime ? "Live tracking" : connectionState === "live" ? "Live" : connectionState === "connecting" ? "Connecting" : "Polling"}</span>
          </p>
        </div>
        {loading ? (
          <Loader2Icon
            className={cn("size-4 animate-spin", isDark ? "text-white/50" : "text-slate-400")}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {loadError && messages.length === 0 && !loading ? (
          <div className="py-6 text-center">
            <p className={cn("text-[12px]", isDark ? "text-red-200" : "text-red-600")}>{loadError}</p>
            <button type="button" onClick={() => void load()} className={cn("mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold", isDark ? "border-white/20 text-white" : "border-slate-200 text-[#07145f]")}>Try again</button>
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
                    "rounded-2xl px-3 py-2 text-[13px] leading-5 shadow-sm",
                    mine
                      ? "rounded-br-md bg-[#ff6a1a] text-white"
                      : isDark
                        ? "rounded-bl-md bg-white text-neutral-900"
                        : "rounded-bl-md border border-slate-100 bg-[#f4f6fb] text-[#1a2340]",
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
                      <p className="text-[10px] opacity-70">Media review: {msg.attachment.authenticity}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!disabled ? (
        <div
          className={cn(
            "relative flex items-end gap-2 border-t p-2.5",
            isDark ? "border-white/10" : "border-slate-100",
          )}
        >
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
            placeholder="Message the group…"
            className={cn(
              "max-h-24 min-h-10 flex-1 resize-none rounded-xl border px-3 py-2.5 text-[13px] outline-none focus:border-[#ff6a1a]",
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
              if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
                toast.error("Attach an image or video only.")
                event.currentTarget.value = ""
                return
              }
              if (file.size > 25 * 1024 * 1024) {
                toast.error("Media must be 25 MB or smaller.")
                event.currentTarget.value = ""
                return
              }
              setAttachment(file)
            }}
          />
          <label
            htmlFor={`emergency-chat-media-${alertId}`}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Attach image or video"
          >
            <PaperclipIcon className="size-4" />
          </label>
          {attachment ? (
            <button
              type="button"
              className="absolute bottom-14 left-3 flex max-w-[70%] items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
              onClick={() => setAttachment(null)}
              aria-label="Remove attachment"
            >
              <span className="truncate">{attachment.name}</span><XIcon className="size-3 shrink-0" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={sending || (!draft.trim() && !attachment)}
            onClick={() => void handleSend()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17] disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
          </button>
        </div>
      ) : (
        <p
          className={cn(
            "border-t px-3 py-2 text-center text-[11px]",
            isDark ? "border-white/10 text-white/40" : "border-slate-100 text-slate-400",
          )}
        >
          Chat is closed for this alert.
        </p>
      )}
    </div>
  )
}
