import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  FilterChips,
  Panel,
  PanelEmpty,
  PanelFooterLink,
  PanelHeader,
} from "@/features/dashboard/components/staff/panel"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { concernNeedsReview } from "@/features/dashboard/lib/concern-signals"
import { unitLabel, unitOf } from "@/features/dashboard/lib/units"
import { plainTimeAgo } from "@/features/dashboard/lib/plain-language"
import type { Concern } from "@/features/dashboard/api"

const ROW_LIMIT = 6

type QueueFilter = "all" | "review" | "progress" | "backed"

/** Status word shown at the right of a row, with the tone it prints in. */
function rowStatus(concern: Concern): { label: string; tone: "alarm" | "active" | "quiet" } {
  if (concernNeedsReview(concern)) return { label: "Needs review", tone: "alarm" }
  if (concern.status === "in_progress" || concern.status === "assigned") {
    return { label: "In progress", tone: "active" }
  }
  if (concern.status === "resolved") return { label: "Resolved", tone: "quiet" }
  if (concern.status === "rejected") return { label: "Not accepted", tone: "quiet" }
  if (concern.status === "appealed") return { label: "Appealed", tone: "active" }
  return { label: "Waiting", tone: "quiet" }
}

/**
 * The working queue: what an official should open next, and why.
 *
 * The filter chips exist because the two things a barangay official does with
 * this list are different jobs. "Needs review" is a validation pass on
 * suspicious submissions; "Most backed" is a prioritisation pass on legitimate
 * ones. Showing both stacked in one scroll made the card the tallest thing on
 * the page and buried the second job.
 */
export function ActionQueue({
  concerns,
  loading,
}: {
  concerns: readonly Concern[]
  loading: boolean
}) {
  const [filter, setFilter] = useState<QueueFilter>("all")

  const groups = useMemo(() => {
    const open = concerns.filter(
      (concern) => concern.status !== "resolved" && concern.status !== "rejected",
    )
    const review = open.filter(concernNeedsReview)
    const progress = open.filter(
      (concern) => concern.status === "in_progress" || concern.status === "assigned",
    )
    // `priority_score` is severity-banded server-side (concerns/severity.py):
    // the band dominates, and waiting time and community support only reorder
    // within it. Sorting on it therefore ranks by urgency, not popularity.
    const backed = [...open]
      .filter((concern) => !concernNeedsReview(concern))
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))

    // "All" leads with anything flagged, then falls back to the most backed, so
    // the default view never hides a suspicious submission behind a popular one.
    const all = [...review, ...backed.filter((concern) => !review.includes(concern))]
    return { all, review, progress, backed }
  }, [concerns])

  const rows = groups[filter].slice(0, ROW_LIMIT)

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Concerns Requiring Action" />

      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All", count: groups.all.length },
          { value: "review", label: "Needs review", count: groups.review.length },
          { value: "progress", label: "In progress", count: groups.progress.length },
          { value: "backed", label: "Highest priority", count: groups.backed.length },
        ]}
      />

      <div className="mt-3 min-w-0 flex-1">
        {loading ? (
          <div className="grid gap-1.5">
            {Array.from({ length: ROW_LIMIT }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-control bg-card-raised" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <PanelEmpty>
            {filter === "all"
              ? "Nothing is waiting for you right now."
              : "Nothing in this group right now."}
          </PanelEmpty>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {rows.map((concern) => {
              const status = rowStatus(concern)
              const unit = unitOf(concern)
              return (
                <li key={concern.id} className="min-w-0">
                  <Link
                    to={`/dashboard/reports/${concern.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-control px-1.5 py-2 transition-colors hover:bg-card-raised"
                  >
                    {/* Two truncating columns in one row: each needs its own
                        min-w-0, or the longer one pushes the row past the card. */}
                    <span className="min-w-0 flex-[1.4] truncate text-[11.5px] font-semibold text-muted-foreground">
                      {concern.title}
                    </span>

                    <span className="hidden min-w-0 flex-1 truncate text-[11px] font-medium text-subtle-foreground sm:block">
                      {unit ? unitLabel(unit) : concernCategoryLabel(concern)}
                    </span>

                    <span className="hidden w-16 shrink-0 text-right text-[10.5px] font-semibold text-subtle-foreground md:block">
                      {plainTimeAgo(concern.created_at)}
                    </span>

                    <span
                      className={cn(
                        "w-[92px] shrink-0 truncate rounded-full px-2 py-1 text-center text-[9.5px] font-semibold uppercase tracking-[0.05em]",
                        status.tone === "alarm" && "bg-brand-orange-soft text-brand-orange-strong",
                        status.tone === "active" && "bg-tint text-brand-navy",
                        status.tone === "quiet" && "bg-card-raised text-subtle-foreground",
                      )}
                    >
                      {status.label}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <PanelFooterLink to="/dashboard/reports">Open the concerns workspace</PanelFooterLink>
    </Panel>
  )
}
