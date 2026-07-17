import { ChevronRight, MegaphoneIcon, Trash2Icon, TrafficConeIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Badge } from "@workspace/ui/components/badge"
import type { Announcement } from "@/features/dashboard/api"

function iconFor(announcement: Announcement) {
  const value = `${announcement.title} ${announcement.tag}`.toLowerCase()
  if (value.includes("garbage") || value.includes("collection")) return Trash2Icon
  if (value.includes("road") || value.includes("maintenance")) return TrafficConeIcon
  return MegaphoneIcon
}

interface Props {
  announcements: Announcement[]
}

export function AnnouncementsCard({ announcements }: Props) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-white shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div className="min-w-0 px-5 pb-2 pt-4">
        <h2 className="font-heading text-base font-bold text-[#07145f]">Announcements</h2>
      </div>

      <div className="flex flex-1 flex-col px-5">
        {announcements.slice(0, 3).map((a) => {
          const Icon = iconFor(a)
          const isRoad = `${a.title} ${a.tag}`.toLowerCase().includes("road")
          return (
            <article
              key={a.id}
              className="flex items-start gap-4 border-b border-border py-3.5 last:border-b-0"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fff1ea] text-[#ff6a1a]">
                <Icon className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <p className="min-w-0 flex-1 text-sm font-bold leading-snug text-[#07145f]">
                    {a.title}
                  </p>
                  {!isRoad ? (
                    <Badge className="shrink-0 rounded-full border-0 bg-red-50 px-3 py-1 text-xs font-medium text-red-500">
                      New
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs font-medium text-[#0047b3]">{a.date_label}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#3e4a77]">{a.body}</p>
              </div>
            </article>
          )
        })}
        {announcements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-[#46537d]">
            <img src="/contents/announcements.png" alt="" className="mb-4 h-32 w-auto" aria-hidden="true" />
            No announcements yet.
          </div>
        )}
      </div>

      <div className="mt-auto px-5 py-4">
        <Link
          to="/dashboard/feed"
          className="flex items-center justify-between text-sm font-semibold text-[#0047b3] transition-colors hover:text-[#003580]"
        >
          <span>View all announcements</span>
          <ChevronRight className="size-5" />
        </Link>
      </div>
    </section>
  )
}
