import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, BotMessageSquareIcon, RotateCwIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { ApiError } from "@/lib/api"
import {
  askAssistant,
  fetchAssistantTopics,
  type AssistantChip,
  type AssistantTurn,
} from "./assistant-api"

interface Bubble {
  id: number
  role: "user" | "assistant"
  text: string
}

const OPENING_CHIPS: AssistantChip[] = [
  { id: "create-account", label: "How do I create an account?", icon: "user-plus" },
  { id: "report-concern", label: "How do I report a concern?", icon: "megaphone" },
  { id: "how-it-works", label: "How does the app work?", icon: "info" },
  { id: "login-problem", label: "I have login problems", icon: "lock" },
  { id: "contact-support", label: "Contact Support", icon: "headset" },
]

const OPENING_GREETING =
  "Hello. I am the E-Boses Assistant. You may ask a question about the app or choose a topic below."

type Segment =
  | { kind: "text"; body: string }
  | { kind: "steps"; items: string[] }

function formatReply(text: string): Segment[] {
  const segments: Segment[] = []
  let paragraph: string[] = []
  let steps: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      segments.push({ kind: "text", body: paragraph.join(" ") })
      paragraph = []
    }
  }
  const flushSteps = () => {
    if (steps.length > 0) {
      segments.push({ kind: "steps", items: steps })
      steps = []
    }
  }

  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushSteps()
      continue
    }
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const bulleted = line.match(/^[-•*]\s+(.*)$/)
    if (numbered || bulleted) {
      flushParagraph()
      steps.push((numbered?.[1] ?? bulleted?.[1] ?? "").trim())
      continue
    }
    flushSteps()
    paragraph.push(line)
  }
  flushParagraph()
  flushSteps()
  return segments
}

function AssistantMessage({ text }: { text: string }) {
  const segments = formatReply(text)
  return (
    <div className="max-w-[88%] space-y-2.5 rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-3 text-[14px] leading-[1.6] text-neutral-800">
      {segments.map((segment, index) =>
        segment.kind === "steps" ? (
          <ol
            key={index}
            className="ml-4 list-decimal space-y-1.5 marker:font-medium marker:text-neutral-400"
          >
            {segment.items.map((item) => (
              <li key={item} className="pl-1">
                {item}
              </li>
            ))}
          </ol>
        ) : (
          <p key={index}>{segment.body}</p>
        ),
      )}
    </div>
  )
}

const MOTION_CSS = `
@keyframes eb-assistant-panel-in {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes eb-assistant-bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes eb-assistant-dot {
  0%, 60%, 100% { opacity: 0.28; transform: translateY(0); }
  30%           { opacity: 0.85; transform: translateY(-3px); }
}
.eb-assistant-panel {
  animation: eb-assistant-panel-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-origin: bottom right;
}
.eb-assistant-scrim { display: none; }
.eb-assistant-bubble { animation: eb-assistant-bubble-in 200ms ease-out both; }
.eb-assistant-dot { animation: eb-assistant-dot 1.2s ease-in-out infinite; }
.eb-assistant-scroll { scrollbar-width: thin; scrollbar-color: #d4d4d8 transparent; }
.eb-assistant-scroll::-webkit-scrollbar { width: 6px; }
.eb-assistant-scroll::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.eb-assistant-scroll::-webkit-scrollbar-track { background: transparent; }
.eb-assistant-scroll::-webkit-scrollbar-thumb {
  background-color: #d4d4d8;
  border-radius: 999px;
}
.eb-assistant-scroll::-webkit-scrollbar-thumb:hover { background-color: #a1a1aa; }
@media (max-width: 767px) {
  .eb-assistant-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 59;
    border: 0;
    background: rgba(0, 0, 0, 0.4);
  }
  .eb-assistant-panel {
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: min(38rem, 86dvh) !important;
    max-height: calc(100dvh - env(safe-area-inset-top));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 28px 28px 0 0;
    transform-origin: bottom center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .eb-assistant-panel, .eb-assistant-bubble { animation: none; }
  .eb-assistant-dot { animation: none; opacity: 0.4; }
}
`

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default function AssistantWidget({ onDark = false }: { onDark?: boolean }) {
  const [open, setOpen] = useState(false)
  const [suppressed, setSuppressed] = useState(false)
  const [greeting, setGreeting] = useState(OPENING_GREETING)
  const [chips, setChips] = useState<AssistantChip[]>(OPENING_CHIPS)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchAssistantTopics()
      .then((data) => {
        if (cancelled) return
        setGreeting(data.greeting)
        setChips(data.topics)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 767px)").matches) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  /**
   * The landing hamburger menu (and any other overlay) can ask the assistant
   * to step aside while it is open.
   */
  useEffect(() => {
    const onNavMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ open: boolean }>).detail
      if (detail?.open) {
        setSuppressed(true)
        setOpen(false)
      } else {
        setSuppressed(false)
      }
    }
    window.addEventListener("eb:nav-menu", onNavMenu)
    return () => window.removeEventListener("eb:nav-menu", onNavMenu)
  }, [])

  useEffect(() => {
    if (bubbles.length === 0) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [bubbles, busy])

  function push(role: Bubble["role"], text: string) {
    setBubbles((current) => [...current, { id: nextId.current++, role, text }])
  }

  function historyFor(): AssistantTurn[] {
    return bubbles.slice(-4).map((bubble) => ({ role: bubble.role, content: bubble.text }))
  }

  async function send(payload: { message?: string; topicId?: string; label?: string }) {
    if (busy) return
    setNotice("")
    push("user", payload.label ?? payload.message ?? "")
    setBusy(true)
    try {
      const answer = await askAssistant({
        message: payload.message,
        topicId: payload.topicId,
        history: historyFor(),
      })
      push("assistant", answer.reply)
      if (answer.suggestions.length > 0) setChips(answer.suggestions)
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setNotice(
          typeof error.message === "string" && error.message
            ? error.message
            : "Please wait a moment before asking again.",
        )
      } else {
        push(
          "assistant",
          "I could not reach the assistant service just now. Please try again in a moment, or choose a topic below.",
        )
      }
    } finally {
      setBusy(false)
    }
  }

  function submitDraft() {
    const message = draft.trim()
    if (message.length < 2 || busy) return
    setDraft("")
    void send({ message })
  }

  function resetChat() {
    if (busy) return
    setBubbles([])
    setNotice("")
    setDraft("")
    setChips(OPENING_CHIPS)
    nextId.current = 1
    fetchAssistantTopics()
      .then((data) => {
        setGreeting(data.greeting)
        setChips(data.topics)
      })
      .catch(() => undefined)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  if (suppressed) {
    return null
  }

  if (!open) {
    return (
      <>
        <style>{MOTION_CSS}</style>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the E-Boses Assistant"
          className={cn(
            "group fixed right-6 bottom-6 z-[60] flex h-14 items-center rounded-full transition-[background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            onDark
              ? "bg-white text-brand-navy shadow-[0_8px_28px_rgba(0,0,0,0.5)] hover:bg-neutral-100"
              : "bg-nav-bg text-white shadow-[0_8px_28px_rgba(5,13,51,0.4)] ring-1 ring-white/15 hover:bg-brand-navy",
          )}
        >
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[14px] font-semibold opacity-0 transition-all duration-300 ease-out group-hover:max-w-[11rem] group-hover:pl-5 group-hover:opacity-100 group-focus-visible:max-w-[11rem] group-focus-visible:pl-5 group-focus-visible:opacity-100 motion-reduce:transition-none">
            Need some help?
          </span>
          <span className="flex size-14 shrink-0 items-center justify-center">
            <BotMessageSquareIcon className="size-6" strokeWidth={1.9} aria-hidden />
          </span>
        </button>
      </>
    )
  }

  const canSend = draft.trim().length >= 2 && !busy

  return (
    <>
      <style>{MOTION_CSS}</style>
      <button
        type="button"
        aria-label="Close the assistant"
        onClick={() => setOpen(false)}
        className="eb-assistant-scrim"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="E-Boses Assistant"
        className="eb-assistant-panel fixed right-6 bottom-6 z-[60] flex h-[min(38rem,calc(100dvh-3rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_24px_64px_rgba(5,13,51,0.28)]"
      >
        <header className="flex items-center justify-end gap-2 bg-white px-4 pb-1 pt-3">
          <button
            type="button"
            onClick={resetChat}
            aria-label="Start a new conversation"
            title="Start a new conversation"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
          >
            <RotateCwIcon className="size-5" strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the assistant"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
          >
            <XIcon className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div ref={scrollRef} className="eb-assistant-scroll flex-1 space-y-3.5 overflow-y-auto px-5 pb-4 pt-1">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-neutral-200" />
            <span className="text-[12px] font-medium text-neutral-400">{todayLabel()}</span>
            <span aria-hidden className="h-px flex-1 bg-neutral-200" />
          </div>

          <div className="flex">
            <p className="max-w-[88%] rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-3 text-[14px] leading-[1.6] text-neutral-800">
              {greeting}
            </p>
          </div>

          {bubbles.map((bubble) => (
            <div
              key={bubble.id}
              className={cn("eb-assistant-bubble flex", bubble.role === "user" && "justify-end")}
            >
              {bubble.role === "user" ? (
                <p className="max-w-[88%] whitespace-pre-line rounded-2xl rounded-br-md bg-brand-navy px-4 py-2.5 text-[14px] leading-relaxed text-white">
                  {bubble.text}
                </p>
              ) : (
                <AssistantMessage text={bubble.text} />
              )}
            </div>
          ))}

          {busy ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  aria-hidden
                  className="eb-assistant-dot size-2 rounded-full bg-neutral-400"
                  style={{ animationDelay: `${dot * 160}ms` }}
                />
              ))}
              <span className="sr-only">The assistant is replying</span>
            </div>
          ) : null}

          {notice ? (
            <p className="rounded-2xl bg-brand-orange-soft px-4 py-3 text-[13px] leading-relaxed text-neutral-700">
              {notice}
            </p>
          ) : null}

          {chips.length > 0 && !busy ? (
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {chips.map((chip, index) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => void send({ topicId: chip.id, label: chip.label })}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-colors duration-150",
                    index === 0
                      ? "border-brand-navy bg-brand-navy text-white hover:bg-nav-bg"
                      : "border-brand-navy/35 bg-white text-brand-navy hover:border-brand-navy hover:bg-neutral-50",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
          <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1.5 pl-5 pr-1.5 transition-colors focus-within:border-brand-navy/30">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  submitDraft()
                }
              }}
              maxLength={500}
              placeholder="Ask a question..."
              aria-label="Ask the E-Boses Assistant"
              className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-150",
                canSend
                  ? "bg-nav-bg text-white hover:bg-brand-navy"
                  : "bg-neutral-100 text-neutral-300",
              )}
            >
              <ArrowUpIcon className="size-4.5" strokeWidth={2.4} aria-hidden />
            </button>
          </div>
          <p className="mt-2.5 text-center text-[11px] leading-normal text-neutral-400">
            Please be kind and respectful to your neighbours.
          </p>
        </div>
      </section>
    </>
  )
}
