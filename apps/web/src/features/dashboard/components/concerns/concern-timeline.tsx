import { cn } from "@workspace/ui/lib/utils"

import {
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
    <ol className={cn("relative", className)} aria-label="Case timeline, oldest to newest">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            <div className="relative">
              <span
                aria-hidden
                className="relative z-10 mt-1 block size-2 rounded-full bg-brand-blue"
              />
              {!isLast ? (
                <span className="absolute left-[3px] top-3 h-[calc(100%+1rem)] w-px bg-brand-blue/30" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-foreground">
                {item.badge}
              </p>
              <div className={cn("mt-0.5 text-[12px] leading-5 text-muted-foreground", typeof item.content === "string" && "whitespace-pre-wrap")}>
                {item.content}
              </div>
              <time
                dateTime={item.time ?? undefined}
                className="mt-0.5 block text-[11px] tabular-nums text-subtle-foreground"
              >
                {item.time ? formatTimelineTime(item.time) : "Pending"}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
