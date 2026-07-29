import { useMemo } from "react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { Sparkline } from "@/features/dashboard/components/charts"
import { Panel, PanelEmpty, PanelHeader, PeriodChip } from "@/features/dashboard/components/staff/panel"
import { categoryLabels } from "@/features/dashboard/components/concerns/concern-display"
import { dailyCounts } from "@/features/dashboard/lib/overview-series"
import { NO_UNIT, unitLabel, unitOf } from "@/features/dashboard/lib/units"
import type { Concern, ConcernCategory } from "@/features/dashboard/api"

const COLUMNS = [
  { key: "category", label: "Category", align: "left" },
  { key: "unit", label: "Unit", align: "left" },
  { key: "total", label: "Total", align: "right" },
  { key: "open", label: "Open", align: "right" },
  { key: "trend", label: "Trend", align: "center" },
  { key: "rate", label: "Resolved", align: "right" },
] as const

/**
 * Volume and resolution rate per kind of concern, with the responsible unit.
 *
 * The inline trend column is the reason this is a table and not a bar chart:
 * an official needs the exact counts AND the direction of travel in the same
 * row, and a chart cannot carry both without a tooltip.
 */
export function CategoryTable({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const rows = useMemo(() => {
    const categories = new Map<ConcernCategory, Concern[]>()
    concerns.forEach((concern) => {
      const list = categories.get(concern.category) ?? []
      list.push(concern)
      categories.set(concern.category, list)
    })

    return Array.from(categories.entries())
      .map(([category, list]) => {
        const open = list.filter((c) => c.status !== "resolved" && c.status !== "rejected").length
        const resolved = list.filter((c) => c.status === "resolved").length
        // Only one name is shown when every routed concern in the category
        // agrees; a mix prints the count instead of picking a winner.
        const assigned = new Set(
          list
            .map((concern) => {
              const unit = unitOf(concern)
              return unit ? unitLabel(unit) : null
            })
            .filter((label): label is string => label !== null),
        )
        return {
          category,
          // Named from the category row so a renamed category renames here too.
          label: list[0]?.category_ref?.name ?? categoryLabels[category] ?? category,
          unit:
            assigned.size === 0
              ? null
              : assigned.size === 1
                ? [...assigned][0]
                : `${assigned.size} units`,
          total: list.length,
          open,
          rate: list.length === 0 ? 0 : Math.round((resolved / list.length) * 100),
          trend: dailyCounts(list, 14).map((point) => point.value),
        }
      })
      .sort((a, b) => b.total - a.total)
  }, [concerns])

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Concerns by Category">
        <PeriodChip>Last 14 days</PeriodChip>
      </PanelHeader>

      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-11 rounded-panel bg-card-raised" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <PanelEmpty>No concerns have been filed yet.</PanelEmpty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-card-line">
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    title={
                      column.key === "unit"
                        ? "The barangay unit handling these concerns. Set it on a concern, or configure units in Configuration."
                        : undefined
                    }
                    className={cn(
                      "pb-2 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-subtle-foreground",
                      column.align === "left" && "text-left",
                      column.align === "right" && "text-right",
                      column.align === "center" && "px-3 text-center",
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category} className="border-b border-card-line last:border-0">
                  <td className="py-2.5 pr-3">
                    <span className="text-[12.5px] font-bold text-brand-navy">{row.label}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {row.unit ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-card-raised px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground">
                        {row.unit}
                      </span>
                    ) : (
                      <span
                        className="text-[12px] font-bold text-faint-foreground"
                        title="No unit set. Units are configured in Configuration."
                      >
                        {NO_UNIT}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-[12.5px] font-semibold text-brand-navy tabular-nums">
                    {row.total}
                  </td>
                  <td className="py-2.5 text-right">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums",
                        row.open > 0
                          ? "bg-brand-orange-soft text-brand-orange-strong"
                          : "text-faint-foreground",
                      )}
                    >
                      {row.open}
                    </span>
                  </td>
                  <td className="w-24 px-3 py-2.5">
                    <Sparkline
                      values={row.trend}
                      label={`${row.label}: ${row.total} in the last 14 days`}
                    />
                  </td>
                  <td className="py-2.5 text-right text-[12px] font-bold text-brand-navy tabular-nums">
                    {row.rate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
