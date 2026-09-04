import type { ReactNode } from "react"
import {
  ClockIcon,
  CopyIcon,
  MapPinIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern, PublicUser } from "@/features/dashboard/api"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import {
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { streetOnly } from "@/features/dashboard/lib/location-text"

async function copyTrackingId(trackingId: string) {
  try {
    await navigator.clipboard?.writeText(trackingId)
    toast.success("Tracking ID copied")
  } catch {
    toast.error("Tracking ID could not be copied. Select it and copy it manually.")
  }
}

export function ReportUpdatesPane({
  report,
  viewer,
  onOpenProof,
  headerAction,
  className,
}: {
  report: Concern
  viewer?: PublicUser | null
  onOpenProof: (items: MediaPreviewItem[], index: number) => void
  headerAction?: ReactNode
  className?: string
}) {
  const timeline = buildConcernTimelineEntries(report, onOpenProof, viewer)
  const address = streetOnly(report.community_incident?.address || report.address)

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-4 bg-white px-4 pb-4 pt-4", className)}>
      <section className="flex min-h-0 flex-col rounded-[24px] bg-white p-4 ring-1 ring-neutral-300">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClockIcon className="size-4 text-neutral-600" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold text-neutral-900">Updates</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void copyTrackingId(report.tracking_id)}
              title="Copy tracking ID"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2"
            >
              {report.tracking_id}
              <CopyIcon className="size-3" aria-hidden="true" />
              <span className="sr-only">Copy tracking ID</span>
            </button>
            {headerAction}
          </div>
        </div>
        <p className="text-[12px] leading-5 text-neutral-500">Every status change and update on this report.</p>
        <div className="scrollbar-hide mt-3 max-h-[clamp(12rem,42vh,32rem)] overflow-y-auto overscroll-contain pr-1">
          <ConcernTimeline key={report.id} items={timeline} collapsibleHistory />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-white ring-1 ring-neutral-300">
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
          <MapPinIcon className="size-4 shrink-0 text-neutral-600" aria-hidden="true" />
          <h3 className="shrink-0 text-[15px] font-semibold text-neutral-900">Location</h3>
          {address ? (
            <span className="min-w-0 truncate text-[12px] font-medium text-neutral-500">{address}</span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4">
          <ReportLocationMap
            latitude={report.latitude}
            longitude={report.longitude}
            streetAddress={report.community_incident?.address || report.address}
            category={report.category}
            iconKey={report.category_ref?.icon_key}
            heightClassName="h-full min-h-20"
            className="overflow-hidden rounded-[16px] border border-neutral-200"
          />
        </div>
      </section>
    </div>
  )
}
