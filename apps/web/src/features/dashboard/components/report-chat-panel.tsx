import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, MessageCircleIcon, SendIcon } from "lucide-react"
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
  className,
}: {
  concernId: number
  open?: boolean
  /** When true, hide composer (e.g. rejected-only view) */
  disabled?: boolean
  className?: string
}) {
  const { user } = useAuthSession()
  const [messages, setMessages] = useState<ConcernChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isMine = useCallback(
    (msg: ConcernChatMessage) => {
      if (user?.id != null && msg.sender?.id != null) return msg.sender.id === user.id
      return Boolean(msg.is_mine)
    },
    [user?.id],
  )

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
  }, [])

  const load = useCallback(async () => {
    if (!open || !concernId) return
    setLoading(true)
    try {
      const next = await listConcernChat(concernId)
      setMessages(next)
      scrollToBottom()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load chat.")
    } finally {
      setLoading(false)
    }
  }, [concernId, open, scrollToBottom])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open || !concernId) return
    const id = window.setInterval(() => {
      void listConcernChat(concernId)
        .then((next) => {
          setMessages((prev) => {
            if (next.length === prev.length && next.at(-1)?.id === prev.at(-1)?.id) return prev
            return next
          })
        })
        .catch(() => {
          /* ignore poll errors */
        })
    }, 6000)
    return () => window.clearInterval(id)
  }, [open, concernId])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending || disabled) return
    setSending(true)
    try {
      const created = await sendConcernChat(concernId, body)
      setDraft("")
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
        "flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-900">
            <MessageCircleIcon className="size-4 shrink-0 text-[#ff6a1a]" strokeWidth={2.25} />
            Report chat
          </p>
          <p className="mt-0.5 text-[12px] font-medium text-neutral-500">
            Private thread · you and barangay staff
          </p>
        </div>
        {loading ? <Loader2Icon className="size-4 animate-spin text-neutral-400" /> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.length === 0 && !loading ? (
          <p className="py-8 text-center text-[13px] leading-5 text-neutral-500">
            Message the barangay team about this report — updates and questions stay here.
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
                  {msg.body}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!disabled ? (
        <div className="flex items-end gap-2 border-t border-neutral-100 p-2.5 sm:p-3">
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
            disabled={sending || !draft.trim()}
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
      ) : (
        <p className="border-t border-neutral-100 px-3 py-2.5 text-center text-[12px] text-neutral-400">
          Chat is closed for this report.
        </p>
      )}
    </div>
  )
}
