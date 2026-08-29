import { useState } from "react"
import {
  CircleCheckIcon,
  ClockIcon,
  HardHatIcon,
  InboxIcon,
  MessageSquareIcon,
  NetworkIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { PublicUser } from "@/features/dashboard/api"

type TimelineState = "done" | "current" | "pending" | "cancelled"
type TimelineAccent = "neutral" | "brand" | "success" | "warning" | "danger" | "info"
type TimelineIcon = "inbox" | "clock" | "network" | "hardhat" | "check" | "x" | "message"

const ICONS: Record<TimelineIcon, LucideIcon> = {
  inbox: InboxIcon,
  clock: ClockIcon,
  network: NetworkIcon,
  hardhat: HardHatIcon,
  check: CircleCheckIcon,
  x: XCircleIcon,
  message: MessageSquareIcon,
}

const ACCENT_ICON: Record<TimelineAccent, string> = {
  neutral: "text-neutral-500",
  brand: "text-brand-orange-strong",
  success: "text-status-closed",
  warning: "text-severity-moderate",
  danger: "text-severity-critical",
  info: "text-status-active",
}

function dayLabel(value: string | null) {
  if (!value) return "PENDING"
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return "TODAY"
  if (new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString()) return "YESTERDAY"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date).toUpperCase()
}

function formatTimeOnly(value: string | null) {
  if (!value) return "Pending"
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    barangay_official: "Barangay Official",
    first_responder: "Responder",
    admin: "Administrator",
    resident: "Resident",
  }
  return labels[role] || "User"
}

function ActorLine({ label, user }: { label?: string | null; user?: PublicUser | null }) {
  if (!label) return null
  const displayName = user?.full_name || label
  const role = user ? roleLabel(user.role) : ""
  const displayText = role ? `${displayName} · ${role}` : displayName

  return (
    <div className="mt-0.5 text-[10.5px] text-faint-foreground">
      <span className="truncate">{displayText}</span>
    </div>
  )
}

export type EmergencyTimelineEntry = {
  id: string
  badge: string
  time: string | null
  state?: TimelineState
  accent?: TimelineAccent
  icon?: TimelineIcon
  actor?: string | null
  actorUser?: PublicUser | null
  content?: React.ReactNode
}

export function EmergencyTimelineCard({
  items,
  className,
  emptyLabel = "No timeline yet",
  collapsibleHistory = false,
}: {
  items: EmergencyTimelineEntry[]
  className?: string
  emptyLabel?: string
  collapsibleHistory?: boolean
}) {
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(null)
  const timelineKey = items.map((item) => item.id).join("|")
  const historyExpanded = expandedTimelineKey === timelineKey

  if (items.length === 0) {
    return (
      <div className={cn("rounded-[16px] bg-neutral-50 p-4 text-center", className)}>
        <p className="text-[11px] font-normal text-neutral-400">{emptyLabel}</p>
      </div>
    )
  }

  const ordered = [...items].reverse()
  const [hero, ...history] = ordered
  const visibleHistory = collapsibleHistory && !historyExpanded ? [] : history
  const heroCancelled = hero.state === "cancelled"
  const HeroIcon = heroCancelled ? XCircleIcon : ICONS[hero.icon ?? "clock"]
  const heroColor = heroCancelled ? ACCENT_ICON.danger : ACCENT_ICON[hero.accent ?? "neutral"]

  let lastDay = dayLabel(hero.time)

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[9px] font-medium tracking-wider text-faint-foreground">{dayLabel(hero.time)}</p>

      <div className="relative flex gap-2.5 pt-0.5">
        <div className="relative flex flex-col items-center">
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-white")}>
            <HeroIcon className={cn("size-[19px]", heroColor)} strokeWidth={1.8} />
          </span>
          {visibleHistory.length ? (
            <span aria-hidden className="mt-0.5 w-0.5 flex-1 rounded-full bg-neutral-200" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 pb-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11.5px] font-semibold leading-tight text-foreground">{hero.badge}</p>
            <span className="shrink-0 text-[9px] tabular-nums text-faint-foreground" title={hero.time ?? ""}>
              {formatTimeOnly(hero.time)}
            </span>
          </div>
          <ActorLine label={hero.actor} user={hero.actorUser} />
          {hero.content ? <div className="mt-0.5">{hero.content}</div> : null}
        </div>
      </div>

      {collapsibleHistory && history.length > 0 && !historyExpanded ? (
        <button
          type="button"
          aria-expanded={historyExpanded}
          onClick={() => setExpandedTimelineKey(timelineKey)}
          className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
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
              <p className="flex items-center gap-2 py-1 pl-0.5 text-[9px] font-medium tracking-wider text-faint-foreground">
                {day}
                <span aria-hidden className="h-px flex-1 bg-neutral-100" />
              </p>
            ) : null}
            <div className="relative flex gap-2.5">
              <div className="relative flex flex-col items-center">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white">
                  <HistoryIcon className={cn("size-[15px]", ACCENT_ICON[item.accent ?? "neutral"])} strokeWidth={1.8} />
                </span>
                {!isLast ? <span aria-hidden className="w-0.5 flex-1 rounded-full bg-neutral-200" /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-medium leading-tight text-neutral-800">{item.badge}</p>
                  <span className="shrink-0 text-[9px] tabular-nums text-faint-foreground" title={item.time ?? ""}>
                    {formatTimeOnly(item.time)}
                  </span>
                </div>
                <ActorLine label={item.actor} user={item.actorUser} />
                {item.content ? <div className="mt-0.5">{item.content}</div> : null}
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
          className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Collapse
        </button>
      ) : null}
    </div>
  )
}
