import { useMemo } from "react"
import { Link } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  DonutLegend,
  SegmentedDonut,
  type DonutSlice,
} from "@/features/dashboard/components/charts"
import {
  Panel,
  PanelEmpty,
  PanelFooterLink,
  PanelHeader,
  PeriodChip,
} from "@/features/dashboard/components/staff/panel"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { plainTimeAgo } from "@/features/dashboard/lib/plain-language"
import type { Concern } from "@/features/dashboard/api"

/** How every concern ever filed ended up. */
export function OutcomesCard({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const slices = useMemo<DonutSlice[]>(() => {
    const count = (match: (concern: Concern) => boolean) => concerns.filter(match).length
    return [
      // Segments read from the shared status vocabulary rather than a private
      // set of greys, so a slice and the status badge on the same concern agree
      // — the rule the token file states for severity, applied to status.
      {
        key: "resolved",
        label: "Resolved",
        value: count((c) => c.status === "resolved"),
        color: "var(--color-status-closed)",
      },
      {
        key: "in_progress",
        label: "In progress",
        value: count((c) => c.status === "assigned" || c.status === "in_progress"),
        color: "var(--color-brand-orange)",
      },
      {
        key: "review",
        label: "Under review",
        value: count((c) => c.status === "submitted" || c.status === "under_review"),
        color: "var(--color-status-active)",
      },
      {
        key: "closed",
        label: "Not accepted",
        value: count((c) => c.status === "rejected" || c.status === "appealed"),
        color: "var(--color-subtle-foreground)",
      },
    ]
  }, [concerns])

  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Concern Outcomes">
        <PeriodChip>All time</PeriodChip>
      </PanelHeader>

      {loading ? (
        <div className="h-[220px] animate-pulse rounded-panel bg-card-raised" />
      ) : total === 0 ? (
        <PanelEmpty>No concerns have been filed yet.</PanelEmpty>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-between gap-5">
          <SegmentedDonut slices={slices} centerLabel="Concerns" size={168} />
          <DonutLegend slices={slices} className="w-full" />
        </div>
      )}
    </Panel>
  )
}

/**
 * The most recent concerns, one line each.
 *
 * Modelled on the reference board's transactions card: name on the left, a tag
 * and a figure on the right, then one outlined link closing the card. Density
 * comes from the row height, not from cramming a second line into every row.
 */
export function LatestConcernsCard({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const rows = useMemo(
    () =>
      [...concerns]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 7),
    [concerns],
  )

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Latest Concerns" />

      {loading ? (
        <div className="grid gap-1.5">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-7 rounded-control bg-card-raised" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <PanelEmpty>Nothing has been filed yet.</PanelEmpty>
      ) : (
        <ul className="flex min-w-0 flex-1 flex-col">
          {rows.map((concern) => (
            <li key={concern.id} className="min-w-0">
              <Link
                to={`/dashboard/reports/${concern.id}`}
                className="flex min-w-0 items-center gap-2 rounded-control px-1.5 py-[7px] transition-colors hover:bg-card-raised"
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-muted-foreground">
                  {concern.title}
                </span>
                <span className="hidden shrink-0 text-[10.5px] font-medium text-subtle-foreground sm:block">
                  {concernCategoryLabel(concern)}
                </span>
                <span className="w-14 shrink-0 text-right text-[10.5px] font-bold text-subtle-foreground">
                  {plainTimeAgo(concern.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PanelFooterLink to="/dashboard/reports">View all concerns</PanelFooterLink>
    </Panel>
  )
}
