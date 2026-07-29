import { ArrowUpIcon, MapPinIcon, UsersIcon } from "lucide-react"

import { SEVERITY_LABEL } from "@/features/dashboard/components/record/severity"
import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"
import { toStatusView } from "@/features/dashboard/components/record/status"

const STATUS_BADGE = {
  open: "bg-status-open-surface text-status-open-ink",
  active: "bg-status-active-surface text-status-active-ink",
  closed: "bg-status-closed-surface text-status-closed-ink",
} as const

export function ConcernQueueItem({
  entry,
  active,
  onSelect,
}: {
  entry: RankedConcern
  active: boolean
  onSelect: () => void
}) {
  const { concern, severity, assessed } = entry
  const status = toStatusView(concern.status)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={`relative w-full overflow-hidden rounded-2xl border bg-card p-3 text-left transition ${
        active ? "border-brand-orange" : "border-card-line hover:border-brand-orange/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-severity-critical-surface px-2 py-0.5 text-[10px] font-bold text-severity-critical-ink">
          {SEVERITY_LABEL[severity]}
          {!assessed ? " · pending" : ""}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[status.group]}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-foreground">
        {concern.title}
      </p>

      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{concern.address || concern.barangay}</span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
        <span
          className={
            concern.assigned_department
              ? "truncate text-brand-navy"
              : "font-bold text-status-open-ink"
          }
        >
          {concern.assigned_department?.short_name ||
            concern.assigned_department?.name ||
            "No unit assigned"}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <ArrowUpIcon className="size-3" aria-hidden />
          {concern.vote_count}
        </span>
        {concern.comment_count > 0 ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <UsersIcon className="size-3" aria-hidden />
            {concern.comment_count}
          </span>
        ) : null}
      </div>
    </button>
  )
}
