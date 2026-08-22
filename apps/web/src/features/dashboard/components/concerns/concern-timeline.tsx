import {
  CircleCheckIcon,
  UserCheckIcon,
  Loader2Icon,
  XCircleIcon,
  AlertCircleIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  type ConcernTimelineEntry,
} from "@/features/dashboard/components/concerns/concern-timeline-lib"

/** Status → Lucide icon mapping */
function TimelineIcon({ state, badge }: { state?: ConcernTimelineEntry["state"]; badge: string }) {
  const lower = badge.toLowerCase()

  if (state === "cancelled") {
    return <XCircleIcon className="size-4 text-neutral-400" />
  }
  if (state === "done") {
    return <CircleCheckIcon className="size-4 text-emerald-500" />
  }
  if (state === "current") {
    if (lower.includes("assigned") || lower.includes("reassigned"))
      return <UserCheckIcon className="size-4 text-blue-500" />
    if (lower.includes("progress") || lower.includes("being worked"))
      return <Loader2Icon className="size-4 text-blue-500 animate-spin" />
    if (lower.includes("appeal"))
      return <AlertCircleIcon className="size-4 text-violet-500" />
    return <CircleCheckIcon className="size-4 text-blue-500" />
  }
  // pending
  return <CircleCheckIcon className="size-4 text-neutral-300" />
}

function formatShortTime(value: string) {
  const date = new Date(value)
  const day = date.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th"
  const month = date.toLocaleDateString("en", { month: "long" })
  const time = date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })
  return `${day}${suffix} ${month}, ${time}`
}

export function ConcernTimeline({
  items,
  className,
  compact = false,
  emptyLabel = "No timeline yet",
}: {
  items: ConcernTimelineEntry[]
  className?: string
  compact?: boolean
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 text-center", className)}>
        <p className="text-[13px] font-medium text-neutral-400">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div className={cn(compact ? "space-y-4" : "space-y-5", className)}>
      {items.map((item, index) => {
        const isPending = item.state === "pending"

        return (
          <div key={item.id} className="relative flex gap-3">
            {/* Icon + vertical line */}
            <div className="relative flex flex-col items-center pt-0.5">
              <TimelineIcon state={item.state} badge={item.badge} />
              {index < items.length - 1 ? (
                <span className="mt-1.5 h-full w-px flex-1 bg-neutral-200" />
              ) : null}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <time
                  dateTime={item.time ?? undefined}
                  className={cn(
                    "text-[11px] tabular-nums",
                    isPending ? "text-neutral-300" : "text-neutral-400",
                  )}
                >
                  {item.time ? formatShortTime(item.time) : "Pending"}
                </time>
                {item.actor ? (
                  <span className="text-[11px] text-neutral-300">·</span>
                ) : null}
                {item.actor ? (
                  <span className="text-[11px] text-neutral-400">{item.actor}</span>
                ) : null}
              </div>
              <p className={cn(
                compact ? "mt-0.5 text-[13px]" : "mt-1 text-[13px]",
                "font-medium leading-snug",
                isPending ? "text-neutral-400" : "text-neutral-700",
              )}>
                {item.badge}
              </p>
              <div className={cn(
                compact ? "mt-0.5 text-[12px]" : "mt-1 text-[13px]",
                "leading-relaxed",
                isPending ? "text-neutral-400" : "text-neutral-600",
                typeof item.content === "string" && "whitespace-pre-wrap",
              )}>
                {item.content}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
