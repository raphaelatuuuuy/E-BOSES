import { AlertTriangleIcon, ChevronLeftIcon, CircleCheck } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ResidentMapEmergency } from "@/features/dashboard/api"
import { emergencyBrief, formatDistance } from "@/features/dashboard/lib/resident-map-utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { EmergencyCommunityComments } from "@/features/dashboard/components/emergencies/community-comments"

/**
 * Ongoing-SOS UI for the resident alerts map: the compact list-preview card
 * and the expanded detail panel.
 */

/** Emergency list card */
export function EmergencyPreviewCard({
  emergency,
  distance,
  expanded,
  onOpen,
  onWrite,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  expanded: boolean
  onOpen: () => void
  onWrite?: () => void
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const ago = timeAgo(emergency.created_at)
  const live = brief.status.live

  return (
    <div
      className={cn(
        "rounded-2xl border-l-4 border bg-white transition-colors",
        expanded
          ? live
            ? "border-l-sos border-neutral-300 bg-neutral-50 shadow-sm"
            : "border-l-neutral-300 border-neutral-300 bg-neutral-50 shadow-sm"
          : live
            ? "border-l-sos border-neutral-200"
            : "border-l-neutral-300 border-neutral-200",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10",
            live ? "bg-severity-critical-surface text-sos" : "bg-neutral-100 text-neutral-400",
          )}>
            <AlertTriangleIcon className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-[13px] font-bold leading-snug text-neutral-900 sm:text-[14px]">
                {live ? `Ongoing ${brief.title.toLowerCase()} around ${brief.street}` : brief.title}
              </p>
              {!live && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-status-closed sm:text-[12px]">
                  <CircleCheck className="size-3.5 shrink-0" strokeWidth={2.4} />
                  Resolved
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-neutral-500 sm:text-[12px]">
              {[brief.street, dist, ago].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
              {brief.safetyNote}
            </p>
          </div>
        </div>
      </button>

      {onWrite ? (
        <div className="border-t border-neutral-100 px-3 py-2 sm:px-3.5 sm:py-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onWrite()
            }}
            className="flex h-9 w-full items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 sm:text-[13px]"
          >
            Write about this alert
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Expanded emergency detail in the list panel */
export function EmergencyDetailPanel({
  emergency,
  distance,
  onBack,
  focusComment,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  onBack: () => void
  focusComment?: boolean
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const st = brief.status

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
          aria-label="Back to list"
        >
          <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
        </button>
        <p className="min-w-0 flex-1 truncate text-left text-[15px] font-bold text-neutral-900">
          Emergency
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="flex items-start gap-3">
          <span className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            st.live ? "bg-severity-critical-surface text-sos" : "bg-neutral-100 text-neutral-400",
          )}>
            <AlertTriangleIcon className="size-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug text-neutral-900">
                {st.live ? `Ongoing ${brief.title.toLowerCase()} around ${brief.street}` : brief.title}
              </p>
              {!st.live && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-status-closed sm:text-[12px]">
                  <CircleCheck className="size-3.5 shrink-0" strokeWidth={2.4} />
                  Resolved
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] text-neutral-500">
              {[brief.street, dist, timeAgo(emergency.created_at)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
              {brief.safetyNote}
            </p>
          </div>
        </div>

        <section className="mt-6 border-t border-neutral-200 pt-5">
          <h3 className="text-[15px] font-bold text-neutral-900">
            Community updates
          </h3>
          <div className="mt-4">
            <EmergencyCommunityComments
              alertId={emergency.id}
              acceptsComments={st.live}
              autoFocusComposer={focusComment}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
