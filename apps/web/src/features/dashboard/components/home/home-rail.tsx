import { Link } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { BarangayEvent } from "@/features/dashboard/api"
import { EventCalendar } from "@/features/dashboard/components/home/event-calendar"
import { BARANGAY, FS, RAIL_CHEVRON } from "@/features/dashboard/components/home/home-style"

/**
 * Right-rail cards for the resident Home feed (desktop only — hidden <1024
 * via the `.resident-home-rail` rule in `pages/home.tsx`): live-map/alerts
 * tile, today's barangay events, and the "report a concern" promo card.
 *
 * The rail flows at its natural height and scrolls with the page. It must not
 * be sticky or height-capped: that gave it an inner scrollbar and cut off the
 * lower sections.
 */
export function HomeRail({
  hasOngoingAlerts,
  barangayActiveEmergencies,
  railMapSrc,
  streetLabel,
  events,
  onCreateReport,
}: {
  hasOngoingAlerts: boolean
  barangayActiveEmergencies: number
  railMapSrc: string
  streetLabel: string | null
  events: BarangayEvent[]
  onCreateReport: () => void
}) {
  return (
    <aside className="resident-home-rail flex w-full min-w-0 flex-col gap-2.5 self-start pb-2">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <Link
          to="/dashboard/alerts-map"
          className="flex min-w-0 items-center gap-3 px-3.5 py-3 no-underline transition-colors hover:bg-neutral-50"
        >
          <span
            className="rail-live-dot"
            title={hasOngoingAlerts ? "Ongoing alerts in your barangay" : "Live in your barangay"}
            aria-hidden
          >
            <span className="rail-live-dot__map">
              <img src={railMapSrc} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="rail-live-dot__status-wrap">
              <span
                className={cn(
                  "rail-live-dot__ring",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
              />
              <span
                className={cn(
                  "rail-live-dot__ring rail-live-dot__ring--delay",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
              />
              <span
                className={cn(
                  "rail-live-dot__status",
                  hasOngoingAlerts && "rail-live-dot__status--alert",
                )}
              />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate font-semibold leading-snug text-neutral-900", FS.railTitle)}>
              {BARANGAY}
            </p>
            {hasOngoingAlerts ? (
              <p className={cn("mt-0.5 truncate font-semibold leading-snug text-sos", FS.meta)}>
                {barangayActiveEmergencies} ongoing alert
                {barangayActiveEmergencies === 1 ? "" : "s"}
              </p>
            ) : streetLabel ? (
              <p className={cn("mt-0.5 truncate font-normal leading-snug text-neutral-500", FS.meta)}>
                {streetLabel}
              </p>
            ) : null}
          </div>
        </Link>
        <Link
          to="/dashboard/alerts-map"
          className={cn(
            "flex items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 font-semibold no-underline transition-colors",
            hasOngoingAlerts
              ? "text-sos hover:bg-sos/10 hover:text-sos"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700",
            FS.railLink,
          )}
        >
          <span>{hasOngoingAlerts ? "See all ongoing alerts" : "See all alerts"}</span>
          <ChevronRightIcon
            className={cn(RAIL_CHEVRON, hasOngoingAlerts ? "text-sos" : "text-neutral-500")}
            strokeWidth={2}
          />
        </Link>
      </div>

      <EventCalendar events={events} />

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 p-3">
          <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-tint">
            <img
              src="/contents/marikina-area-2.webp"
              alt="Marikina City landmark"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
        <div className="px-3.5 py-3">
          <p className={cn("font-bold text-neutral-900", FS.railTitle)}>
            Report a local concern
          </p>
          <p className={cn("mt-1 leading-relaxed text-neutral-600", FS.railBody)}>
            Share issues with neighbors and barangay officials so they can take action.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateReport}
          className={cn(
            "flex w-full items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 text-left font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700",
            FS.railLink,
          )}
        >
          <span>Create a report</span>
          <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-neutral-500")} strokeWidth={2} />
        </button>
      </div>
    </aside>
  )
}