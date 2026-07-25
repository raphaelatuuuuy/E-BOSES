import { Megaphone, Flag as FlagIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import type { Announcement } from "@/features/dashboard/api"

export function FeedAnnouncementCard({ announcement }: { announcement: Announcement }) {
  return (
    <article className="rounded-2xl border border-[#dfe7f5] bg-white p-4 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[64px_minmax(0,1fr)_120px_150px] md:items-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-[#fff1ea] text-[#2447b3]">
          <Megaphone className="size-7 -scale-x-100" />
        </div>
        <div className="min-w-0">
          <Badge className={cn("mb-2 border-0 text-[10px] font-extrabold uppercase", announcement.urgency === "urgent" ? "bg-red-50 text-red-700 hover:bg-red-50" : announcement.urgency === "important" ? "bg-amber-50 text-amber-700 hover:bg-amber-50" : "bg-[#fff1ea] text-[#ff6a1a] hover:bg-[#fff1ea]")}>
            {announcement.is_pinned ? "Pinned · " : ""}{announcement.tag || "Announcement"}
          </Badge>
          <h2 className="truncate text-lg font-extrabold text-[#07145f]">{announcement.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[#43507f]">{announcement.body}</p>
          <p className="mt-2 text-xs font-bold text-[#2447b3]">Barangay Hall <span className="mx-2 text-[#8b96b8]">•</span>{announcement.date_label}</p>
        </div>
        <img src={announcement.image_url || "/contents/feed-header.png"} alt={announcement.image_alt || ""} className="hidden h-20 w-full rounded-lg object-cover md:block" />
        <div className="flex items-center justify-end gap-5 border-[#dfe7f5] text-[#07145f] md:border-l md:pl-6">
          <div className="text-center">
            <p className="text-sm font-extrabold">0</p>
            <p className="text-xs font-semibold text-[#43507f]">Upvotes</p>
          </div>
          <FlagIcon className="size-5 text-[#2447b3]" />
        </div>
      </div>
    </article>
  )
}
