import { SlidersHorizontalIcon } from "lucide-react"

import type { PublicUser } from "@/features/dashboard/api"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"

/**
 * Home feed composer entry point — mobile: rounded pill (avatar → Report);
 * filter icon sits beside it, outside the pill. Desktop: bordered card.
 * Opens `CreateReportDialog` (owned by `pages/home.tsx`) on click.
 */
export function ComposerCard({
  user,
  onOpenComposer,
  onOpenFilter,
}: {
  user: PublicUser | null
  onOpenComposer: () => void
  onOpenFilter: () => void
}) {
  return (
    <section className="mb-3 w-full bg-white md:mb-2 md:rounded-lg md:border-[1.5px] md:border-neutral-300 md:px-3.5 md:py-3.5">
      <div className="flex min-h-11 items-center gap-2.5">
        <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50/80 py-1 pl-1.5 pr-1.5 md:contents">
          <UserAvatar user={user} size="md" className="size-9 text-[15px] sm:size-10 sm:text-[17px]" />
          <button
            type="button"
            onClick={onOpenComposer}
            className="min-h-9 min-w-0 flex-1 rounded-full bg-transparent px-2 py-2 text-left text-[11px] font-normal leading-snug text-neutral-600 transition-colors hover:text-neutral-800 sm:px-3 sm:text-[13px] md:min-h-10 md:bg-neutral-100 md:px-4 md:hover:bg-neutral-200/70"
          >
            What&apos;s happening in your barangay?
          </button>
          <button
            type="button"
            onClick={onOpenComposer}
            className="h-9 shrink-0 rounded-full bg-brand-orange px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#e85f12] active:scale-[0.98] sm:h-10 sm:px-5 sm:text-[14px]"
          >
            Report
          </button>
        </div>
        {/* Filter — mobile only; outside the report pill, still beside it */}
        <button
          type="button"
          onClick={onOpenFilter}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100/70 md:hidden"
          aria-label="Filter feed"
        >
          <SlidersHorizontalIcon className="size-5" strokeWidth={2} />
        </button>
      </div>
    </section>
  )
}
