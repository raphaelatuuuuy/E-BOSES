import { AlertTriangleIcon, ChevronLeftIcon, MapPinIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ResidentMapEmergency } from "@/features/dashboard/api"
import { emergencyBrief, formatDistance, timeAgo } from "@/features/dashboard/lib/resident-map-utils"

/**
 * Ongoing-SOS UI for the resident alerts map: the floating top banner (shown
 * whenever any emergency is in the current filter), the compact list-preview
 * card, and the expanded detail panel. Grouped into one file since all three
 * are "emergency banner / ongoing-SOS strip" surfaces per the D1.2 brief.
 */

/** Floating banner shown over the map when >=1 ongoing SOS is in the current filter. */
export function EmergencyBanner({
  emergencies,
  selectedEmergency,
}: {
  emergencies: ResidentMapEmergency[]
  selectedEmergency: ResidentMapEmergency | null
}) {
  if (emergencies.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center px-3 md:top-4 md:justify-start md:pl-4">
      <div className="pointer-events-auto max-w-sm rounded-xl border border-red-100 bg-white px-3 py-2 shadow-md">
        <p className="text-[11px] font-bold tracking-wide text-red-600 uppercase">
          {emergencies.length} ongoing SOS
          {emergencies.length === 1 ? "" : "s"}
        </p>
        {selectedEmergency ? (
          (() => {
            const brief = emergencyBrief(selectedEmergency)
            return (
              <div className="mt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-semibold text-neutral-900">{brief.title}</p>
                  {brief.status.live ? (
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white uppercase">
                      Live
                    </span>
                  ) : null}
                  <span className="text-[11px] font-semibold text-red-600">
                    {brief.status.label}
                  </span>
                </div>
                <p className="text-[12px] leading-snug text-neutral-600">{brief.line}</p>
                {(selectedEmergency.address || selectedEmergency.barangay) &&
                selectedEmergency.note ? (
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {selectedEmergency.address || selectedEmergency.barangay}
                  </p>
                ) : null}
              </div>
            )
          })()
        ) : (
          <p className="mt-0.5 text-[12px] text-neutral-600">
            Red pins on the map — tap for live details
          </p>
        )}
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
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  expanded: boolean
  onOpen: () => void
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const ago = timeAgo(emergency.created_at)
  const place = (emergency.address || emergency.barangay || "").trim()

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-2xl border bg-white px-3 py-3 text-left transition-colors sm:px-3.5",
        expanded
          ? "border-red-300 bg-red-50/40 shadow-sm"
          : "border-neutral-200 hover:border-red-200 hover:bg-red-50/20",
      )}
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 sm:size-10">
          <AlertTriangleIcon className="size-4 sm:size-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-neutral-900 sm:text-[14px]">
              {brief.title}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {brief.status.live ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" />
                  Live
                </span>
              ) : null}
              <span className="text-[11px] font-semibold text-red-600 sm:text-[12px]">
                {brief.status.label}
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-neutral-500 sm:text-[12px]">
            {[dist, ago, place].filter(Boolean).join(" · ")}
          </p>
          {emergency.note?.trim() ? (
            <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
              {emergency.note.trim()}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-snug text-neutral-500 sm:text-[13px]">
              Ongoing SOS — responders may be en route
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

/** Expanded emergency detail in the list panel */
export function EmergencyDetailPanel({
  emergency,
  distance,
  onBack,
}: {
  emergency: ResidentMapEmergency
  distance: number | null
  onBack: () => void
}) {
  const brief = emergencyBrief(emergency)
  const dist = formatDistance(distance)
  const place = (emergency.address || emergency.barangay || "").trim()
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
        {st.live ? (
          <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangleIcon className="size-5" strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold text-neutral-900">{brief.title}</p>
              <p className="mt-1 text-[13px] font-semibold text-red-700">{st.label}</p>
              <p className="mt-1 text-[12px] text-neutral-500">
                {[dist, timeAgo(emergency.created_at)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {place ? (
            <div className="mt-4 flex items-start gap-2 text-[13px] text-neutral-700">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
              <span>{place}</span>
            </div>
          ) : null}

          {emergency.note?.trim() ? (
            <div className="mt-3 rounded-xl border border-red-100 bg-white px-3 py-2.5">
              <p className="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">
                Note
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-neutral-800">
                {emergency.note.trim()}
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Status</p>
              <p className="mt-0.5 font-semibold text-neutral-900">{st.label}</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Type</p>
              <p className="mt-0.5 font-semibold capitalize text-neutral-900">
                {(emergency.type_label || emergency.type || "—").replace(/_/g, " ")}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Reported</p>
              <p className="mt-0.5 font-semibold text-neutral-900">
                {timeAgo(emergency.created_at) || "—"}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="font-bold text-neutral-500">Updated</p>
              <p className="mt-0.5 font-semibold text-neutral-900">
                {timeAgo(emergency.updated_at) || "—"}
              </p>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-neutral-500">
            {st.live
              ? "This SOS is active. Barangay responders may be en route. Stay clear if you are not involved."
              : "This emergency is no longer active."}
          </p>
        </div>
      </div>
    </div>
  )
}
