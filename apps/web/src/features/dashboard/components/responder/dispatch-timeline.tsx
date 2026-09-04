import { useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  BellRingIcon,
  CircleCheckIcon,
  CheckIcon,
  MapPinIcon,
  NavigationIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type {
  EmergencyAlert,
  EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import {
  buildDispatchTimeline,
  type TimelineEntry,
} from "@/features/dashboard/lib/dispatch-timeline"
import { Empty } from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * The dispatch rail — what is still to come above, where the responder is now
 * in the middle, what already happened below, newest first.
 *
 * Replaces the forward 4-step stepper, which claimed progress without ever
 * showing when anything occurred inside the shared light operations shell.
 *
 * The rail is one colour throughout, as in the reference: the distinction
 * between future and past is carried by line style (solid above, dotted below)
 * and by the presence of a timestamp, never by colour alone.
 */

const STATUS_ICONS: Partial<Record<EmergencyStatus, LucideIcon>> = {
  submitted: TriangleAlertIcon,
  routing: BellRingIcon,
  routed: BellRingIcon,
  awaiting_acknowledgment: BellRingIcon,
  acknowledged: CheckIcon,
  en_route: NavigationIcon,
  nearby: NavigationIcon,
  arrived: MapPinIcon,
  in_progress: MapPinIcon,
  resolved: CircleCheckIcon,
  closed: CircleCheckIcon,
  cancelled: XIcon,
  false_alarm: XIcon,
  invalid: XIcon,
}

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})
const timeFormat = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
})

/**
 * How many past milestones show before the rail asks to be expanded.
 *
 * Counted from the responder's current position rather than from the top of
 * the list: a freshly routed dispatch has four rungs still ahead of it, so a
 * flat row cap would spend the whole collapsed rail on steps that have not
 * happened and hide the ones that have. The ladder ahead is always shown in
 * full — it is the roadmap — and history is what gets trimmed.
 */
const COLLAPSED_HISTORY = 3

/**
 * The current step wears the filled rounded-square chip from the reference —
 * a faint ice-blue tint that complements the card behind it, holding the
 * same ice-blue icon the line and dots use. No orange, no warning: the
 * current rung is marked by shape and by being the only filled chip.
 */
function Marker({ entry }: { entry: TimelineEntry }) {
  if (entry.state === "current") {
    const Icon = STATUS_ICONS[entry.status] ?? NavigationIcon
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-ice/10 text-ice">
        <Icon className="size-5" strokeWidth={2.5} />
      </span>
    )
  }
  return (
    <span className="flex h-10 shrink-0 items-center">
      <span
        className={cn(
          "size-2 rounded-pill",
          entry.state === "upcoming" ? "bg-ice-dim" : "bg-ice"
        )}
      />
    </span>
  )
}

function Connector({ dotted }: { dotted: boolean }) {
  return (
    <span
      aria-hidden
      className="w-0.5 flex-1 rounded-pill"
      style={
        dotted
          ? {
              backgroundImage:
                "linear-gradient(to bottom, var(--color-ice) 55%, transparent 55%)",
              backgroundSize: "2px 7px",
            }
          : { backgroundColor: "var(--color-ice)" }
      }
    />
  )
}

export function DispatchTimeline({
  alert,
  viewerId,
  className,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const entries = useMemo(
    () => buildDispatchTimeline(alert, viewerId),
    [alert, viewerId]
  )

  if (entries.length === 0) {
    return <Empty>No dispatch activity has been recorded yet.</Empty>
  }

  const currentIndex = entries.findIndex((entry) => entry.state === "current")
  const collapsedCount =
    currentIndex >= 0 ? currentIndex + 1 + COLLAPSED_HISTORY : entries.length
  const hiddenCount = Math.max(0, entries.length - collapsedCount)
  const visible =
    expanded || hiddenCount === 0 ? entries : entries.slice(0, collapsedCount)

  return (
    <div className={cn("min-w-0", className)}>
      <ol aria-label="Dispatch progress">
        {visible.map((entry, index) => {
          const isLast = index === visible.length - 1
          // Solid while the rail is still above the responder's current
          // position; dotted once it drops into history.
          const dotted = currentIndex >= 0 && index >= currentIndex
          return (
            <li key={entry.key} className="flex min-w-0 gap-4">
              <div className="flex w-10 shrink-0 flex-col items-center">
                <Marker entry={entry} />
                {!isLast ? <Connector dotted={dotted} /> : null}
              </div>

              {/* pt-2.5 centres the first line against the 40px marker, so
                  every row's label sits on its own dot. */}
              <div
                className={cn(
                  "min-w-0 flex-1 pt-2.5",
                  isLast ? "pb-0" : "pb-4"
                )}
              >
                <p
                  className={cn(
                    "text-heading",
                    entry.state === "upcoming"
                      ? "text-muted-foreground"
                      : "text-foreground"
                  )}
                >
                  {entry.label}
                </p>
                {entry.at ? (
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-body text-subtle-foreground">
                    <time dateTime={entry.at} className="tabular-nums">
                      {dateFormat.format(new Date(entry.at))}
                    </time>
                    <span className="tabular-nums">
                      {timeFormat.format(new Date(entry.at)).toLowerCase()}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-body text-muted-foreground">
                    Not yet reached
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-1 -ml-3 flex h-11 items-center rounded-pill px-3 text-label text-ice transition-colors duration-[--duration-micro] hover:bg-card-raised"
        >
          {expanded
            ? "Show less"
            : `Show ${hiddenCount} earlier step${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  )
}
