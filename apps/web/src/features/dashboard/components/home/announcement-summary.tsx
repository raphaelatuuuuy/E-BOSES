import { InfoIcon } from "lucide-react"

import type { Announcement } from "@/features/dashboard/api"
import { announcementSummary } from "@/features/dashboard/lib/announcement-summary"

export function AnnouncementSummary({
  announcement,
  className = "",
}: {
  announcement: Pick<Announcement, "title" | "body" | "llm_summary">
  className?: string
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-[16px] leading-relaxed text-sky-950 ${className}`}
    >
      <InfoIcon
        className="mt-[2px] size-5 shrink-0 text-sky-950"
        strokeWidth={1.9}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="break-words">{announcementSummary(announcement)}</p>
      </div>
    </div>
  )
}
