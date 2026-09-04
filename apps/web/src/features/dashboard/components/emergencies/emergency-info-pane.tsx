import { useMemo, useState } from "react"
import { ClockIcon, MapPinIcon, PlusIcon } from "lucide-react"

import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { IncidentMap } from "./incident-board"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { readableLocation } from "@/features/dashboard/components/emergencies/lib"
import { EmergencyTimelineCard } from "./emergency-timeline-card"
import { buildEmergencyTimeline } from "./emergency-timeline-lib"
import { EmergencyResolutionSheet } from "@/features/dashboard/components/responder/emergency-resolution-sheet"

export function EmergencyInfoPane({
  alert,
  onChanged,
  viewerId = null,
  onRefresh,
}: {
  alert: EmergencyAlert
  onChanged: (alert: EmergencyAlert) => void
  viewerId?: number | null
  onRefresh?: () => Promise<void>
}) {
  const [resolutionOpen, setResolutionOpen] = useState(false)

  const location = readableLocation(
    alert.display_location,
    alert.resolved_location,
    alert.reported_area,
    alert.address,
    alert.barangay
  )
  const street = streetOnly(location)

  const openUpdatesAction = () => setResolutionOpen(true)

  const timeline = useMemo(() => buildEmergencyTimeline(alert), [alert])

  return (
    <div className="scrollbar-hide flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-5 pb-5">
      {/* Timeline follows the exact card rhythm used by ReportUpdatesPane. */}
      <section className="flex min-h-0 flex-col rounded-[24px] bg-white p-4 ring-1 ring-neutral-200">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <ClockIcon className="size-4 text-neutral-500" />
            <h3 className="text-[14px] font-medium text-neutral-800">
              Updates
            </h3>
          </div>
          <button
            type="button"
            onClick={openUpdatesAction}
            title="Update the status"
            aria-label="Update the status"
            className="flex size-8 items-center justify-center rounded-full text-neutral-500 ring-1 ring-neutral-200 transition-colors hover:bg-neutral-50 hover:text-neutral-800"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
        <div className="scrollbar-hide mt-3 max-h-[clamp(10rem,35vh,28rem)] overflow-y-auto overscroll-contain pr-1">
          <EmergencyTimelineCard
            key={alert.id}
            items={timeline}
            collapsibleHistory
            emptyLabel="No timeline events have been recorded for this emergency yet."
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-[24px] bg-white ring-1 ring-neutral-200">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <MapPinIcon className="size-4 shrink-0 text-neutral-500" />
            <h3 className="shrink-0 text-[14px] font-medium text-neutral-800">
              Location
            </h3>
            {street ? (
              <span className="min-w-0 truncate text-[12px] font-normal text-neutral-400">
                {street}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <div className="h-full w-full overflow-hidden rounded-[16px] border border-neutral-100">
            <IncidentMap
              alert={alert}
              viewerId={viewerId}
            />
          </div>
        </div>
      </section>

      <EmergencyResolutionSheet
        alert={alert}
        open={resolutionOpen}
        onClose={() => setResolutionOpen(false)}
        onResolved={(next) => {
          onChanged(next)
          void onRefresh?.()
        }}
      />
    </div>
  )
}
