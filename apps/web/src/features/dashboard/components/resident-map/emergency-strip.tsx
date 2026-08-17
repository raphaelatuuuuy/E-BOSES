import { AlertTriangleIcon, ChevronLeftIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ResidentMapEmergency } from "@/features/dashboard/api"
import { emergencyBrief, formatDistance } from "@/features/dashboard/lib/resident-map-utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { Fact, FactRow } from "@/components/ui/fact"
import { StateGlyph, StateMarker } from "@/components/ui/state-marker"
import { EmergencyCommunityComments } from "@/features/dashboard/components/emergencies/community-comments"

/**
 * Ongoing-SOS UI for the resident alerts map: the compact list-preview card
 * and the expanded detail panel. Grouped into one file since both are
 * "emergency / ongoing-SOS strip" surfaces per the D1.2 brief.
 */

/** Emergency list card — type, LIVE badge, pipeline status, place, note */
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

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded ? "border-neutral-300 bg-neutral-50 shadow-sm" : "border-neutral-200",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-severity-critical-surface text-sos sm:size-10">
            <AlertTriangleIcon className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-[13px] font-bold text-neutral-900 sm:text-[14px]">{brief.title}</p>
            <p className="mt-0.5 flex items-center gap-x-1.5 text-[11px] text-neutral-500 sm:text-[12px]">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 font-semibold",
                  brief.status.live ? "text-sos" : "text-neutral-400",
                )}
              >
                <StateGlyph tone={brief.status.live ? "alarm" : "closed"} />
                {brief.status.label}
              </span>
              <span aria-hidden>·</span>
              <span>{[dist, ago].filter(Boolean).join(" · ")}</span>
            </p>
          </div>
        </div>
      </button>

      {onWrite && brief.status.live ? (
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
        <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
          Emergency
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-severity-critical-surface text-sos">
            <AlertTriangleIcon className="size-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-section text-neutral-900">{brief.title}</p>
            <p className="mt-1 text-meta text-neutral-500">
              {[dist, timeAgo(emergency.created_at)].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <FactRow className="mt-6">
          <Fact label="Status" value={<StateMarker tone={st.live ? "alarm" : "closed"} label={st.label} />} />
          <Fact
            label="Type"
            value={
              <span className="capitalize">
                {(emergency.type_label || emergency.type || "—").replace(/_/g, " ")}
              </span>
            }
          />
        </FactRow>

        {/* Residents can say what they can see here, the same way they comment
            on a concern or an announcement. */}
        <section className="mt-8 border-t border-neutral-200 pt-5">
          <h3 className="text-section text-neutral-900">Community updates</h3>
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
