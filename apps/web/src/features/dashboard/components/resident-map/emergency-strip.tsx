import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  CircleCheckIcon,
  SignalIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ResidentMapEmergency } from "@/features/dashboard/api"
import {
  emergencyBrief,
  formatDistance,
} from "@/features/dashboard/lib/resident-map-utils"
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
  showPriority = false,
  actionLabel = "View the concern",
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  expanded: boolean
  onOpen: () => void
  onWrite?: () => void
  showPriority?: boolean
  actionLabel?: string
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const ago = timeAgo(emergency.created_at)
  const live = brief.status.live
  const settled = !live
  const displayNote =
    emergency.display_description ||
    emergency.ai_summary ||
    emergency.note ||
    brief.safetyNote
  const displayNoteLabel =
    emergency.display_description || emergency.ai_summary
      ? ""
      : emergency.note
        ? "Resident report"
        : ""
  const showCriticalPriority = showPriority && live

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded
          ? live
            ? "border-neutral-300 bg-neutral-50 shadow-sm"
            : "border-neutral-300 bg-neutral-50 shadow-sm"
          : live
            ? "border-neutral-200"
            : "border-neutral-200"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10",
              settled
                ? "bg-neutral-100 text-neutral-500"
                : "bg-severity-critical-surface text-sos"
            )}
          >
            {settled ? (
              <CircleCheckIcon className="size-5" strokeWidth={1.9} />
            ) : (
              <AlertTriangleIcon className="size-5" strokeWidth={1.9} />
            )}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[13px] leading-snug font-bold break-words text-neutral-900 sm:text-[14px]">
                {live
                  ? `Ongoing ${brief.title.toLowerCase()} around ${brief.street}`
                  : brief.title}
              </p>
              {!live ? (
                <span className="inline-flex shrink-0 items-center text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                  Resolved
                </span>
              ) : showCriticalPriority ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-severity-critical-ink sm:text-[12px]"
                  title="Critical priority"
                >
                  <SignalIcon className="size-3.5 shrink-0" strokeWidth={2} />
                  Critical priority
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-neutral-500 sm:text-[12px]">
              {[emergency.community.name, brief.street, dist, ago]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-1">
              {displayNoteLabel ? (
                <p className="mb-0.5 text-[10px] font-bold tracking-[0.06em] text-neutral-400 uppercase">
                  {displayNoteLabel}
                </p>
              ) : null}
              <p className="line-clamp-2 text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
                {displayNote}
              </p>
            </div>
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
            {actionLabel}
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
  canInteract = true,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  onBack: () => void
  focusComment?: boolean
  canInteract?: boolean
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const st = brief.status
  const settled = !st.live
  const displayNote =
    emergency.display_description ||
    emergency.ai_summary ||
    emergency.note ||
    brief.safetyNote
  const displayNoteLabel =
    emergency.display_description || emergency.ai_summary
      ? ""
      : emergency.note
        ? "Resident report"
        : ""

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900"
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-1">
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
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              settled
                ? "bg-neutral-100 text-neutral-500"
                : "bg-severity-critical-surface text-sos"
            )}
          >
            {settled ? (
              <CircleCheckIcon className="size-6" strokeWidth={1.9} />
            ) : (
              <AlertTriangleIcon className="size-6" strokeWidth={1.9} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[15px] leading-snug font-bold text-neutral-900">
                {st.live
                  ? `Ongoing ${brief.title.toLowerCase()} around ${brief.street}`
                  : brief.title}
              </p>
              {!st.live && (
                <span className="inline-flex shrink-0 items-center text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                  Resolved
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] text-neutral-500">
              {[brief.street, dist, timeAgo(emergency.created_at)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-2">
              {displayNoteLabel ? (
                <p className="mb-0.5 text-[10px] font-bold tracking-[0.06em] text-neutral-400 uppercase">
                  {displayNoteLabel}
                </p>
              ) : null}
              <p className="text-[13px] leading-relaxed text-neutral-600">
                {displayNote}
              </p>
            </div>
          </div>
        </div>

        <section className="mt-6 border-t border-neutral-200 pt-5">
          <h3 className="text-[15px] font-bold text-neutral-900">
            Community updates
          </h3>
          {canInteract ? (
            <div className="mt-4">
              <EmergencyCommunityComments
                alertId={emergency.id}
                acceptsComments={st.live}
                autoFocusComposer={focusComment}
              />
            </div>
          ) : (
            <p className="mt-3 rounded-xl bg-neutral-100 px-3 py-2 text-[12px] font-semibold text-neutral-600">
              You can only view alerts from another community.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
