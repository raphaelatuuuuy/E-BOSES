import { XIcon } from "lucide-react"

import { RecordDetail } from "./record-detail"
import type { RecordView } from "./types"

/**
 * Desktop container. A pure wrapper — all content comes from `RecordDetail`,
 * the same component the mobile sheet renders.
 */
export function RecordPanel({
  record,
  onClose,
  className = "",
}: {
  record: RecordView | null
  onClose: () => void
  className?: string
}) {
  if (!record) return null

  return (
    <aside
      aria-label={`${record.typeLabel} details`}
      className={`flex min-h-0 flex-col gap-3 ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {record.kind === "concern" ? "Concern details" : "Alert details"}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-control p-1 text-muted-foreground transition hover:bg-tint"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <RecordDetail record={record} />
      </div>
    </aside>
  )
}
