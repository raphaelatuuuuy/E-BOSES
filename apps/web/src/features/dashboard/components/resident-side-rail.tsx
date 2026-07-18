import { Link } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { RESIDENT_DESKTOP_MIN_PX } from "@/features/dashboard/components/resident-top-bar"

const BARANGAY = "Marikina Heights"
const RAIL_CHEVRON = "size-4 shrink-0"

/**
 * Desktop right rail shared by Home, Notifications, etc.
 * Hidden below RESIDENT_DESKTOP_MIN_PX via CSS class.
 */
export function ResidentSideRail({
  streetLabel,
  className,
}: {
  streetLabel?: string | null
  className?: string
}) {
  return (
    <>
      <style>{`
        .resident-page-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-page-rail { display: none !important; }
        }
      `}</style>
      <aside
        className={cn(
          "resident-page-rail sticky top-3 flex w-full min-w-0 flex-col gap-2.5 self-start",
          className,
        )}
      >
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <Link
            to="/dashboard/alerts-map"
            className="flex min-w-0 items-center gap-3 px-3.5 py-3 no-underline transition-colors hover:bg-neutral-50"
          >
            <span
              className="inline-block size-10 shrink-0 rounded-full bg-[#e8eef5]"
              style={{
                backgroundImage: "url(/contents/marikina-area-2.png)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold leading-snug text-neutral-900">
                {BARANGAY}
              </p>
              {streetLabel ? (
                <p className="mt-0.5 truncate text-[12px] font-normal leading-snug text-neutral-500">
                  {streetLabel}
                </p>
              ) : (
                <p className="mt-0.5 truncate text-[12px] font-normal leading-snug text-neutral-500">
                  Your barangay
                </p>
              )}
            </div>
          </Link>
          <Link
            to="/dashboard/alerts-map"
            className="flex items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 text-[13px] font-semibold text-neutral-500 no-underline transition-colors hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span>See all alerts</span>
            <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-neutral-500")} strokeWidth={2} />
          </Link>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-3">
            <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-[#e8f0fa]">
              <img
                src="/contents/marikina-area-2.png"
                alt="Marikina City landmark"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
          <div className="px-3.5 py-3">
            <p className="text-[14px] font-bold text-neutral-900">Report a local concern</p>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
              Share issues with neighbors and barangay officials so they can take action.
            </p>
          </div>
          <Link
            to="/dashboard/reports"
            className="flex w-full items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 text-left text-[13px] font-semibold text-neutral-500 no-underline transition-colors hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span>My reports</span>
            <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-neutral-500")} strokeWidth={2} />
          </Link>
        </div>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
          className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-red-300 hover:bg-red-50/40"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="inline-block size-7 shrink-0 bg-red-600"
              style={{
                WebkitMaskImage: "url(/contents/nav-alert.png)",
                maskImage: "url(/contents/nav-alert.png)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-red-700">Emergency SOS</p>
              <p className="text-[12px] text-red-600/75">Get help from responders</p>
            </div>
          </div>
          <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-red-400/70")} strokeWidth={2} />
        </button>
      </aside>
    </>
  )
}
