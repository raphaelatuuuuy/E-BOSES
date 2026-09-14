import { useNavigate } from "react-router-dom"
import { ChevronRightIcon, MegaphoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Announcement } from "@/features/dashboard/api"
import {
  announcementTitle,
  formatAnnouncementDateTime,
} from "@/features/dashboard/lib/announcement-summary"

export function OverviewAnnouncements({
  items,
  onViewAll,
}: {
  items: Announcement[]
  onViewAll: () => void
}) {
  const navigate = useNavigate()
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-neutral-900">
          <MegaphoneIcon
            className="size-5 shrink-0 text-brand-orange"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          Recent Advisories
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[14px] font-bold text-brand-orange"
        >
          View all
        </button>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <MegaphoneIcon
            className="size-8 text-neutral-300"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <p className="mt-3 text-[14px] text-neutral-500">
            No advisories yet.
          </p>
        </div>
      ) : null}
      {items.map((announcement) => {
        const general =
          announcement.tag.trim().toLowerCase() === "general advisory"
        return (
          <button
            key={announcement.id}
            type="button"
            onClick={() => navigate("/dashboard/feed")}
            className="mt-3 flex w-full items-center gap-3 text-left first:mt-0"
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "mb-1 inline-block rounded-md px-2 py-0.5 text-[12px] font-medium",
                  general
                    ? "bg-severity-low-surface text-severity-low"
                    : "bg-brand-orange-soft text-brand-orange"
                )}
              >
                {announcement.tag}
              </span>
              <span className="block text-[15px] leading-snug font-bold break-words text-neutral-900">
                {announcementTitle(announcement)}
              </span>
              <span className="mt-0.5 block text-[13px] text-neutral-500">
                {formatAnnouncementDateTime(announcement) ||
                  announcement.date_label}
              </span>
            </span>
            <ChevronRightIcon
              className="size-6 shrink-0 text-neutral-400"
              aria-hidden="true"
            />
          </button>
        )
      })}
    </section>
  )
}
