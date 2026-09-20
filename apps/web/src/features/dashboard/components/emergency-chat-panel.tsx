import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowUpIcon,
  ChevronUpIcon,
  Loader2Icon,
  MessageCircleIcon,
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
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { useApiReachability } from "@/lib/api-reachability"
import {
  canSendSms,
  openSmsApp,
  sendSmsText,
} from "@/lib/native-sms-inbox"
import {
  normalizeSmsRecipient,
  smsBodyTooLong,
} from "@/lib/sms-recipient"
import { useAuthSession } from "@/features/auth/auth-session"
import { checkConcernMedia } from "@/features/dashboard/api"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import { type MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { VoiceNoteBubble } from "@/features/dashboard/components/voice-note-bubble"
import {
  useVoiceRecorder,
  formatVoiceTime,
} from "@/features/dashboard/lib/use-voice-recorder"
import { LocalAttachmentPreview } from "@/features/dashboard/components/comments"
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
  theme = "light",
  scrollable = true,
  bare = false,
  variant = "classic",
  className,
  smsTo,
}: {
  alertId: number
  open: boolean
  /** When true, hide input (e.g. cancelled) */
  disabled?: boolean
  /** Real-time message from websocket parent */
  incomingMessage?: EmergencyChatMessage | null
  /** Disable when a parent tracking socket already supplies incomingMessage. */
  realtime?: boolean
  /** Light is the shared official/responder workspace; dark remains opt-in for the resident SOS dock. */
  theme?: "dark" | "light"
  /** When false, cap the thread at a fixed 340px with its own scrollbar. */
  scrollable?: boolean
  /** Bare = host surface already supplies the chrome; drop the card wrapper. */
  bare?: boolean
  /** modern = report-details styling: pill input, thumb preview, waveform pill. */
  variant?: "classic" | "modern"
  className?: string
  /** Direct number for offline SMS fallback. Absent = no offline sending. */
  smsTo?: string | null
}) {
  const modern = variant === "modern"
  const { user } = useAuthSession()
  const apiOnline = useApiReachability()
  const smsOffline = !apiOnline
  // "Message your responder…" speaks to the resident who raised the alert;
  // officials and responders answer, so they get the neutral follow-up prompt.
  const placeholder = smsOffline
    ? "Send message"
    : user?.role === "resident"
      ? "Message your responder…"
      : "Ask a follow-up…"
  const [messages, setMessages] = useState<EmergencyChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [checkingAttachment, setCheckingAttachment] = useState(false)
  const [sendFeedback, setSendFeedback] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem | null>(
    null
  )
  const [socketLive, setSocketLive] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null
  )
  const isDark = theme === "dark"
  const userId = user?.id
  const isMine = useCallback(
    (msg: EmergencyChatMessage) => {
      if (userId != null && msg.sender?.id != null) {
        return msg.sender.id === userId
      }
      return Boolean(msg.is_mine)
    },
    [userId]
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
      const next = await listEmergencyChat(alertId, {
        limit: HISTORY_PAGE_SIZE,
      })
      setMessages(next)
      setHasOlder(next.length === HISTORY_PAGE_SIZE)
      scrollToBottom()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load chat."
      setLoadError(message)
      if (!smsOffline) toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [alertId, open, scrollToBottom, smsOffline])

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await listEmergencyChat(alertId, {
        beforeId: messages[0].id,
        limit: HISTORY_PAGE_SIZE,
      })
      setMessages((prev) => [...older, ...prev])
      setHasOlder(older.length === HISTORY_PAGE_SIZE)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not load earlier messages."
      )
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
          websocketUrl(
            `/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`
          )
        )
      } catch {
        attempts += 1
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(30_000, 1500 * 2 ** attempts)
        )
        return
      }
      socket.onopen = () => {
        attempts = 0
        setSocketLive(true)
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string
            payload?: EmergencyChatMessage
          }
          if (
            message.type !== "emergency.chat" ||
            !message.payload ||
            message.payload.alert !== alertId
          )
            return
          setMessages((current) =>
            current.some((item) => item.id === message.payload!.id)
              ? current
              : [...current, message.payload!]
          )
        } catch {
          // The REST poll remains the fallback for malformed frames.
        }
      }
      socket.onclose = () => {
        setSocketLive(false)
        if (closed) return
        attempts += 1
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(30_000, 1500 * 2 ** attempts)
        )
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
    const id = window.setInterval(
      () => {
        void listEmergencyChat(alertId)
          .then((next) => {
            setMessages((prev) => {
              if (
                next.length === prev.length &&
                next.at(-1)?.id === prev.at(-1)?.id
              )
                return prev
              const knownIds = new Set(prev.map((message) => message.id))
              return [
                ...prev,
                ...next.filter((message) => !knownIds.has(message.id)),
              ]
            })
          })
          .catch(() => {
            /* ignore poll errors */
          })
      },
      realtime ? (socketLive ? 30000 : 8000) : 30000
    )
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

  async function sendMessage(
    bodyText: string,
    file: File | null
  ): Promise<boolean> {
    if (
      (!bodyText.trim() && !file) ||
      sending ||
      checkingAttachment ||
      disabled
    )
      return false
    if (smsOffline) return sendSmsFallback(bodyText, file)
    setSending(true)
    setSendFeedback(null)
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
      if (file) {
        setSendFeedback("Attachment sent")
        window.setTimeout(() => setSendFeedback(null), 2200)
      }
      scrollToBottom()
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not send message."
      setSendFeedback("Message not sent. Your attachment is still here.")
      toast.error(message)
      return false
    } finally {
      setSending(false)
    }
  }

  async function handleSend() {
    await sendMessage(draft, attachment)
  }

  function smsEcho(body: string, failed: boolean): EmergencyChatMessage {
    return {
      id: -Date.now(),
      alert: alertId,
      sender: {
        id: user?.id ?? 0,
        full_name: user?.full_name?.trim() || "You",
        initials: "",
        role: user?.role ?? "resident",
        last_seen_at: null,
      },
      body,
      attachment: null,
      created_at: new Date().toISOString(),
      is_mine: true,
      sender_online: false,
      viaSms: true,
      sendFailed: failed,
    }
  }

  async function sendSmsFallback(
    bodyText: string,
    file: File | null
  ): Promise<boolean> {
    if (file) {
      toast.error("Attachments need a connection.")
      return false
    }
    if (!bodyText.trim()) return false
    const to = normalizeSmsRecipient(smsTo ?? "")
    if (!to) {
      setSendFeedback("Recipient number unavailable while offline.")
      toast.error("Recipient number unavailable while offline.")
      return false
    }
    if (smsBodyTooLong(bodyText)) {
      toast.error("Message too long for SMS.")
      return false
    }
    setSending(true)
    setSendFeedback(null)
    const text = bodyText.trim()
    try {
      if (canSendSms()) {
        await sendSmsText(to, text)
      } else {
        openSmsApp(to, text)
      }
      setDraft("")
      setLoadError("")
      setMessages((prev) => [...prev, smsEcho(text, false)])
      scrollToBottom()
      return true
    } catch (error) {
      setDraft("")
      setMessages((prev) => [...prev, smsEcho(text, true)])
      scrollToBottom()
      setSendFeedback("Message not sent. Retry when ready.")
      toast.error(
        error instanceof Error ? error.message : "Could not send SMS."
      )
      return false
    } finally {
      setSending(false)
    }
  }

  async function retrySms(id: number) {
    const target = messages.find((item) => item.id === id)
    if (!target || !target.sendFailed || sending) return
    const to = normalizeSmsRecipient(smsTo ?? "")
    if (!to || !canSendSms()) {
      toast.error("Reconnect or open the SMS app to retry.")
      return
    }
    setSending(true)
    try {
      await sendSmsText(to, target.body)
      setMessages((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, sendFailed: false } : item
        )
      )
    } catch {
      toast.error("Still not sent.")
    } finally {
      setSending(false)
    }
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
    if (smsOffline) {
      toast.error("Attachments need a connection.")
      return
    }
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
    setAttachment(file)
    setAttachmentError(null)
    setCheckingAttachment(true)
    try {
      const checkData = new FormData()
      checkData.append("media", file)
      const result = await checkConcernMedia(checkData)
      const rejected = result.files.find((item) => item.status === "rejected")
      if (rejected) {
        throw new Error(
          rejected.message ||
            "This media failed authenticity checks and cannot be sent."
        )
      }
    } catch (error) {
      setAttachment(null)
      const message =
        error instanceof Error
          ? error.message
          : "This media failed authenticity checks and cannot be sent."
      setAttachmentError(message)
      toast.error(message)
    } finally {
      setCheckingAttachment(false)
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        modern ? "h-full" : "overflow-hidden rounded-xl border",
        !modern &&
          !bare &&
          (isDark
            ? "border-white/10 bg-white/10"
            : "border-slate-200 bg-white"),
        className
      )}
    >
      <div
        className={cn(
          "scrollbar-hide min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3",
          modern && "px-1 py-2",
          !modern && !scrollable && "max-h-[340px]"
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
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
              )}
            >
              {loadingOlder ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <ChevronUpIcon className="size-3.5" />
              )}
              {loadingOlder ? "Loading..." : "Load previous messages"}
            </button>
          </div>
        ) : null}
        {loadError && messages.length === 0 && !loading && !smsOffline ? (
          <div className="py-6 text-center">
            <p className={cn("text-[12px]", "text-sos")}>{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className={cn(
                "mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold",
                isDark
                  ? "border-white/20 text-white"
                  : "border-slate-200 text-brand-navy"
              )}
            >
              Try again
            </button>
          </div>
        ) : messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center px-1 py-6 text-center">
            <button
              type="button"
              onClick={() => composerRef.current?.focus()}
              aria-label="Start a conversation"
              className="text-neutral-300 transition-colors hover:text-neutral-500 focus-visible:outline-none"
            >
              <MessageCircleIcon className="size-10" aria-hidden />
            </button>
            <p
              className={cn(
                "mt-3 max-w-xs text-[12px] leading-5",
                modern
                  ? "text-neutral-400"
                  : isDark
                    ? "text-white/45"
                    : "text-subtle-foreground"
              )}
            >
              {modern
                ? smsOffline
                  ? "You are currently offline. Start a conversation — messages send via SMS."
                  : user?.role === "resident"
                    ? "Chat with your responder here. Status updates land in this thread as they happen."
                    : "No conversation yet. Messages with the resident appear here."
                : "Group chat is open. Status updates (en route, nearby, arrived) appear here automatically. Everyone assigned to this alert can read and reply."}
            </p>
          </div>
        ) : null}

        {messages.map((msg) => {
          const mine = isMine(msg)
          const name = msg.sender?.full_name || "User"
          const role = roleLabel(msg.sender)
          const footer = [
            mine ? "You" : name,
            !mine && role ? role : "",
            formatChatTime(msg.created_at),
          ]
            .filter(Boolean)
            .join(" · ")
          const attachment = msg.attachment
          // Pending authenticity analysis must not make a successfully sent
          // image disappear. The protected preview endpoint remains the source
          // of truth while the review status is shown beneath it.
          const attachmentVisible = Boolean(attachment)
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
                  !mine &&
                    isDark &&
                    "border-white/10 bg-white text-neutral-900",
                  modern &&
                    "border border-neutral-200 bg-white text-neutral-900 shadow-none"
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
                <Avatar
                  className={isDark ? "bg-white/15" : undefined}
                  online={msg.sender_online}
                >
                  <AvatarFallback
                    className={isDark ? "bg-white/20 text-white" : undefined}
                  >
                    {initialsFor(msg.sender).charAt(0)}
                  </AvatarFallback>
                </Avatar>
              </MessageAvatar>
              <MessageContent className={mine ? "items-end" : "items-start"}>
                {content}
                <MessageFooter
                  className={cn(
                    mine ? "text-right" : "text-left",
                    "font-normal",
                    isDark && "text-white/40"
                  )}
                >
                  {footer}
                  {msg.viaSms ? " · Sent via SMS" : ""}
                </MessageFooter>
                {msg.sendFailed && mine ? (
                  <button
                    type="button"
                    onClick={() => void retrySms(msg.id)}
                    className={cn(
                      "mt-1 text-[11px] font-semibold text-red-500 hover:underline",
                      mine ? "text-right" : "text-left"
                    )}
                  >
                    Unsuccessful sent. Retry.
                  </button>
                ) : null}
              </MessageContent>
            </Message>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {previewMedia ? (
        <MediaLightbox
          items={[previewMedia]}
          index={0}
          onClose={() => setPreviewMedia(null)}
        />
      ) : null}

      {!disabled ? (
        modern ? (
          <div className="px-1 pt-1 pb-1">
            {attachmentError ? (
              <p className="mb-2 text-[11px] font-medium text-red-500">
                {attachmentError}
              </p>
            ) : null}
            {checkingAttachment ? (
              <p
                role="status"
                className="mb-2 text-[11px] font-medium text-neutral-500"
              >
                Checking attachment…
              </p>
            ) : null}
            {sendFeedback ? (
              <p
                role="status"
                className={cn(
                  "mb-2 text-[11px] font-medium",
                  sendFeedback.startsWith("Message")
                    ? "text-red-500"
                    : "text-neutral-500"
                )}
              >
                {sendFeedback}
              </p>
            ) : null}
            {!smsOffline && (recording || readyFile) ? (
              <div className="mx-auto flex w-fit items-center gap-2.5 rounded-full border border-neutral-200 bg-white py-2 pr-2 pl-4">
                {recording ? (
                  <span
                    className="size-2 shrink-0 animate-pulse rounded-full bg-red-500"
                    aria-hidden
                  />
                ) : null}
                <div className="flex items-center gap-[2px]">
                  {Array.from({ length: 30 }, (_, i) => {
                    const level = levels[i] ?? 0.08
                    return (
                      <span
                        key={i}
                        className="w-[2.5px] shrink-0 rounded-full bg-brand-orange"
                        style={{ height: `${4 + level * 14}px` }}
                      />
                    )
                  })}
                </div>
                <span className="shrink-0 font-mono text-[11px] font-semibold text-neutral-900 tabular-nums">
                  {formatVoiceTime(recording ? recordSeconds : durationSeconds)}
                </span>
                <div className="flex items-center gap-1">
                  {recording ? (
                    <button
                      type="button"
                      onClick={() => void stopRecording()}
                      aria-label="Stop recording"
                      className="flex size-8 items-center justify-center rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong"
                    >
                      <SquareIcon className="size-3" fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void sendReadyVoiceNote()}
                      aria-label="Send voice note"
                      className="flex size-8 items-center justify-center rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong disabled:opacity-50"
                    >
                      {sending ? (
                        <Loader2Icon className="size-3 animate-spin" />
                      ) : (
                        <ArrowUpIcon className="size-3" strokeWidth={2.4} />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      recording ? cancelRecording() : discardRecording()
                    }
                    aria-label="Cancel voice note"
                    className="flex size-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative flex items-center gap-2 rounded-full border border-transparent bg-neutral-100 py-1.5 pr-1.5 pl-4 transition-colors focus-within:border-neutral-200">
                {!smsOffline ? (
                  <>
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={sending}
                  aria-label="Record a voice note"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                >
                  <MicIcon className="size-4" />
                </button>
                <label
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
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
                  </>
                ) : null}
                {attachment ? (
                  <LocalAttachmentPreview
                    file={attachment}
                    compact
                    onRemove={() => setAttachment(null)}
                  />
                ) : null}
                <input
                  type="text"
                  value={draft}
                  ref={(el) => {
                    composerRef.current = el
                  }}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder={placeholder}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-500"
                />
                <button
                  type="button"
                  disabled={
                    sending ||
                    checkingAttachment ||
                    recording ||
                    (!draft.trim() && !attachment)
                  }
                  onClick={() => void handleSend()}
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-150",
                    draft.trim() || attachment
                      ? "bg-brand-orange text-white hover:bg-brand-orange-strong"
                      : "bg-neutral-100 text-neutral-300"
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
            <p
              className={cn(
                "mt-2.5 text-center text-[11px] leading-normal",
                modern ? "text-neutral-500" : "text-neutral-400"
              )}
            >
              {modern
                ? "Please be respectful at all times."
                : "Please be kind and respectful to your neighbours."}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "relative flex items-end gap-2 border-t p-2.5",
              isDark ? "border-white/10" : "border-slate-100"
            )}
          >
            {!smsOffline && (recording || readyFile) ? (
              <>
                <div
                  className={cn(
                    "flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border px-4",
                    recording
                      ? isDark
                        ? "border-sos/40 bg-sos/10 text-sos"
                        : "border-sos/30 bg-sos/10 text-sos"
                      : isDark
                        ? "border-brand-orange/40 bg-brand-orange/10 text-brand-orange"
                        : "border-brand-orange/30 bg-brand-orange/5 text-brand-orange"
                  )}
                  aria-label={
                    recording
                      ? `Recording ${formatVoiceTime(recordSeconds)}`
                      : `Voice note ready, ${formatVoiceTime(durationSeconds)}`
                  }
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      recording
                        ? isDark
                          ? "animate-pulse bg-sos"
                          : "animate-pulse bg-sos"
                        : "bg-brand-orange"
                    )}
                    aria-hidden
                  />
                  <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
                    {(levels.length ? levels : [0.2, 0.2, 0.2, 0.2]).map(
                      (level, index) => (
                        <span
                          key={index}
                          className="w-[3px] shrink-0 rounded-full bg-current transition-[height] duration-100 ease-out"
                          style={{ height: `${3 + level * 22}px` }}
                        />
                      )
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[13px] font-semibold tabular-nums",
                      recording
                        ? isDark
                          ? "text-sos"
                          : "text-sos"
                        : isDark
                          ? "text-white"
                          : "text-brand-navy"
                    )}
                  >
                    {formatVoiceTime(
                      recording ? recordSeconds : durationSeconds
                    )}
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
                    {sending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <SendIcon className="size-4" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    recording ? cancelRecording() : discardRecording()
                  }
                  aria-label="Cancel voice note"
                  title="Cancel voice note"
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    isDark
                      ? "text-white/60 hover:bg-white/10 hover:text-white"
                      : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  )}
                >
                  <XIcon className="size-5" />
                </button>
              </>
            ) : (
              <>
                <div className="relative min-w-0 flex-1">
                  <textarea
                    value={draft}
                    ref={(el) => {
                      composerRef.current = el
                    }}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                    rows={1}
                    placeholder={placeholder}
                    className={cn(
                      "max-h-24 min-h-10 w-full resize-none rounded-xl border px-3 py-2.5 text-[13px] transition-all outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/25",
                      attachment && "pl-12",
                      isDark
                        ? "border-white/15 bg-black/25 text-white placeholder:text-white/40"
                        : "border-slate-200 bg-canvas text-brand-navy placeholder:text-slate-400"
                    )}
                  />
                  {attachment ? (
                    <div className="absolute top-1/2 left-2 -translate-y-1/2">
                      <LocalAttachmentPreview
                        file={attachment}
                        compact
                        onRemove={() => setAttachment(null)}
                      />
                    </div>
                  ) : null}
                </div>
                {!smsOffline ? (
                  <>
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={sending}
                  aria-label="Record a voice note"
                  title="Record a voice note"
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
                    isDark
                      ? "text-white/70 hover:bg-white/10"
                      : "text-slate-500 hover:bg-slate-100"
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
                    isDark
                      ? "text-white/70 hover:bg-white/10"
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                  aria-label="Attach image or video"
                >
                  <PaperclipIcon className="size-4" />
                </label>
                  </>
                ) : null}
                {sendFeedback ? (
                  <span
                    role="status"
                    className={cn(
                      "absolute bottom-14 left-3 text-[11px] font-medium",
                      sendFeedback.startsWith("Message")
                        ? "text-red-500"
                        : isDark
                          ? "text-white/70"
                          : "text-slate-500"
                    )}
                  >
                    {sendFeedback}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={
                    sending ||
                    checkingAttachment ||
                    recording ||
                    (!draft.trim() && !attachment)
                  }
                  onClick={() => void handleSend()}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong disabled:opacity-50"
                  aria-label="Send message"
                >
                  {sending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-4" />
                  )}
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
              : cn(
                  "border-t",
                  isDark
                    ? "border-white/10 text-white/40"
                    : "border-slate-100 text-slate-400"
                )
          )}
        >
          Chat is closed for this alert.
        </p>
      )}
    </div>
  )
}
