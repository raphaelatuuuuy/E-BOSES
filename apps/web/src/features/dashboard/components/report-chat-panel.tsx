import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
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
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  listConcernChat,
  sendConcernChat,
  type ConcernChatMessage,
} from "@/features/dashboard/api"
import { checkConcernMedia } from "@/features/dashboard/api"
import { ApiError, websocketTicket, websocketUrl } from "@/lib/api"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import { type MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { VoiceNoteBubble } from "@/features/dashboard/components/voice-note-bubble"
import { useVoiceRecorder, formatVoiceTime } from "@/features/dashboard/lib/use-voice-recorder"

function formatChatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

const HISTORY_PAGE_SIZE = 30

export function ReportChatPanel({
  concernId,
  open = true,
  disabled,
  title = "Report chat",
  subtitle = "Private thread · you and barangay staff",
  emptyMessage = "Message the barangay team about this report. Updates and questions stay here.",
  showHistory = true,
  realtime = true,
  plain = false,
  onMessageSent,
  className,
}: {
  concernId: number
  open?: boolean

  disabled?: boolean
  title?: string
  subtitle?: string
  emptyMessage?: string
  showHistory?: boolean

  realtime?: boolean

  plain?: boolean
  onMessageSent?: () => void | Promise<void>
  className?: string
}) {
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<ConcernChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
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
      const next = await listConcernChat(concernId, { limit: HISTORY_PAGE_SIZE })
      setMessages(next)
      setHasOlder(next.length === HISTORY_PAGE_SIZE)
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

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await listConcernChat(concernId, { beforeId: messages[0].id, limit: HISTORY_PAGE_SIZE })
      setMessages((prev) => [...older, ...prev])
      setHasOlder(older.length === HISTORY_PAGE_SIZE)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load earlier messages.")
    } finally {
      setLoadingOlder(false)
    }
  }, [concernId, loadingOlder, messages])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!open || !concernId || !realtime) return
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false
    let attempts = 0

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/concerns/${concernId}/tracking/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        attempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** attempts))
        return
      }
      socket.onopen = () => {
        attempts = 0
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: ConcernChatMessage }
          if (message.type !== "concern.chat" || !message.payload || message.payload.concern !== concernId) return

          setMessages((current) => current.some((item) => item.id === message.payload!.id)
            ? current
            : [...current, message.payload!])
        } catch {
          void 0
        }
      }
      socket.onclose = () => {
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
  }, [concernId, open, realtime])

  useEffect(() => {
    if (!open || !concernId || !showHistory) return
    const id = window.setInterval(() => {
      void listConcernChat(concernId)
        .then((next) => {
          setMessages((prev) => {
            if (next.length === prev.length && next.at(-1)?.id === prev.at(-1)?.id) return prev
            const knownIds = new Set(prev.map((message) => message.id))
            return [...prev, ...next.filter((message) => !knownIds.has(message.id))]
          })
        })
      .catch(() => {

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

  async function sendVoiceNote(file: File): Promise<boolean> {
    if (sending || disabled) return false
    setSending(true)
    try {
      const created = await sendConcernChat(concernId, "", file)
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev
        return [...prev, created]
      })
      await onMessageSent?.()
      scrollToBottom()
      return true
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403
        ? "You do not have permission to send messages in this report."
        : error instanceof Error ? error.message : "Could not send the voice note."
      toast.error(message)
      return false
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
    if (await sendVoiceNote(readyFile)) discardRecording()
  }

  async function chooseAttachment(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setAttachmentError("Only image or video files can be attached.")
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setAttachmentError("Attachments must be 25MB or smaller.")
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
      setAttachmentError(error instanceof Error ? error.message : "This media failed authenticity checks and cannot be attached.")
      toast.error(error instanceof Error ? error.message : "This media failed authenticity checks and cannot be attached.")
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        !plain && "overflow-hidden rounded-xl border border-slate-200 bg-white",
        showHistory && !plain && "max-h-[400px]",
        className,
      )}
    >
      {!plain ? (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-900">
              <MessageCircleIcon className="size-4 shrink-0 text-brand-orange" strokeWidth={2.25} />
              {title}
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-neutral-500">
              {subtitle}
            </p>
          </div>
          {loading ? <Loader2Icon className="size-4 animate-spin text-neutral-400" /> : null}
        </div>
      ) : null}

      {showHistory ? <div className={cn("scrollbar-hide min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3", plain && "max-h-[340px]")}>
        {hasOlder ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-60"
            >
              {loadingOlder ? <Loader2Icon className="size-3.5 animate-spin" /> : <ChevronUpIcon className="size-3.5" />}
              {loadingOlder ? "Loading..." : "Load previous messages"}
            </button>
          </div>
        ) : null}
        {messages.length === 0 && !loading ? (
          loadError ? (
            <div className="py-8 text-center">
              <p className="text-[13px] leading-5 text-sos">{loadError}</p>
              <button type="button" onClick={() => void load()} className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Try again</button>
            </div>
          ) : plain ? (
            <p className="py-8 text-center text-[13px] leading-5 text-neutral-400">{emptyMessage}</p>
          ) : (
            <Marker role="status"><MarkerContent>{emptyMessage}</MarkerContent></Marker>
          )
        ) : null}

        {messages.map((msg) => {
          const mine = isMine(msg)
          const name = msg.sender?.full_name || "User"
          const role = roleLabel(msg.sender)
          const footer = [mine ? "You" : name, !mine && role ? role : "", formatChatTime(msg.created_at)].filter(Boolean).join(" · ")
          if (!msg.body && msg.attachment && msg.attachment.authenticity_status !== "clear") return null
          const attachment = msg.attachment
          const attachmentVisible = Boolean(
            attachment && (attachment.authenticity_status === "clear" || attachment.kind === "audio"),
          )
          const mediaBlock = attachmentVisible ? (
            <div className={cn(msg.body ? "mt-2" : undefined, "space-y-1")}>
              {attachment!.kind === "image" ? (
                <button type="button" onClick={() => setPreviewMedia({ src: attachment!.preview_url, filename: attachment!.original_filename, kind: "image" })} className="block overflow-hidden rounded-lg text-left"><AuthenticatedMediaImage src={attachment!.preview_url} alt={attachment!.original_filename} className="max-h-40 max-w-full object-cover" /></button>
              ) : attachment!.kind === "audio" ? (
                <VoiceNoteBubble
                  url={attachment!.raw_url}
                  filename={attachment!.original_filename}
                  mine={mine}
                  flat
                />
              ) : (
                <button type="button" onClick={() => setPreviewMedia({ src: attachment!.raw_url, filename: attachment!.original_filename, kind: "video" })} className="text-current underline-offset-2 hover:underline">
                  <PlayIcon className="size-3.5" />
                  Preview video
                </button>
              )}
              {attachment!.kind !== "audio" ? (
                <p className="text-[10px] opacity-70">
                  Media review: {attachment!.authenticity_status === "clear" ? "clear" : attachment!.authenticity_status === "flagged" ? "flagged" : "review required"}
                </p>
              ) : null}
            </div>
          ) : null

          let content: ReactNode
          if (!msg.body && msg.attachment?.kind === "audio") {
            content = (
              <VoiceNoteBubble
                url={msg.attachment.raw_url}
                filename={msg.attachment.original_filename}
                mine={mine}
              />
            )
          } else {
            content = (
              <Bubble variant={mine ? "default" : "muted"}>
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
                <Avatar>                  <AvatarFallback>{initialsFor(msg.sender)}</AvatarFallback>
                </Avatar>
              </MessageAvatar>
              <MessageContent className={mine ? "items-end" : "items-start"}>
                {content}
                <MessageFooter className={mine ? "text-right" : "text-left"}>{footer}</MessageFooter>
              </MessageContent>
            </Message>
          )
        })}
        <div ref={bottomRef} />
      </div> : null}
      {previewMedia ? (
        <MediaLightbox items={[previewMedia]} index={0} onClose={() => setPreviewMedia(null)} />
      ) : null}

      {!disabled ? (
        <div className="relative border-t border-slate-100 p-2.5">
          {attachment && !recording && !readyFile ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-line-tint bg-canvas px-3 py-2 text-xs font-semibold text-brand-navy">
              <span className="flex min-w-0 items-center gap-2 truncate"><PaperclipIcon className="size-4 shrink-0" />{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} className="rounded-full p-1 hover:bg-white" aria-label="Remove attachment"><XIcon className="size-4" /></button>
            </div>
          ) : null}
          {attachmentError ? <p className="mb-2 text-xs font-semibold text-sos">{attachmentError}</p> : null}
          <div className="flex items-end gap-2">
          {recording || readyFile ? (
            <>
              <div
                className={cn(
                  "flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border px-4",
                  recording ? "border-sos/30 bg-sos/10 text-sos" : "border-brand-orange/30 bg-brand-orange/5 text-brand-orange",
                )}
                aria-label={recording ? `Recording ${formatVoiceTime(recordSeconds)}` : `Voice note ready, ${formatVoiceTime(durationSeconds)}`}
              >
                <span className={cn("size-2 shrink-0 rounded-full", recording ? "animate-pulse bg-sos" : "bg-brand-orange")} aria-hidden />
                <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
                  {(levels.length ? levels : [0.2, 0.2, 0.2, 0.2]).map((level, index) => (
                    <span key={index} className="w-[3px] shrink-0 rounded-full bg-current transition-[height] duration-100 ease-out" style={{ height: `${3 + level * 22}px` }} />
                  ))}
                </span>
                <span className={cn("shrink-0 font-mono text-[13px] font-semibold tabular-nums", recording ? "text-sos" : "text-brand-navy")}>
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
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <XIcon className="size-5" />
              </button>
            </>
          ) : (
            <>
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={sending}
              aria-label="Record a voice note"
              title="Record a voice note"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-500 disabled:opacity-50",
                "hover:bg-neutral-100",
              )}
            >
              <MicIcon className="size-4" />
            </button>
            <label className={cn("flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100")} aria-label="Attach image or video">
              <PaperclipIcon className="size-4" />
              <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(event) => { void chooseAttachment(event.target.files?.[0]); event.currentTarget.value = "" }} />
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
              placeholder="Enter a message"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-neutral-200 bg-canvas px-3 py-2 text-[14px] text-neutral-900 outline-none transition-all placeholder:text-neutral-400 focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/25"
            />
            <button
              type="button"
              disabled={sending || recording || (!draft.trim() && !attachment)}
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
        </div>
      ) : (
        <p className="border-t border-slate-100 px-3 py-2.5 text-center text-[12px] text-neutral-400">
          Chat is closed for this report.
        </p>
      )}
    </div>
  )
}
