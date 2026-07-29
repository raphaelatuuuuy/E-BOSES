import { ClockIcon, MapPinIcon, UserCheckIcon } from "lucide-react"

import {
  formatElapsed,
  type TriagedAlert,
} from "@/features/dashboard/components/record/emergency-adapter"
import { toStatusView } from "@/features/dashboard/components/record/status"

const TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
  disaster: "Disaster",
  child_protection: "Child Protection",
  domestic_violence: "Domestic Violence",
  drug_related: "Drug-Related Incident",
}

const STATUS_BADGE = {
  open: "bg-status-open-surface text-status-open-ink",
  active: "bg-status-active-surface text-status-active-ink",
  closed: "bg-status-closed-surface text-status-closed-ink",
} as const


export function QueueItem({
  entry,
  active,
  now,
  onSelect,
}: {
  entry: TriagedAlert
  active: boolean
  now: number
  onSelect: () => void
}) {
  const { alert } = entry
  const status = toStatusView(alert.status)
  const assignment = alert.current_assignment

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={`relative w-full overflow-hidden rounded-panel border p-3 text-left transition-colors duration-[--duration-micro] ${
        active
          ? "border-card-line-strong bg-card-raised"
          : "border-card-line bg-card hover:bg-card-raised"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-pill bg-card-raised px-2 py-0.5 text-micro uppercase text-muted-foreground">
          {TYPE_LABEL[alert.type] ?? alert.type}
        </span>
        <span
          className={`ml-auto rounded-pill px-2 py-0.5 text-micro uppercase ${STATUS_BADGE[status.group]}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-label text-foreground">
        <MapPinIcon className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
        <span className="truncate">{alert.address || alert.barangay}</span>
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-subtle-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums normal-case tracking-normal text-ice">
          <ClockIcon className="size-3" aria-hidden />
          {formatElapsed(alert.created_at, now)}
        </span>
        {assignment ? (
          <span className="inline-flex min-w-0 items-center gap-1 normal-case tracking-normal">
            <UserCheckIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{assignment.responder.full_name}</span>
          </span>
        ) : (
          <span className="uppercase text-severity-critical">Unassigned</span>
        )}
      </div>
    </button>
  )
}
