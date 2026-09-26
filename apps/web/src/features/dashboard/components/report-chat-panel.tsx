import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowUpIcon,
  CheckIcon,
  CheckCheckIcon,
  ChevronUpIcon,
  Loader2Icon,
  MessageCircleIcon,
  MicIcon,
  PaperclipIcon,
  PlayIcon,
  ScaleIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { initialsFor } from "@/features/dashboard/lib/people"
import { shouldSkipPoll } from "@/features/dashboard/lib/visible-poll"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  createConcernAppeal,
  listConcernChat,
  reviewConcernAppeal,
  sendConcernChat,
  sendConcernChatReceipt,
  type ConcernAppeal,
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
import {
  useVoiceRecorder,
  formatVoiceTime,
} from "@/features/dashboard/lib/use-voice-recorder"
import { LocalAttachmentPreview } from "@/features/dashboard/components/comments"

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
  emptyMessage = "Ask for updates, questions, extra photos, or access details here.",
  showHistory = true,
  realtime = true,
  plain = false,
  appeals,
  canFileAppeal = false,
  canDecideAppeals = false,
  onAppealsChanged,
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
  /** Appeal records rendered as bubbles inside the thread. */
  appeals?: ConcernAppeal[]
  /** Resident may file an appeal while the chat is closed. */
  canFileAppeal?: boolean
  /** Official may approve or deny pending appeals inline. */
  canDecideAppeals?: boolean
  /** Refreshes the parent after an appeal is filed or decided. */
  onAppealsChanged?: () => void | Promise<void>
  onMessageSent?: () => void | Promise<void>
  className?: string
}) {
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<ConcernChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [checkingAttachment, setCheckingAttachment] = useState(false)
  const [sendFeedback, setSendFeedback] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [socketLive, setSocketLive] = useState(false)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isMine = useCallback(
    (msg: ConcernChatMessage) => {
      if (user?.id != null && msg.sender?.id != null)
        return msg.sender.id === user.id
      return Boolean(msg.is_mine)
    },
    [user]
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
      const next = await listConcernChat(concernId, {
        limit: HISTORY_PAGE_SIZE,
      })
      setMessages(next)
      setHasOlder(next.length === HISTORY_PAGE_SIZE)
      scrollToBottom()
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 403
          ? "You do not have access to this report chat."
          : error instanceof Error
            ? error.message
            : "Could not load chat."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [concernId, open, scrollToBottom, showHistory])

  const sendReadReceipt = useCallback(
    async (throughId: number) => {
      try {
        void sendConcernChatReceipt(concernId, throughId)
      } catch {
        /* receipt is best-effort */
      }
    },
    [concernId],
  )

  useEffect(() => {
    if (!open || !concernId || !messages.length) return
    const latest = messages[messages.length - 1]
    void sendReadReceipt(latest.id)
  }, [open, concernId, messages, sendReadReceipt])

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await listConcernChat(concernId, {
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
          websocketUrl(
            `/ws/concerns/${concernId}/tracking/?ticket=${encodeURIComponent(ticket)}`
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
            payload?: ConcernChatMessage
          }
          if (
            message.type !== "concern.chat" ||
            !message.payload ||
            message.payload.concern !== concernId
          )
            return

          setMessages((current) => {
            const existing = current.find((item) => item.id === message.payload!.id)
            if (existing && existing.delivery_state === message.payload!.delivery_state) return current
            if (existing) {
              return current.map((item) => (item.id === message.payload!.id ? message.payload! : item))
            }
            return [...current, message.payload!]
          })
          void onMessageSent?.()
        } catch {
          void 0
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
  }, [concernId, onMessageSent, open, realtime])

  useEffect(() => {
    if (!open || !concernId || !showHistory) return
    const id = window.setInterval(
      () => {
        if (shouldSkipPoll()) return
        void listConcernChat(concernId)
          .then((next) => {
            setMessages((prev) => {
              if (
                next.length === prev.length &&
                next.at(-1)?.id === prev.at(-1)?.id &&
                next.every((m) => {
                  const prevM = prev.find((p) => p.id === m.id)
                  return prevM && prevM.delivery_state === m.delivery_state
                })
              )
                return prev
              const merged = new Map<number, ConcernChatMessage>()
              for (const message of prev) merged.set(message.id, message)
              for (const message of next) merged.set(message.id, message)
              return [...merged.values()]
            })
            void onMessageSent?.()
          })
          .catch(() => {})
      },
      socketLive ? 30000 : 6000
    )
    return () => window.clearInterval(id)
  }, [messages, open, concernId, onMessageSent, showHistory, socketLive])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  async function handleSend() {
    const body = draft.trim()
    if ((!body && !attachment) || sending || checkingAttachment || disabled)
      return
    setSending(true)
    setSendFeedback(null)
    try {
      const created = await sendConcernChat(concernId, body, attachment)
      setDraft("")
      setAttachment(null)
      setAttachmentError(null)
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev
        return [...prev, created]
      })
      if (attachment) {
        setSendFeedback("Attachment sent")
        window.setTimeout(() => setSendFeedback(null), 2200)
      }
      await onMessageSent?.()
      scrollToBottom()
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 403
          ? "You do not have permission to send messages in this report."
          : error instanceof Error
            ? error.message
            : "Could not send message."
      setSendFeedback(
        attachment
          ? "Message not sent. Your attachment is still here."
          : "Message not sent. Please try again."
      )
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
      const message =
        error instanceof ApiError && error.status === 403
          ? "You do not have permission to send messages in this report."
          : error instanceof Error
            ? error.message
            : "Could not send the voice note."
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
            "This media failed authenticity checks and cannot be attached."
        )
      }
    } catch (error) {
      setAttachment(null)
      setAttachmentError(
        error instanceof Error
          ? error.message
          : "This media failed authenticity checks and cannot be attached."
      )
      toast.error(
        error instanceof Error
          ? error.message
          : "This media failed authenticity checks and cannot be attached."
      )
    } finally {
      setCheckingAttachment(false)
    }
  }

  const appealList = appeals ?? []
  const pendingAppeal = appealList.find(
    (appeal) => appeal.status === "submitted"
  )

  const [appealComposerOpen, setAppealComposerOpen] = useState(false)
  const [appealReason, setAppealReason] = useState("")
  const [appealMedia, setAppealMedia] = useState<File | null>(null)
  const [appealMediaError, setAppealMediaError] = useState<string | null>(null)
  const [filingAppeal, setFilingAppeal] = useState(false)
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({})
  const [decidingId, setDecidingId] = useState<string | null>(null)

  async function chooseAppealMedia(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setAppealMediaError("Only image or video files can be attached.")
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setAppealMediaError("Attachments must be 25MB or smaller.")
      return
    }
    try {
      const checkData = new FormData()
      checkData.append("media", file)
      const result = await checkConcernMedia(checkData)
      const rejected = result.files.find((item) => item.status === "rejected")
      if (rejected) {
        throw new Error(
          rejected.message ||
            "This media failed authenticity checks and cannot be attached."
        )
      }
      setAppealMedia(file)
      setAppealMediaError(null)
    } catch (error) {
      setAppealMedia(null)
      setAppealMediaError(
        error instanceof Error
          ? error.message
          : "This media failed authenticity checks and cannot be attached."
      )
      toast.error(
        error instanceof Error
          ? error.message
          : "This media failed authenticity checks and cannot be attached."
      )
    }
  }

  async function submitAppeal() {
    const reason = appealReason.trim()
    if (!reason || filingAppeal) return
    setFilingAppeal(true)
    try {
      await createConcernAppeal(concernId, reason)
      if (appealMedia) {
        try {
          await sendConcernChat(concernId, "", appealMedia)
        } catch {
          toast.error(
            "The evidence photo could not be added to the chat. The appeal itself was submitted."
          )
        }
      }
      setAppealComposerOpen(false)
      setAppealReason("")
      setAppealMedia(null)
      toast.success("Appeal submitted")
      await onAppealsChanged?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit appeal."
      )
    } finally {
      setFilingAppeal(false)
    }
  }

  async function decideAppeal(
    appeal: ConcernAppeal,
    decision: "approved" | "denied"
  ) {
    if (decidingId) return
    const note =
      decisionNotes[appeal.id]?.trim() ||
      (decision === "approved"
        ? "Appeal approved after official review."
        : "Appeal denied after official review.")
    setDecidingId(`${appeal.id}-${decision}`)
    try {
      await reviewConcernAppeal(appeal.id, {
        status: decision,
        decision_note: note,
      })
      setDecisionNotes((current) => {
        const copy = { ...current }
        delete copy[appeal.id]
        return copy
      })
      toast.success(
        decision === "approved" ? "Appeal approved" : "Appeal denied"
      )
      await onAppealsChanged?.()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Appeal decision could not be saved."
      )
    } finally {
      setDecidingId(null)
    }
  }

  const timeline: {
    key: string
    at: number
    message?: ConcernChatMessage
    appeal?: ConcernAppeal
  }[] = [
    ...messages.map((message) => ({
      key: `m-${message.id}`,
      at: new Date(message.created_at).getTime(),
      message,
    })),
    ...appealList.map((appeal) => ({
      key: `a-${appeal.id}`,
      at: new Date(appeal.created_at).getTime(),
      appeal,
    })),
  ].sort((a, b) => a.at - b.at)

  const appealChip = {
    submitted: "bg-violet-100 text-violet-700",
    approved: "bg-emerald-100 text-emerald-700",
    denied: "bg-red-100 text-red-700",
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        !plain && "overflow-hidden rounded-xl border border-slate-200 bg-white",
        showHistory && !plain && "max-h-[400px]",
        className
      )}
    >
      {!plain ? (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-900">
              <MessageCircleIcon
                className="size-4 shrink-0 text-brand-orange"
                strokeWidth={2.25}
              />
              {title}
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-neutral-500">
              {subtitle}
            </p>
          </div>
          {loading ? (
            <Loader2Icon className="size-4 animate-spin text-neutral-400" />
          ) : null}
        </div>
      ) : null}

      {showHistory ? (
        <div
          className={cn(
            "scrollbar-hide min-h-0 flex-1 space-y-3 px-3 py-3 max-lg:overflow-visible lg:overflow-y-auto lg:overscroll-contain",
            plain && "max-h-none"
          )}
        >
          {hasOlder ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-60"
              >
                {loadingOlder ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <ChevronUpIcon className="size-3.5" />
                )}
                {loadingOlder ? "Loading…" : "Load previous messages"}
              </button>
            </div>
          ) : null}
          {messages.length === 0 && appealList.length === 0 && !loading ? (
            loadError ? (
              <div className="py-8 text-center">
                <p className="text-[13px] leading-5 text-sos">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  Try again
                </button>
              </div>
            ) : plain ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="flex size-16 items-center justify-center text-neutral-400">
                  <MessageCircleIcon
                    className="size-10"
                    strokeWidth={1.6}
                    aria-hidden
                  />
                </span>
                <p className="mt-3 text-[15px] font-bold text-neutral-900">
                  Start a conversation
                </p>
                <p className="mt-1 max-w-[300px] text-[13px] leading-5 text-neutral-500">
                  {emptyMessage}
                </p>
              </div>
            ) : (
              <Marker role="status">
                <MarkerContent>{emptyMessage}</MarkerContent>
              </Marker>
            )
          ) : null}

          {timeline.map((entry) => {
            if (entry.appeal) {
              const appeal = entry.appeal
              const own = user?.id != null && appeal.appellant.id === user.id
              const name = appeal.appellant.full_name || "Resident"
              const footer = [
                own ? "You" : name,
                formatChatTime(appeal.created_at),
              ]
                .filter(Boolean)
                .join(" · ")
              return (
                <Message key={entry.key} align={own ? "end" : "start"}>
                  <MessageAvatar>
                    <Avatar online={appeal.appellant.is_online}>
                      <AvatarFallback>
                        {initialsFor(appeal.appellant).charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </MessageAvatar>
                  <MessageContent className={own ? "items-end" : "items-start"}>
                    <div className="w-full max-w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ScaleIcon
                          className="size-3.5 shrink-0 text-violet-700"
                          strokeWidth={2.25}
                        />
                        <span className="text-[11px] font-bold tracking-wide text-violet-700 uppercase">
                          Appeal
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                            appealChip[appeal.status]
                          )}
                        >
                          {appeal.status}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-800">
                        {appeal.reason}
                      </p>
                      {appeal.status !== "submitted" && appeal.decision_note ? (
                        <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-[11.5px] leading-relaxed text-neutral-600">
                          Decision: {appeal.decision_note}
                        </p>
                      ) : null}
                      {appeal.status === "submitted" && canDecideAppeals ? (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            value={decisionNotes[appeal.id] ?? ""}
                            onChange={(event) =>
                              setDecisionNotes((current) => ({
                                ...current,
                                [appeal.id]: event.target.value,
                              }))
                            }
                            rows={2}
                            placeholder="Reason for your decision — the resident sees this."
                            className="w-full resize-y rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-violet-400"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={Boolean(decidingId)}
                              onClick={() =>
                                void decideAppeal(appeal, "approved")
                              }
                              className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {decidingId === `${appeal.id}-approved`
                                ? "Approving…"
                                : "Approve"}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(decidingId)}
                              onClick={() =>
                                void decideAppeal(appeal, "denied")
                              }
                              className="rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                            >
                              {decidingId === `${appeal.id}-denied`
                                ? "Denying…"
                                : "Deny"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <MessageFooter className={own ? "text-right" : "text-left"}>
                      {footer}
                    </MessageFooter>
                  </MessageContent>
                </Message>
              )
            }

            const msg = entry.message!
            const mine = isMine(msg)
            const name = msg.sender?.full_name || "User"
            const deliveryEl = mine && msg.delivery_state
              ? msg.delivery_state === "read"
                ? (
                  <span className="inline-flex items-center">
                    <CheckCheckIcon className="size-3" strokeWidth={2.5} aria-hidden />
                  </span>
                )
                : (
                  <span className="inline-flex items-center">
                    <CheckIcon className="size-3" strokeWidth={2.5} aria-hidden />
                  </span>
                )
              : null
            const footer = [formatChatTime(msg.created_at), name]
              .filter(Boolean)
              .join(" · ")
            const attachment = msg.attachment
            // Keep an uploaded image visible while authenticity analysis is
            // pending; the server still controls access to its media endpoint.
            const attachmentVisible = Boolean(attachment)
            const mediaBlock = attachmentVisible ? (
              <div className={cn(msg.body ? "mt-2" : undefined, "space-y-1")}>
                {attachment!.kind === "image" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewMedia({
                        src: attachment!.preview_url,
                        filename: attachment!.original_filename,
                        kind: "image",
                      })
                    }
                    className="block overflow-hidden rounded-lg text-left"
                  >
                    <AuthenticatedMediaImage
                      src={attachment!.preview_url}
                      alt={attachment!.original_filename}
                      className="max-h-40 max-w-full object-cover"
                    />
                  </button>
                ) : attachment!.kind === "audio" ? (
                  <VoiceNoteBubble
                    url={attachment!.raw_url}
                    filename={attachment!.original_filename}
                    mine={mine}
                    flat
                  />
                ) : (
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
                )}
                {attachment!.kind !== "audio" ? (
                  <p className="text-[10px] opacity-70">
                    Media review:{" "}
                    {attachment!.authenticity_status === "clear"
                      ? "clear"
                      : attachment!.authenticity_status === "flagged"
                        ? "flagged"
                        : "review required"}
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
                  <Avatar online={msg.sender.is_online}>
                    {" "}
                    <AvatarFallback>
                      {initialsFor(msg.sender).charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </MessageAvatar>
                <MessageContent className={mine ? "items-end" : "items-start"}>
                  {content}
                  <MessageFooter className={cn(mine ? "text-right" : "text-left", "flex items-center gap-1")}>
                    {footer}
                    {deliveryEl}
                  </MessageFooter>
                </MessageContent>
              </Message>
            )
          })}
          <div ref={bottomRef} />
        </div>
      ) : null}
      {previewMedia ? (
        <MediaLightbox
          items={[previewMedia]}
          index={0}
          onClose={() => setPreviewMedia(null)}
        />
      ) : null}

      {!disabled ? (
        <div className="px-0 pt-1 pb-1">
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
          {recording || readyFile ? (
            <div className="mx-auto flex w-fit items-center gap-2.5 rounded-full border border-transparent bg-neutral-100 py-2 pr-2 pl-4">
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
                  className="flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-transparent bg-neutral-100 py-1.5 pr-1.5 pl-4 transition-colors focus-within:border-neutral-200">
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={sending}
                aria-label="Record a voice note"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
              >
                <MicIcon className="size-4" />
              </button>
              <label
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-500 focus-within:ring-2 focus-within:ring-neutral-500 focus-within:ring-offset-2 focus-within:outline-none hover:bg-neutral-100 hover:text-neutral-900"
                aria-label="Attach image or video"
              >
                <PaperclipIcon className="size-4" />
                <input
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  className="sr-only"
                  onChange={(event) => {
                    void chooseAttachment(event.target.files?.[0])
                    event.currentTarget.value = ""
                  }}
                />
              </label>
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
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                placeholder="Send a message"
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
                  "flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none",
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
          <p className="mt-2.5 text-center text-[11px] leading-normal text-neutral-500">
            Please be respectful at all times.
          </p>
        </div>
      ) : (
        <div className="px-4 pt-1 pb-4">
          <p className="py-1.5 text-center text-[12px] text-neutral-600">
            Chat is closed for this report.
          </p>
          {pendingAppeal ? (
            <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-center text-[12px] font-medium text-violet-700">
              Your appeal is being reviewed by the barangay. The decision will
              appear in this thread.
            </p>
          ) : canFileAppeal && !appealComposerOpen ? (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={() => setAppealComposerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1.5 text-[12px] font-bold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100"
              >
                <ScaleIcon className="size-3.5" strokeWidth={2.25} />
                Appeal this decision
              </button>
            </div>
          ) : canFileAppeal && appealComposerOpen ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3">
              <p className="text-[12px] font-bold text-neutral-900">
                Appeal this decision
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">
                Explain what the barangay should reconsider. Your appeal and any
                evidence appear in this thread.
              </p>
              <textarea
                autoFocus
                value={appealReason}
                onChange={(event) => setAppealReason(event.target.value)}
                rows={3}
                placeholder="Explain why this report should be reviewed again…"
                className="mt-2 w-full resize-y rounded-lg border border-violet-200 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-violet-400"
              />
              {appealMedia ? (
                <div className="mt-2 flex items-center gap-2">
                  <LocalAttachmentPreview
                    file={appealMedia}
                    className="!size-16 rounded-lg"
                    onRemove={() => setAppealMedia(null)}
                  />
                </div>
              ) : null}
              {appealMediaError ? (
                <p className="mt-2 text-[11px] font-medium text-red-500">
                  {appealMediaError}
                </p>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-2">
                <label
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full text-neutral-500 transition-colors focus-within:ring-2 focus-within:ring-neutral-500 focus-within:ring-offset-2 focus-within:outline-none hover:bg-white hover:text-neutral-900"
                  aria-label="Attach image or video as evidence"
                >
                  <PaperclipIcon className="size-4" />
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/webm,video/quicktime"
                    className="sr-only"
                    onChange={(event) => {
                      void chooseAppealMedia(event.target.files?.[0])
                      event.currentTarget.value = ""
                    }}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAppealComposerOpen(false)}
                    className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={filingAppeal || !appealReason.trim()}
                    onClick={() => void submitAppeal()}
                    className="rounded-full bg-brand-orange px-4 py-1.5 text-[11.5px] font-bold text-white transition-colors hover:bg-brand-orange-strong disabled:opacity-50"
                  >
                    {filingAppeal ? "Submitting…" : "Submit appeal"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
