import { useMemo } from "react"
import type { LucideIcon } from "lucide-react"
import { CalendarRangeIcon, GaugeIcon } from "lucide-react"

import { ActivityGrid, Sparkline } from "@/features/dashboard/components/charts"
import type { ResponderShift } from "@/features/dashboard/emergency-api"
import { Pane } from "@/features/dashboard/components/responder/dispatch-surface"
import { formatResponse } from "@/features/dashboard/lib/responder-format"

/**
 * The two graphics on the Shift screen.
 *
 * Both are single-series on purpose. The dark chart ramp separates by hue
 * rather than lightness, so its weak spot is telling adjacent *categorical*
 * series apart — a weakness a single series cannot hit. It also suits the data:
 * a barangay responder handles few incidents, and a four-slice donut where
 * three slices are zero says less than the number would.
 *
 * Neither invents data. Below two completed shifts the trend prints the figure
 * with no plot, because a two-point line implies a shape that is not there.
 */

/** Unique two-letter weekday keys — "T" and "S" alone would collide. */
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const
const WEEK_ROWS = ["Last", "This"] as const

/**
 * Chart frame, on the console's shared `Pane`. The figure rides in the pane
 * header's action slot so both graphics agree with every other card on the
 * screen about corner radius, header height and title size.
 */
function Frame({
  label,
  icon,
  hint,
  figure,
  children,
}: {
  label: string
  icon: LucideIcon
  hint: string
  figure?: string
  children: React.ReactNode
}) {
  return (
    <Pane
      title={label}
      icon={icon}
      className="min-h-0"
      action={
        figure ? (
          <span className="shrink-0 pr-2 text-[13px] font-bold tabular-nums text-foreground">
            {figure}
          </span>
        ) : null
      }
    >
      <p className="text-body leading-6 text-subtle-foreground">{hint}</p>
      <div className="mt-4">{children}</div>
    </Pane>
  )
}

/**
 * Days served, one square per day, opacity by incidents handled.
 *
 * Laid out as two weeks by weekday rather than fourteen columns in a line: a
 * 7-column grid fits a 360px phone without shrinking the squares, and it gives
 * both axes a real label, which is what makes the cell descriptions read as
 * "This Tuesday: 2" instead of a bare number.
 */
export function DutyRhythm({ shifts }: { shifts: ResponderShift[] }) {
  const { cells, served } = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const shift of shifts) {
      const key = new Date(shift.started_at).toDateString()
      byDay.set(key, (byDay.get(key) ?? 0) + shift.incidents_assigned)
    }

    // Two consecutive 7-day windows ending today, so each window holds exactly
    // one of every weekday and no two cells collide.
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (13 - index))
      return date
    })

    return {
      cells: days.map((date, index) => ({
        row: index < 7 ? WEEK_ROWS[0] : WEEK_ROWS[1],
        column: WEEKDAYS[date.getDay()] ?? "Su",
        value: byDay.get(date.toDateString()) ?? 0,
      })),
      served: days.filter((date) => byDay.has(date.toDateString())).length,
    }
  }, [shifts])

  return (
    <Frame
      label="Duty rhythm"
      icon={CalendarRangeIcon}
      hint="Days you served over the last two weeks. A darker square means more incidents handled."
      figure={`${served} of 14 days`}
    >
      <ActivityGrid
        rows={WEEK_ROWS}
        columns={WEEKDAYS}
        cells={cells}
        legendLabel="One square is one day"
      />
    </Frame>
  )
}

/** Average response time across recent completed shifts. */
export function ResponseTrend({ shifts }: { shifts: ResponderShift[] }) {
  const values = useMemo(
    () =>
      shifts
        .filter((shift) => shift.status === "ended" && (shift.average_response_seconds ?? 0) > 0)
        .slice(0, 10)
        .reverse()
        .map((shift) => shift.average_response_seconds as number),
    [shifts],
  )

  const latest = values[values.length - 1] ?? null

  return (
    <Frame
      label="Response time"
      icon={GaugeIcon}
      hint="Average time from dispatch to your acknowledgement, across recent shifts."
      figure={formatResponse(latest)}
    >
      {values.length < 2 ? (
        <p className="text-body leading-6 text-subtle-foreground">
          {values.length === 0
            ? "No completed shift has recorded a response time yet."
            : "One shift recorded so far. The trend appears from the second."}
        </p>
      ) : (
        <Sparkline
          values={values}
          color="var(--color-ice)"
          label={`Average response time across the last ${values.length} shifts, latest ${formatResponse(latest)}`}
          className="h-12"
        />
      )}
    </Frame>
  )
}
