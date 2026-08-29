import { useMemo, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyTimelineEntry } from "@/features/dashboard/emergency-api"
import {
  dayKey,
  formatEventDay,
  formatEventMoment,
} from "@/features/dashboard/lib/emergency-timeline-format"

type Order = "oldest" | "newest"

export function EmergencyTimeline({
  entries,
  showControls = false,
  showNotes = false,
  className,
}: {
  entries: readonly EmergencyTimelineEntry[]
  showControls?: boolean
  showNotes?: boolean
  className?: string
}) {
  const [order, setOrder] = useState<Order>("oldest")

  const ordered = useMemo(() => {
    const list = [...entries]
    return order === "oldest" ? list : list.reverse()
  }, [entries, order])

  const spansDays = useMemo(
    () => new Set(entries.map((entry) => dayKey(entry.at))).size > 1,
    [entries],
  )

  if (entries.length === 0) {
    return (
      <div className="rounded-[16px] bg-neutral-50 p-4 text-center">
        <p className="text-[11px] font-normal text-neutral-400">
          No timeline events have been recorded for this emergency yet.
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      {showControls ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setOrder((value) => (value === "oldest" ? "newest" : "oldest"))}
            className="text-micro font-semibold text-brand-orange transition-colors hover:text-brand-orange-strong"
          >
            {order === "oldest" ? "Newest first" : "Oldest first"}
          </button>
        </div>
      ) : null}

      <ol className="space-y-4">
        {ordered.map((entry, index) => {
          const day = dayKey(entry.at)
          const previousDay = index > 0 ? dayKey(ordered[index - 1].at) : ""
          const showSeparator = spansDays && day !== previousDay

          return (
            <li key={entry.key}>
              {showSeparator ? (
                <p className="mb-2 text-micro font-semibold text-subtle-foreground">
                  {formatEventDay(entry.at)}
                </p>
              ) : null}
              <div className="border-l-2 border-card-line pl-3">
                <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                  {entry.description}
                </p>
                {showNotes && entry.note ? (
                  <p className="mt-1 text-[12px] leading-5 text-subtle-foreground">{entry.note}</p>
                ) : null}
                <p className="mt-1 text-[12px] text-subtle-foreground">
                  {formatEventMoment(entry.at)}
                  {entry.actor_label ? (
                    <span className="text-faint-foreground"> · {entry.actor_label}</span>
                  ) : null}
                </p>
                {entry.elapsed_label ? (
                  <p className={cn("mt-1 text-[11px] font-semibold text-subtle-foreground")}>
                    {entry.elapsed_label}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
