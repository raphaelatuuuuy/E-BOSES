import { useMemo } from "react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { HeatmapGrid, HeatmapLegend, type HeatmapRow } from "@/features/dashboard/components/charts"
import { Panel, PanelHeader } from "@/features/dashboard/components/staff/panel"
import { unitLabel, unitOf } from "@/features/dashboard/lib/units"
import type { Concern } from "@/features/dashboard/api"

const DAYS = 7

/** Local midnight, so a concern lands on the day it was filed here. */
function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Which unit is absorbing the week's work, and on which days.
 *
 * Only units that actually own a concern get a row. Printing all twenty
 * standing units with empty rows would suggest twenty active workstreams; a
 * barangay with two paid staff runs a handful at a time, and the point of the
 * grid is to show whether one of them is drowning.
 */
export function UnitLoadCard({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const { rows, columns, busiest, routed } = useMemo(() => {
    const today = startOfDay(new Date())
    const days = Array.from({ length: DAYS }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (DAYS - 1 - index))
      return date
    })
    const labels = days.map((date) =>
      new Intl.DateTimeFormat("en", { weekday: "short" }).format(date),
    )

    // Rows come from the concerns themselves, not from the full roster: a
    // barangay runs twenty standing units but only a handful take work in any
    // given week, and twenty empty rows would imply twenty active workstreams.
    const tallies = new Map<string, { label: string; sort: number; values: number[] }>()
    let assignedCount = 0

    concerns.forEach((concern) => {
      const unit = unitOf(concern)
      if (!unit) return
      assignedCount += 1
      const filed = startOfDay(new Date(concern.created_at))
      const offset = Math.round((filed.getTime() - days[0].getTime()) / 86_400_000)
      if (offset < 0 || offset >= DAYS) return
      const row =
        tallies.get(unit.code) ?? {
          label: unitLabel(unit),
          sort: unit.sort_order,
          values: Array.from({ length: DAYS }, () => 0),
        }
      row.values[offset] += 1
      tallies.set(unit.code, row)
    })

    const built: HeatmapRow[] = [...tallies.entries()]
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([code, row]) => ({ key: code, label: row.label, values: row.values }))

    let top: { label: string; count: number } | null = null
    built.forEach((row) => {
      const count = row.values.reduce((sum, value) => sum + value, 0)
      if (count > 0 && (!top || count > top.count)) top = { label: row.label, count }
    })

    return {
      rows: built,
      columns: labels,
      routed: assignedCount,
      busiest: top as { label: string; count: number } | null,
    }
  }, [concerns])

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Unit Workload">
        {rows.length ? <HeatmapLegend className="hidden shrink-0 sm:flex" /> : null}
      </PanelHeader>

      {loading ? (
        <div className="grid gap-1.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-7 rounded-[7px] bg-card-raised" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        // Say plainly what is missing. There is no "set up units" screen
        // yet, so this offers no button: a control that goes nowhere is worse
        // than an empty state that is honest about the gap.
        <div className="flex flex-1 flex-col items-start justify-center gap-2 py-10">
          <p className="text-[13px] font-bold text-brand-navy">No concerns are routed yet</p>
          <p className="max-w-sm text-[12px] font-medium leading-snug text-subtle-foreground">
            {routed === 0
              ? "Once concerns are assigned to a barangay unit, this grid shows which unit carried the week."
              : "Every routed concern is older than seven days."}
          </p>
        </div>
      ) : (
        <>
          <HeatmapGrid rows={rows} columns={columns} unit="concern" />
          {busiest ? (
            <p className="mt-4 text-[11.5px] font-medium leading-snug text-subtle-foreground">
              Heaviest this week: <span className="font-bold text-brand-navy">{busiest.label}</span>,
              with {busiest.count} {busiest.count === 1 ? "concern" : "concerns"}.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}
