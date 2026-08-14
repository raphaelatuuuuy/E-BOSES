import type { ResponderShift } from "@/features/dashboard/emergency-api"
import {
  formatClock,
  formatDuration,
  formatResponse,
} from "@/features/dashboard/lib/responder-format"

/**
 * Persisted shift sessions, rendered as bare hairline rows — no card of its
 * own. The page places this list inside the "Shift log" pane beneath the
 * today's dispatch log, so past sessions and the live list share one card.
 *
 * Each session is a row: when it ran and how long on one line, what came of
 * it on the next. The counts used to be four tinted chips per row, which
 * turned a five-row list into twenty coloured pills and buried the dates.
 *
 * The unit is not repeated per row — a responder belongs to one unit, so
 * printing it five times said nothing.
 */

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

export function ShiftHistoryList({ shifts }: { shifts: ResponderShift[] }) {
  const recent = shifts.slice(0, 6)

  if (recent.length === 0) {
    return (
      <p className="px-5 py-5 text-body leading-6 text-subtle-foreground">
        No shift has been logged yet. Your first session appears here once you end it.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-card-line">
      {recent.map((shift) => {
        const open = shift.status === "active"
        return (
          <li key={shift.id} className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-heading text-foreground">
                {dayLabel(shift.started_at)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {formatClock(shift.started_at)}
                  {shift.ended_at ? ` to ${formatClock(shift.ended_at)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">
                {open ? "In progress" : formatDuration(shift.duration_seconds)}
              </span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-body tabular-nums text-subtle-foreground">
              <span>{shift.incidents_assigned} assigned</span>
              <span>{shift.incidents_acknowledged} acknowledged</span>
              <span>{shift.incidents_resolved} resolved</span>
              {shift.average_response_seconds ? (
                <span>avg {formatResponse(shift.average_response_seconds)}</span>
              ) : null}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
