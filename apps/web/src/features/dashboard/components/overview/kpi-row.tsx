import { Link } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { Concern, OfficialRoleSummary } from "@/features/dashboard/api"

/**
 * The headline figures, as compact stat cards.
 *
 * Deliberately chart-free and short: the reference board keeps its KPI row to a
 * label and a number, and pushes every visualisation into the row below. Mixing
 * a chart into each card is what turns a KPI strip into three identical widgets.
 *
 * Exactly one card is filled, and it is the emergency count, because that is
 * the only figure on this page that can require someone to leave their desk.
 */

type Tone = "plain" | "tint" | "filled"

function KpiCard({
  label,
  value,
  suffix,
  note,
  to,
  tone,
  loading,
  alarm = false,
  className,
}: {
  label: string
  value: number
  /** Rendered immediately after the number, at a smaller size. */
  suffix?: string
  /** One short line under the number. Omitted when there is nothing to say. */
  note?: string
  to: string
  tone: Tone
  loading: boolean
  /** Filled cards flip to the alert colour when the count is non-zero. */
  alarm?: boolean
  className?: string
}) {
  const filled = tone === "filled"

  return (
    <Link
      to={to}
      className={cn(
        "flex min-w-0 flex-col justify-center gap-1.5 rounded-panel px-5 py-4 transition-colors",
        tone === "plain" && "border border-card-line bg-card hover:border-brand-navy/25",
        tone === "tint" && "bg-tint hover:bg-tint/70",
        filled && (alarm ? "bg-sos hover:bg-sos-bright" : "bg-brand-navy hover:bg-ink-raised"),
        className,
      )}
    >
      <span
        className={cn(
          "truncate text-[12px] font-bold leading-tight",
          filled ? "text-white/70" : "text-subtle-foreground",
        )}
      >
        {label}
      </span>

      {loading ? (
        <Skeleton
          className={cn("h-8 w-20 rounded-control", filled ? "bg-card/15" : "bg-card-raised")}
        />
      ) : (
        <span
          className={cn(
            "flex items-baseline gap-1 text-[30px] font-semibold leading-none tracking-tight tabular-nums",
            filled ? "text-white" : "text-brand-navy",
          )}
        >
          {value}
          {suffix ? <span className="text-[17px] font-bold">{suffix}</span> : null}
        </span>
      )}

      {note ? (
        <span
          className={cn(
            "truncate text-[10.5px] font-semibold leading-tight",
            filled ? "text-white/60" : "text-subtle-foreground",
          )}
        >
          {note}
        </span>
      ) : null}
    </Link>
  )
}

export function KpiRow({
  summary,
  concerns,
  loading,
  weekDelta,
}: {
  summary: OfficialRoleSummary | null
  concerns: readonly Concern[]
  loading: boolean
  /** Concerns filed this week minus last week. */
  weekDelta: number
}) {
  const resolved = concerns.filter((concern) => concern.status === "resolved").length
  const resolutionRate =
    concerns.length === 0 ? 0 : Math.round((resolved / concerns.length) * 100)
  const live = summary?.active_emergencies ?? 0
  const responders = summary?.responders_on_duty ?? 0

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        label="Concerns Awaiting Review"
        value={summary?.pending_reviews ?? 0}
        note={
          weekDelta === 0
            ? "No change from last week"
            : `${weekDelta > 0 ? "Up" : "Down"} ${Math.abs(weekDelta)} from last week`
        }
        to="/dashboard/reports"
        tone="plain"
        loading={loading}
        className="sm:col-span-2 xl:col-span-1"
      />
      <KpiCard
        label="Resolution Rate"
        value={resolutionRate}
        suffix="%"
        note={`${resolved} of ${concerns.length} concerns closed with a fix`}
        to="/dashboard/reports"
        tone="tint"
        loading={loading}
      />
      <KpiCard
        label="Active Emergencies"
        value={live}
        note={
          live > 0
            ? "Open the board and check responders"
            : `${responders} ${responders === 1 ? "responder" : "responders"} on duty`
        }
        to="/dashboard/emergencies"
        tone="filled"
        alarm={live > 0}
        loading={loading}
      />
    </div>
  )
}
