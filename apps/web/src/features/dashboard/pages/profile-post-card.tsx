import { useNavigate } from "react-router-dom"
import { Globe } from "@phosphor-icons/react"
import { concernBodyText } from "@/features/dashboard/utils/feed-post-card-utils"
import type { Concern } from "@/features/dashboard/api"

function timeAgo(value?: string | null) {
  if (!value) return ""
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function ProfilePostCard({
  post,
  letter,
  fullName,
  barangay,
}: {
  post: Concern
  letter: string
  fullName: string
  barangay: string
}) {
  const navigate = useNavigate()

  return (
    <article className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-[15px] font-bold text-[#2c3a5a]">{letter}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-neutral-900">{fullName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[13px] text-neutral-500">
                <span>{barangay}</span><span aria-hidden>·</span><span>{timeAgo(post.created_at)}</span><Globe className="size-3.5" />
              </p>
            </div>
          </div>
          <button type="button" onClick={() => navigate(`/dashboard/reports/${post.public_id || post.id}`)} className="mt-2 w-full text-left">
            <p className="line-clamp-4 text-[15px] font-medium leading-relaxed text-neutral-900">{concernBodyText(post)}</p>
          </button>
        </div>
      </div>
    </article>
  )
}
