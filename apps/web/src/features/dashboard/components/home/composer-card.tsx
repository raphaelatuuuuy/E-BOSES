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
    <section className="mb-3 w-full bg-white lg:mb-2 lg:rounded-lg lg:border lg:border-neutral-300 lg:px-3.5 lg:py-3.5">
      <div className="flex min-h-11 items-center gap-2.5">
        <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-neutral-300 bg-neutral-50/80 py-1 pl-1.5 pr-1.5 lg:contents">
          <UserAvatar user={user} size="md" className="size-9 text-[15px] sm:size-10 sm:text-[17px]" />
          <button
            type="button"
            onClick={onOpenComposer}
            className="min-h-9 min-w-0 flex-1 rounded-full bg-transparent px-2 py-2 text-left text-[13px] font-normal leading-snug text-neutral-600 transition-colors hover:text-neutral-800 sm:px-3 sm:text-[14px] lg:min-h-10 lg:bg-neutral-100 lg:px-4 lg:hover:bg-neutral-200/70"
          >
            Send a report...
          </button>
          <button
            type="button"
            onClick={onOpenComposer}
            className="h-9 shrink-0 rounded-full bg-brand-orange px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-orange-strong active:scale-[0.98] sm:h-10 sm:px-5 sm:text-[14px]"
          >
            Report
          </button>
        </div>
        {/* Filter — mobile only; outside the report pill, still beside it */}
        <button
          type="button"
          onClick={onOpenFilter}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100/70 lg:hidden"
          aria-label="Filter feed"
        >
          <SlidersHorizontalIcon className="size-5" strokeWidth={2} />
        </button>
      </div>
    </section>
  )
}
