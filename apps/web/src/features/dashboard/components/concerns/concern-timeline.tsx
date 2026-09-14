import {
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  HardHatIcon,
  InboxIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  NetworkIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShieldOffIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import {
  type ConcernTimelineAccent,
  type ConcernTimelineEntry,
  type ConcernTimelineIcon,
} from "@/features/dashboard/components/concerns/concern-timeline-lib"

const ICONS: Record<ConcernTimelineIcon, LucideIcon> = {
  inbox: InboxIcon,
  clock: ClockIcon,
  network: NetworkIcon,
  hardhat: HardHatIcon,
  check: CircleCheckIcon,
  x: XCircleIcon,
  scale: ScaleIcon,
  mail: MailIcon,
  message: MessageSquareIcon,
  question: MessageCircleQuestionIcon,
  shield: ShieldOffIcon,
  rotate: RotateCcwIcon,
}

const ACCENT_ICON: Record<ConcernTimelineAccent, string> = {
  neutral: "text-neutral-500",
  brand: "text-brand-orange-strong",
  success: "text-status-closed",
  warning: "text-severity-moderate",
  danger: "text-severity-critical",
  info: "text-status-active",
  cyan: "text-ice",
  violet: "text-chart-3",
}

function dayLabel(value: string | null) {
  if (!value) return "PENDING"
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return "TODAY"
  if (
    new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString()
  )
    return "YESTERDAY"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(date)
    .toUpperCase()
}

function fullDayLabel(value: string | null) {
  if (!value) return "Pending"
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return "Today"
  if (
    new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString()
  )
    return "Yesterday"
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatShortTime(value: string | null) {
  if (!value) return "Pending"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatTimeOnly(value: string | null) {
  if (!value) return "Pending"
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function ActorLine({ label, className }: { label?: string | null; className?: string }) {
  if (!label) return null
  return (
    <div className={cn("mt-0.5 min-w-0 text-neutral-500", className ?? "text-[12px]")}>
      <span className="truncate">{label}</span>
    </div>
  )
}

export function ConcernTimeline({
  items,
  className,
  emptyLabel = "No timeline yet",
  collapsibleHistory = false,
  large = false,
  trackingId = null,
}: {
  items: ConcernTimelineEntry[]
  className?: string
  emptyLabel?: string
  collapsibleHistory?: boolean
  large?: boolean
  trackingId?: string | null
}) {
  async function copyTracking() {
    if (!trackingId) return
    try {
      await navigator.clipboard.writeText(trackingId)
      toast.success("Tracking ID copied")
      return
    } catch {
      /* clipboard API unavailable (e.g. insecure context) — fall through */
    }
    try {
      const area = document.createElement("textarea")
      area.value = trackingId
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(area)
      if (!ok) throw new Error("copy failed")
      toast.success("Tracking ID copied")
    } catch {
      toast.error("Could not copy tracking ID.")
    }
  }
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(
    null
  )
  const timelineKey = items.map((item) => item.id).join("|")
  const historyExpanded = expandedTimelineKey === timelineKey

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 text-center",
          className
        )}
      >
        <p className={cn("font-medium text-neutral-600", large ? "text-[15px]" : "text-[13px]")}>{emptyLabel}</p>
      </div>
    )
  }

  const ordered = [...items].reverse()
  const [hero, ...history] = ordered
  const visibleHistory = collapsibleHistory && !historyExpanded ? [] : history
  const heroCancelled = hero.state === "cancelled"
  const HeroIcon = heroCancelled ? XCircleIcon : ICONS[hero.icon ?? "clock"]
  const heroColor = heroCancelled
    ? ACCENT_ICON.danger
    : ACCENT_ICON[hero.accent ?? "neutral"]

  let lastDay = dayLabel(hero.time)

  const dayText = large ? "text-[15px]" : "text-[10px]"
  const timeText = large ? "text-[15px]" : "text-[11px]"
  const actorText = large ? "text-[15px]" : "text-[12px]"
  const heroBadgeText = large ? "text-[15px]" : "text-[12.5px]"
  const historyBadgeText = large ? "text-[15px]" : "text-[12px]"
  const moreText = large ? "text-[15px]" : "text-[11.5px]"
  const heroBox = large ? "size-8" : "size-6"
  const heroIconSize = large ? "size-6" : "size-[19px]"
  const historyBox = large ? "size-6" : "size-5"
  const historyIconSize = large ? "size-[18px]" : "size-[15px]"

  if (large) {
    const rows = [hero, ...visibleHistory]
    let currentDay = ""
    return (
      <div className={className}>
        {rows.map((entry, index) => {
          const entryDay = dayLabel(entry.time)
          const showDay = entryDay !== currentDay
          currentDay = entryDay
          const isCurrent = entry.state === "current"
          const accent = entry.accent ?? "neutral"
          const dotSolid =
            accent === "success"
              ? "bg-emerald-500"
              : accent === "danger"
                ? "bg-sos"
                : isCurrent
                  ? "bg-brand-orange"
                  : "bg-neutral-300"
          return (
            <div
              key={entry.id}
              className="border-b border-neutral-100 last:border-b-0"
            >
              {showDay ? (
                <p className="flex items-center gap-2 py-1 text-neutral-500">
                  <span aria-hidden className="h-px flex-1 bg-neutral-200" />
                  <span className="text-[13px]">
                    {fullDayLabel(entry.time)}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-neutral-200" />
                </p>
              ) : null}
              <div className="flex items-center gap-3 py-2.5">
                <p className="w-16 shrink-0 text-left text-[13px] text-neutral-900 tabular-nums">
                  {formatTimeOnly(entry.time)}
                </p>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] font-normal text-neutral-900">
                    {isCurrent ? (
                      <span className="relative flex size-2 shrink-0">
                        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping", dotSolid)} />
                        <span className={cn("relative inline-flex size-2 rounded-full", dotSolid)} />
                      </span>
                    ) : (
                      <span className={cn("size-2 shrink-0 rounded-full", dotSolid)} />
                    )}
                    {entry.badge}
                  </p>
                  {entry.actor ? (
                    <p className="mt-0.5 truncate text-[15px] text-neutral-500">
                      {entry.actor}
                    </p>
                  ) : null}
                  {entry.content ? (
                    <div className="mt-1.5">{entry.content}</div>
                  ) : null}
                </div>
              </div>
              {index === rows.length - 1 && trackingId ? (
                <div className="flex items-center justify-center gap-1.5 pt-1 pb-2.5">
                  <span className="text-[13px] text-neutral-400">
                    Tracking ID:
                  </span>
                  <span className="text-[13px] tracking-wide text-neutral-500 tabular-nums">
                    {trackingId}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyTracking()}
                    aria-label="Copy tracking ID"
                    className="flex size-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <CopyIcon
                      className="size-4"
                      strokeWidth={2}
                      aria-hidden
                    />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {collapsibleHistory && history.length > 0 && !historyExpanded ? (
          <button
            type="button"
            aria-expanded={historyExpanded}
            onClick={() => setExpandedTimelineKey(timelineKey)}
            className={cn("mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50", moreText)}
          >
            Load more
          </button>
        ) : null}
        {collapsibleHistory && history.length > 0 && historyExpanded ? (
          <button
            type="button"
            aria-expanded={historyExpanded}
            onClick={() => setExpandedTimelineKey(null)}
            className={cn("mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50", moreText)}
          >
            Collapse
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn("space-y-1", className)}>
      {large ? (
        <p className="flex items-center gap-2 text-neutral-500">
          <span aria-hidden className="h-px flex-1 bg-neutral-200" />
          <span className="text-[13px]">{fullDayLabel(hero.time)}</span>
          <span aria-hidden className="h-px flex-1 bg-neutral-200" />
        </p>
      ) : (
        <p className={cn("font-semibold tracking-wider text-neutral-500", dayText)}>
          {dayLabel(hero.time)}
        </p>
      )}

      <div className="relative flex gap-2.5 pt-0.5">
        <div className="relative flex flex-col items-center">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-white",
              heroBox
            )}
          >
            <HeroIcon
              className={cn(heroIconSize, heroColor)}
              strokeWidth={1.8}
            />
          </span>
          {visibleHistory.length ? (
            <span
              aria-hidden
              className="mt-0.5 w-0.5 flex-1 rounded-full bg-neutral-200"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 pb-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn("leading-tight font-semibold text-foreground", heroBadgeText)}>
              {hero.badge}
            </p>
            <span
              className={cn("shrink-0 text-neutral-500 tabular-nums", timeText)}
              title={formatShortTime(hero.time)}
            >
              {formatTimeOnly(hero.time)}
            </span>
          </div>
          <ActorLine label={hero.actor} className={actorText} />
          {hero.content ? <div className="mt-0.5">{hero.content}</div> : null}
        </div>
      </div>

      {collapsibleHistory && history.length > 0 && !historyExpanded ? (
        <button
          type="button"
          aria-expanded={historyExpanded}
          onClick={() => setExpandedTimelineKey(timelineKey)}
          className={cn("mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50", moreText)}
        >
          Load more
        </button>
      ) : null}

      {visibleHistory.map((item, index) => {
        const day = dayLabel(item.time)
        const showDivider = day !== lastDay
        lastDay = day
        const isLast = index === visibleHistory.length - 1
        const HistoryIcon = ICONS[item.icon ?? "clock"]
        return (
          <div key={item.id}>
            {showDivider ? (
              large ? (
                <p className="flex items-center gap-2 py-1 text-neutral-500">
                  <span aria-hidden className="h-px flex-1 bg-neutral-200" />
                  <span className="text-[13px]">{fullDayLabel(item.time)}</span>
                  <span aria-hidden className="h-px flex-1 bg-neutral-200" />
                </p>
              ) : (
                <p className={cn("flex items-center gap-2 py-1 pl-0.5 font-semibold tracking-wider text-neutral-500", dayText)}>
                  {day}
                  <span aria-hidden className="h-px flex-1 bg-neutral-100" />
                </p>
              )
            ) : null}
            <div className="relative flex gap-2.5">
              <div className="relative flex flex-col items-center">
                <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-white", historyBox)}>
                  <HistoryIcon
                    className={cn(
                      historyIconSize,
                      ACCENT_ICON[item.accent ?? "neutral"]
                    )}
                    strokeWidth={1.8}
                  />
                </span>
                {!isLast ? (
                  <span
                    aria-hidden
                    className="w-0.5 flex-1 rounded-full bg-neutral-200"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("leading-tight font-normal text-neutral-800", historyBadgeText)}>
                    {item.badge}
                  </p>
                  <span
                    className={cn("shrink-0 text-neutral-500 tabular-nums", timeText)}
                    title={formatShortTime(item.time)}
                  >
                    {formatTimeOnly(item.time)}
                  </span>
                </div>
                <ActorLine label={item.actor} className={actorText} />
                {item.content ? (
                  <div className="mt-0.5">{item.content}</div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      {collapsibleHistory && history.length > 0 && historyExpanded ? (
        <button
          type="button"
          aria-expanded={historyExpanded}
          onClick={() => setExpandedTimelineKey(null)}
          className={cn("mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50", moreText)}
        >
          Collapse
        </button>
      ) : null}
    </div>
  )
}
