import { cn } from "@workspace/ui/lib/utils"

import {
  concernTimelineBadgeTone,
  concernTimelineDotTone,
  formatTimelineTime,
  type ConcernTimelineEntry,
} from "@/features/dashboard/components/concerns/concern-timeline-lib"

export function ConcernTimeline({
  items,
  className,
  emptyLabel = "No timeline yet",
}: {
  items: ConcernTimelineEntry[]
  className?: string
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-card-line bg-card-raised px-5 py-8 text-center", className)}>
        <p className="text-sm font-semibold text-muted-foreground">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <ol className={cn("space-y-0", className)} aria-label="Case timeline, oldest to newest">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        const accent = item.accent ?? "neutral"
        return (
          <li key={item.id} className="grid grid-cols-[minmax(0,10rem)_2rem_minmax(0,1fr)] items-stretch gap-x-4 py-4 sm:grid-cols-[minmax(0,11rem)_2rem_minmax(0,1fr)]">
            <div className="self-center py-2 text-[13px] font-semibold leading-5 text-muted-foreground">
              {item.time ? (
                <time dateTime={item.time}>{formatTimelineTime(item.time)}</time>
              ) : (
                "Pending"
              )}
            </div>
            <div className="relative flex h-full min-h-20 justify-center">
              <span
                className={cn(
                  "absolute left-1/2 top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-card",
                  concernTimelineDotTone(accent),
                  // Halo drawn in the raised-surface token so it reads on white
                  // and on the dark console alike; the previous hardcoded
                  // near-black ring was invisible on #0e1424.
                  item.state === "current" && "shadow-[0_0_0_5px_var(--color-card-raised)]",
                  item.state === "cancelled" && "opacity-80",
                )}
              />
              {!isLast ? <span className="absolute left-1/2 top-[calc(50%+0.75rem)] h-28 w-px -translate-x-1/2 bg-card-line" /> : null}
            </div>
            <div className="min-w-0 py-2">
              <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold", concernTimelineBadgeTone(accent))}>
                {item.badge}
              </span>
              <div className={cn("mt-3 min-w-0 text-[15px] leading-6 text-muted-foreground", typeof item.content === "string" && "whitespace-pre-wrap")}>
                {item.content}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
