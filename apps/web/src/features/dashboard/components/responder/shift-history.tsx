import type { ResponderShift } from "@/features/dashboard/emergency-api"
import {
  formatClock,
  formatDuration,
  formatResponse,
} from "@/features/dashboard/lib/responder-format"

/**
 * Persisted shift sessions.
 *
 * Each session is a row: when it ran and how long on one line, what came of it
 * on the next. The counts used to be four tinted chips per row, which turned a
 * five-row list into twenty coloured pills and buried the dates.
 *
 * The unit is not repeated per row — a responder belongs to one unit, so
 * printing it five times said nothing.
 */
function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

export function ShiftHistory({ shifts }: { shifts: ResponderShift[] }) {
  const recent = shifts.slice(0, 6)

  return (
    <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
        <div>
          <h2 className="text-micro uppercase tracking-wide text-nav-muted">Shift history</h2>
          <p className="mt-1 text-xs leading-5 text-subtle-foreground">
            Sessions logged with GPS at start and end.
          </p>
        </div>
        {recent.length > 0 ? (
          <span className="shrink-0 text-sm font-bold tabular-nums text-nav-text-active">
            {shifts.length}
          </span>
        ) : null}
      </div>

      {recent.length === 0 ? (
        <p className="px-4 pb-4 text-xs leading-5 text-subtle-foreground">
          No shift has been logged yet. Your first session appears here once you end it.
        </p>
      ) : (
        <div className="divide-y divide-card-line border-t border-card-line">
          {recent.map((shift) => {
            const open = shift.status === "active"
            return (
              <div key={shift.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-bold text-foreground">
                    {dayLabel(shift.started_at)}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatClock(shift.started_at)}
                      {shift.ended_at ? ` to ${formatClock(shift.ended_at)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-nav-text-active">
                    {open ? "In progress" : formatDuration(shift.duration_seconds)}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-subtle-foreground">
                  <span>{shift.incidents_assigned} assigned</span>
                  <span>{shift.incidents_acknowledged} acknowledged</span>
                  <span>{shift.incidents_resolved} resolved</span>
                  {shift.average_response_seconds ? (
                    <span>avg {formatResponse(shift.average_response_seconds)}</span>
                  ) : null}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
