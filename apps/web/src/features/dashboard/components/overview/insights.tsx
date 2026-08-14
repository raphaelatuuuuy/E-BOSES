import { useMemo } from "react"

import { GroupedBars, type GroupedBarPoint } from "@/features/dashboard/components/charts"
import { Panel, PanelHeader, PeriodChip, SeriesKey } from "@/features/dashboard/components/staff/panel"
import type { Concern } from "@/features/dashboard/api"
import { statusGroupOf } from "@/features/dashboard/lib/status-vocabulary"

const DAYS = 7
const FILED_COLOR = "var(--color-brand-navy)"
const CLOSED_COLOR = "var(--color-subtle-foreground)"

/** Local midnight, so a concern lands on the day it was filed here. */
function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Filed against closed, one pair of bars per day.
 *
 * The single-series version of this chart could only say "we got 6 concerns
 * today", which no official can act on. The pair says whether the barangay is
 * keeping up, which is the actual question.
 *
 * The official summary endpoint returns only plain integers, so the shape is
 * computed from the managed concern list the page already fetches.
 */
export function ConcernTrendCard({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const { data, filed, closed } = useMemo(() => {
    const today = startOfDay(new Date())
    const days = Array.from({ length: DAYS }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (DAYS - 1 - index))
      return date
    })

    const weekday = new Intl.DateTimeFormat("en", { weekday: "short" })
    const longDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

    const points: GroupedBarPoint[] = days.map((date) => ({
      label: weekday.format(date),
      caption: longDate.format(date),
      a: 0,
      b: 0,
    }))

    const indexOf = (value: string | null | undefined) => {
      if (!value) return -1
      const offset = Math.round(
        (startOfDay(new Date(value)).getTime() - days[0].getTime()) / 86_400_000,
      )
      return offset >= 0 && offset < DAYS ? offset : -1
    }

    concerns.forEach((concern) => {
      const opened = indexOf(concern.created_at)
      if (opened >= 0) points[opened].a += 1

      if (statusGroupOf(concern.status) === "closed") {
        const done = indexOf(concern.updated_at)
        if (done >= 0) points[done].b += 1
      }
    })

    return {
      data: points,
      filed: points.reduce((sum, point) => sum + point.a, 0),
      closed: points.reduce((sum, point) => sum + point.b, 0),
    }
  }, [concerns])

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Concerns Received">
        <div className="flex shrink-0 items-center gap-3">
          <SeriesKey
            items={[
              { label: "Filed", color: FILED_COLOR },
              { label: "Closed", color: CLOSED_COLOR },
            ]}
          />
          <PeriodChip>Last 7 days</PeriodChip>
        </div>
      </PanelHeader>

      {loading ? (
        <div className="h-[196px] animate-pulse rounded-panel bg-card-raised" />
      ) : (
        <>
          <div className="mb-5 flex items-baseline gap-2">
            <span className="text-[32px] font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
              {filed}
            </span>
            <span className="text-[12px] font-semibold text-subtle-foreground">
              filed this week, {closed} closed
            </span>
          </div>

          <GroupedBars
            data={data}
            seriesA={{ label: "Filed", color: FILED_COLOR }}
            seriesB={{ label: "Closed", color: CLOSED_COLOR }}
            height={168}
            title="Concerns filed and closed per day over the last 7 days"
          />
        </>
      )}
    </Panel>
  )
}
