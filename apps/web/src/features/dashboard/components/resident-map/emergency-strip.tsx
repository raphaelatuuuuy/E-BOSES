import { AlertTriangleIcon, ChevronLeftIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ResidentMapEmergency } from "@/features/dashboard/api"
import { emergencyBrief, formatDistance } from "@/features/dashboard/lib/resident-map-utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { Fact, FactRow } from "@/components/ui/fact"
import { StateMarker } from "@/components/ui/state-marker"
import { EmergencyCommunityComments } from "@/features/dashboard/components/emergencies/community-comments"

/**
 * Ongoing-SOS UI for the resident alerts map: the floating top banner (shown
 * whenever any emergency is in the current filter), the compact list-preview
 * card, and the expanded detail panel. Grouped into one file since all three
 * are "emergency banner / ongoing-SOS strip" surfaces per the D1.2 brief.
 */

/**
 * Floating banner over the map with the brief of the selected emergency.
 *
 * Only shows while an SOS is actually selected — the old "N ongoing SOSs"
 * count badge was removed per product request; the map already carries the
 * live red pins, so a count on top was noise.
 */
export function EmergencyBanner({
  selectedEmergency,
}: {
  selectedEmergency: ResidentMapEmergency | null
}) {
  if (!selectedEmergency) return null
  const brief = emergencyBrief(selectedEmergency)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center px-3 md:top-4 md:justify-start md:pl-4">
      <div className="pointer-events-auto max-w-sm rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[15px] font-semibold text-neutral-900">{brief.title}</p>
          <StateMarker
            tone={brief.status.live ? "alarm" : "closed"}
            label={brief.status.label}
          />
        </div>
        <p className="mt-1 text-meta leading-snug text-neutral-500">{brief.line}</p>
      </div>
    </div>
  )
}

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
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sos sm:size-10">
            <AlertTriangleIcon className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-row font-semibold text-neutral-900">{brief.title}</p>
            <p className="mt-1 text-meta text-neutral-500">
              {[dist, ago].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2">
              <StateMarker
                tone={brief.status.live ? "alarm" : "closed"}
                label={brief.status.label}
              />
            </div>
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
        {st.live ? <StateMarker tone="alarm" label="Live" className="mr-2" /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sos">
            <AlertTriangleIcon className="size-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-section text-neutral-900">{brief.title}</p>
            <p className="mt-1 text-meta text-neutral-500">
              {[dist, timeAgo(emergency.created_at)].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <p className="mt-5 text-read leading-relaxed text-neutral-800">
          {st.live
            ? "This SOS is active. Help has been dispatched to the area. Stay clear if you are not involved."
            : "This emergency is no longer active."}
        </p>

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
          <Fact label="Reported" value={timeAgo(emergency.created_at) || "—"} />
          <Fact label="Updated" value={timeAgo(emergency.updated_at) || "—"} />
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
