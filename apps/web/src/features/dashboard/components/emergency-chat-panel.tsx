import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowUpIcon,
  ChevronUpIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  PlayIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { initialsFor, roleLabel } from "@/features/dashboard/lib/people"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { useAuthSession } from "@/features/auth/auth-session"
import { checkConcernMedia } from "@/features/dashboard/api"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import { type MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { VoiceNoteBubble } from "@/features/dashboard/components/voice-note-bubble"
import { useVoiceRecorder, formatVoiceTime } from "@/features/dashboard/lib/use-voice-recorder"
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

const HISTORY_PAGE_SIZE = 30

export function EmergencyChatPanel({
   alertId,
   open,
   disabled,
   incomingMessage,
   realtime = true,
   theme = "dark",
   scrollable = true,
   bare = false,
   variant = "classic",
   className,
 }: {
   alertId: number
   open: boolean
   /** When true, hide input (e.g. cancelled) */
   disabled?: boolean
   /** Real-time message from websocket parent */
   incomingMessage?: EmergencyChatMessage | null
   /** Disable when a parent tracking socket already supplies incomingMessage. */
   realtime?: boolean
   /** dark = resident SOS dock; light = responder/official ops */
   theme?: "dark" | "light"
   /** When false, cap the thread at a fixed 340px with its own scrollbar. */
  scrollable?: boolean
  /** Bare = host surface already supplies the chrome; drop the card wrapper. */
  bare?: boolean
  /** modern = report-details styling: pill input, thumb preview, waveform pill. */
  variant?: "classic" | "modern"
  className?: string
}) {
  const modern = variant === "modern"
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<EmergencyChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem | null>(null)
  const [socketLive, setSocketLive] = useState(false)
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
      const next = await listEmergencyChat(alertId, { limit: HISTORY_PAGE_SIZE })
      setMessages(next)
      setHasOlder(next.length === HISTORY_PAGE_SIZE)
      scrollToBottom()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load chat."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [alertId, open, scrollToBottom])

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await listEmergencyChat(alertId, { beforeId: messages[0].id, limit: HISTORY_PAGE_SIZE })
      setMessages((prev) => [...older, ...prev])
      setHasOlder(older.length === HISTORY_PAGE_SIZE)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load earlier messages.")
    } finally {
      setLoadingOlder(false)
    }
  }, [alertId, loadingOlder, messages])

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
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        attempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
        return
      }
      socket.onopen = () => {
        attempts = 0
        setSocketLive(true)
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
        setSocketLive(false)
        if (closed) return
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
            const knownIds = new Set(prev.map((message) => message.id))
            return [...prev, ...next.filter((message) => !knownIds.has(message.id))]
          })
        })
        .catch(() => {
          /* ignore poll errors */
        })
    }, realtime ? (socketLive ? 30000 : 8000) : 30000)
    return () => window.clearInterval(id)
  }, [open, alertId, socketLive, realtime])

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

  async function sendMessage(bodyText: string, file: File | null): Promise<boolean> {
    if ((!bodyText.trim() && !file) || sending || disabled) return false
    setSending(true)
    try {
      const created = await sendEmergencyChat(alertId, bodyText, file)
      setDraft("")
      setAttachment(null)
      setAttachmentError(null)
      setLoadError("")
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev
        return [...prev, created]
      })
      scrollToBottom()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send message.")
      return false
    } finally {
      setSending(false)
    }
  }

  async function handleSend() {
    await sendMessage(draft, attachment)
  }

  const {
    recording,
    recordSeconds,
    levels,
    readyFile,
    durationSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    discardRecording,
  } = useVoiceRecorder()

  async function sendReadyVoiceNote() {
    if (!readyFile) return
    if (await sendMessage("", readyFile)) discardRecording()
  }

  async function chooseAttachment(file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      const message = "Only image or video files can be attached."
      setAttachmentError(message)
      toast.error(message)
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      const message = "Attachments must be 25MB or smaller."
      setAttachmentError(message)
      toast.error(message)
      return
    }
    try {
      const checkData = new FormData()
      checkData.append("media", file)
      await checkConcernMedia(checkData)
      setAttachment(file)
      setAttachmentError(null)
    } catch (error) {
      setAttachment(null)
      const message = error instanceof Error ? error.message : "This media failed authenticity checks and cannot be sent."
      setAttachmentError(message)
      toast.error(message)
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        modern ? "h-full" : "overflow-hidden rounded-xl border",
        !modern && !bare && (isDark ? "border-white/10 bg-white/10" : "border-slate-200 bg-white"),
        className,
      )}
    >
      <div
        className={cn(
          "scrollbar-hide min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3",
          modern && "px-1 py-2",
          !modern && !scrollable && "max-h-[340px]",
        )}
      >
        {hasOlder ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60",
                isDark
                  ? "border-white/15 text-white/75 hover:border-white/35 hover:text-white"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900",
              )}
            >
              {loadingOlder ? <Loader2Icon className="size-3.5 animate-spin" /> : <ChevronUpIcon className="size-3.5" />}
              {loadingOlder ? "Loading..." : "Load previous messages"}
            </button>
          </div>
        ) : null}
        {loadError && messages.length === 0 && !loading ? (
          <div className="py-6 text-center">
            <p className={cn("text-[12px]", "text-sos")}>{loadError}</p>
            <button type="button" onClick={() => void load()} className={cn("mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold", isDark ? "border-white/20 text-white" : "border-slate-200 text-brand-navy")}>Try again</button>
          </div>
        ) : messages.length === 0 && !loading ? (
          <p
            className={cn(
              "py-6 text-center text-[12px] leading-5",
              modern ? "text-neutral-400" : isDark ? "text-white/45" : "text-subtle-foreground",
            )}
          >
            {modern
              ? "Chat with your responder here. Status updates land in this thread as they happen."
              : "Group chat is open. Status updates (en route, nearby, arrived) appear here automatically. Everyone assigned to this alert can read and reply."}
          </p>
        ) : null}

        {messages.map((msg) => {
          const mine = isMine(msg)
          const name = msg.sender?.full_name || "User"
          const role = roleLabel(msg.sender)
          const footer = [mine ? "You" : name, !mine && role ? role : "", formatChatTime(msg.created_at)].filter(Boolean).join(" · ")
          if (!msg.body && msg.attachment && msg.attachment.media_type !== "audio" && msg.attachment.authenticity !== "clear") return null
          const attachment = msg.attachment
          const attachmentVisible = Boolean(
            attachment && (attachment.authenticity === "clear" || attachment.media_type === "audio"),
          )
          const mediaBlock = attachmentVisible ? (
            <div className={cn(msg.body ? "mt-2" : undefined, "space-y-1")}>
              {attachment!.media_type === "image" ? (
                <button
                  type="button"
                  onClick={() =>
                    setPreviewMedia({
                      src: attachment!.preview_url || attachment!.raw_url,
                      filename: attachment!.original_filename,
                      kind: "image",
                    })
                  }
                  className="block overflow-hidden rounded-lg text-left"
                >
                  <AuthenticatedMediaImage
                    src={attachment!.preview_url || attachment!.raw_url}
                    alt="Message attachment"
                    className="max-h-40 max-w-full object-cover"
                  />
                </button>
              ) : attachment!.media_type === "video" ? (
                <button
                  type="button"
                  onClick={() =>
                    setPreviewMedia({
                      src: attachment!.raw_url,
                      filename: attachment!.original_filename,
                      kind: "video",
                    })
                  }
                  className="text-current underline-offset-2 hover:underline"
                >
                  <PlayIcon className="size-3.5" />
                  Preview video
                </button>
              ) : (
                <VoiceNoteBubble
                  url={attachment!.raw_url}
                  filename={attachment!.original_filename}
                  mine={mine}
                  isDark={isDark}
                  flat
                />
              )}
              {attachment!.media_type !== "audio" ? (
                <p className="text-[10px] opacity-70">
                  Media review: {attachment!.authenticity}
                </p>
              ) : null}
            </div>
          ) : null

          let content: ReactNode
          if (!msg.body && attachment?.media_type === "audio") {
            content = (
              <VoiceNoteBubble
                url={attachment.raw_url}
                filename={attachment.original_filename}
                mine={mine}
                isDark={isDark}
              />
            )
          } else {
            content = (
              <Bubble
                variant={mine ? "default" : "muted"}
                className={cn(
                  !mine && isDark && "border-white/10 bg-white text-neutral-900",
                  modern && "border border-neutral-200 bg-white text-neutral-900 shadow-none",
                )}
              >
                <BubbleContent>
                  {msg.body ? <p>{msg.body}</p> : null}
                  {mediaBlock}
                </BubbleContent>
              </Bubble>
            )
          }

          return (
            <Message key={msg.id} align={mine ? "end" : "start"}>
              <MessageAvatar>
                <Avatar className={isDark ? "bg-white/15" : undefined}>
                  <AvatarFallback className={isDark ? "bg-white/20 text-white" : undefined}>{initialsFor(msg.sender).charAt(0)}</AvatarFallback>
                </Avatar>
              </MessageAvatar>
              <MessageContent className={mine ? "items-end" : "items-start"}>
                {content}
                <MessageFooter className={cn(mine ? "text-right" : "text-left", "font-normal", isDark && "text-white/40")}>{footer}</MessageFooter>
              </MessageContent>
            </Message>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {previewMedia ? (
        <MediaLightbox items={[previewMedia]} index={0} onClose={() => setPreviewMedia(null)} />
      ) : null}

      {!disabled ? (
        modern ? (
          <div className="px-1 pb-1 pt-1">
            {attachment && !recording && !readyFile ? (
              <div className="mb-2 flex items-center gap-2">
                {attachment.type.startsWith("image/") ? (
                  <div className="relative shrink-0">
                    <img
                      src={URL.createObjectURL(attachment)}
                      alt={attachment.name}
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                      aria-label="Remove attachment"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-600">
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <PaperclipIcon className="size-3.5 shrink-0" />
                      {attachment.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="rounded-full p-0.5 hover:bg-neutral-200"
                      aria-label="Remove attachment"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {attachmentError ? (
              <p className="mb-2 text-[11px] font-medium text-red-500">{attachmentError}</p>
            ) : null}
            {recording || readyFile ? (
              <div className="mx-auto flex w-fit items-center gap-2.5 rounded-full border border-neutral-200 bg-white py-2 pl-4 pr-2">
                {recording ? (
                  <span className="size-2 shrink-0 rounded-full animate-pulse bg-red-500" aria-hidden />
                ) : null}
                <div className="flex items-center gap-[2px]">
                  {Array.from({ length: 30 }, (_, i) => {
                    const level = levels[i] ?? 0.08
                    return (
                      <span
                        key={i}
                        className="w-[2.5px] shrink-0 rounded-full bg-neutral-900"
                        style={{ height: `${4 + level * 14}px` }}
                      />
                    )
                  })}
                </div>
                <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-neutral-900">
                  {formatVoiceTime(recording ? recordSeconds : durationSeconds)}
                </span>
                <div className="flex items-center gap-1">
                  {recording ? (
                    <button
                      type="button"
                      onClick={() => void stopRecording()}
                      aria-label="Stop recording"
                      className="flex size-8 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
                    >
                      <SquareIcon className="size-3" fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void sendReadyVoiceNote()}
                      aria-label="Send voice note"
                      className="flex size-8 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {sending ? <Loader2Icon className="size-3 animate-spin" /> : <ArrowUpIcon className="size-3" strokeWidth={2.4} />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (recording ? cancelRecording() : discardRecording())}
                    aria-label="Cancel voice note"
                    className="flex size-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-neutral-300">
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={sending}
                  aria-label="Record a voice note"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50"
                >
                  <MicIcon className="size-4" />
                </button>
                <label
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  aria-label="Attach image or video"
                >
                  <PaperclipIcon className="size-4" />
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/webm,video/quicktime"
                    className="sr-only"
                    onChange={(event) => {
                      void chooseAttachment(event.target.files?.[0] ?? null)
                      event.currentTarget.value = ""
                    }}
                  />
                </label>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder="Message your responder..."
                  className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <button
                  type="button"
                  disabled={sending || recording || (!draft.trim() && !attachment)}
                  onClick={() => void handleSend()}
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-150",
                    (draft.trim() || attachment)
                      ? "bg-neutral-900 text-white hover:bg-neutral-800"
                      : "bg-neutral-100 text-neutral-300",
                  )}
                  aria-label="Send message"
                >
                  {sending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <ArrowUpIcon className="size-4" strokeWidth={2.4} />
                  )}
                </button>
              </div>
            )}
            {!modern ? (
              <p className="mt-2.5 text-center text-[11px] leading-normal text-neutral-400">
                Please be kind and respectful to your neighbours.
              </p>
            ) : null}
          </div>
        ) : (
        <div
          className={cn(
            "relative flex items-end gap-2 border-t p-2.5",
            isDark ? "border-white/10" : "border-slate-100",
          )}
        >
          {recording || readyFile ? (
            <>
              <div
                className={cn(
                  "flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border px-4",
                  recording
                    ? isDark ? "border-sos/40 bg-sos/10 text-sos" : "border-sos/30 bg-sos/10 text-sos"
                    : isDark ? "border-brand-orange/40 bg-brand-orange/10 text-brand-orange" : "border-brand-orange/30 bg-brand-orange/5 text-brand-orange",
                )}
                aria-label={recording ? `Recording ${formatVoiceTime(recordSeconds)}` : `Voice note ready, ${formatVoiceTime(durationSeconds)}`}
              >
                <span className={cn("size-2 shrink-0 rounded-full", recording ? (isDark ? "animate-pulse bg-sos" : "animate-pulse bg-sos") : "bg-brand-orange")} aria-hidden />
                <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
                  {(levels.length ? levels : [0.2, 0.2, 0.2, 0.2]).map((level, index) => (
                    <span key={index} className="w-[3px] shrink-0 rounded-full bg-current transition-[height] duration-100 ease-out" style={{ height: `${3 + level * 22}px` }} />
                  ))}
                </span>
                <span className={cn("shrink-0 font-mono text-[13px] font-semibold tabular-nums", recording ? (isDark ? "text-sos" : "text-sos") : isDark ? "text-white" : "text-brand-navy")}>
                  {formatVoiceTime(recording ? recordSeconds : durationSeconds)}
                </span>
              </div>
              {recording ? (
                <button
                  type="button"
                  onClick={() => void stopRecording()}
                  aria-label="Stop recording"
                  title="Stop recording"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sos text-white hover:bg-sos-bright"
                >
                  <SquareIcon className="size-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendReadyVoiceNote()}
                  aria-label="Send voice note"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong disabled:opacity-50"
                >
                  {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => (recording ? cancelRecording() : discardRecording())}
                aria-label="Cancel voice note"
                title="Cancel voice note"
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  isDark ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700",
                )}
              >
                <XIcon className="size-5" />
              </button>
            </>
          ) : (
            <>
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
            placeholder="Enter a message"
            className={cn(
              "max-h-24 min-h-10 flex-1 resize-none rounded-xl border px-3 py-2.5 text-[13px] outline-none transition-all focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/25",
              isDark
                ? "border-white/15 bg-black/25 text-white placeholder:text-white/40"
                : "border-slate-200 bg-canvas text-brand-navy placeholder:text-slate-400",
            )}
          />
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={sending}
            aria-label="Record a voice note"
            title="Record a voice note"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
              isDark ? "text-white/70 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100",
            )}
          >
            <MicIcon className="size-4" />
          </button>
          <input
            id={`emergency-chat-media-${alertId}`}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="sr-only"
            onChange={(event) => {
              void chooseAttachment(event.target.files?.[0] ?? null)
              event.currentTarget.value = ""
            }}
          />
          <label
            htmlFor={`emergency-chat-media-${alertId}`}
            className={cn(
              "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full",
              isDark ? "text-white/70 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100",
            )}
            aria-label="Attach image or video"
          >
            <PaperclipIcon className="size-4" />
          </label>
          {attachment ? (
            <button
              type="button"
              className={cn(
                "absolute bottom-14 left-3 flex max-w-[70%] items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                isDark
                  ? "border border-white/15 bg-white/10 text-white"
                  : "border border-slate-200 bg-slate-100 text-slate-700",
              )}
              onClick={() => setAttachment(null)}
              aria-label="Remove attachment"
            >
              <span className="truncate">{attachment.name}</span> <XIcon className="size-3 shrink-0" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={sending || recording || (!draft.trim() && !attachment)}
            onClick={() => void handleSend()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
          </button>
            </>
          )}
        </div>
        )
      ) : (
        <p
          className={cn(
            "px-3 py-2 text-center text-[12px]",
            modern
              ? "text-neutral-400"
              : cn("border-t", isDark ? "border-white/10 text-white/40" : "border-slate-100 text-slate-400"),
          )}
        >
          Chat is closed for this alert.
        </p>
      )}
    </div>
  )
}
