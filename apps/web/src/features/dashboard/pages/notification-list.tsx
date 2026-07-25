import { WarningCircle as WarningCircleIcon, Archive as ArchiveIcon, Bell, FileText, Megaphone, Trash as TrashIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { typeGroup } from "@/features/dashboard/pages/notification-list.utils"
import type { NotificationItem } from "@/features/dashboard/components/notification-context"

const notificationDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

function NotificationIcon({ item }: { item: NotificationItem }) {
  const group = typeGroup(item)
  if (group === "emergencies") return <WarningCircleIcon className="size-5" />
  if (group === "announcements") return <Megaphone className="size-5 -scale-x-100" />
  return <FileText className="size-5" />
}

function notificationSnippet(text: string | null | undefined, max = 90): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 32 ? atWord : slice.trim()
  return `${base}...`
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return notificationDateFormatter.format(new Date(value))
}

export function NotificationListContent({
  loading,
  visible,
  hasMore,
  loadingMore,
  onOpen,
  onArchive,
  onDelete,
  onLoadMore,
}: {
  loading: boolean
  visible: NotificationItem[]
  hasMore: boolean
  loadingMore: boolean
  onOpen: (item: NotificationItem) => void
  onArchive: (item: NotificationItem) => void
  onDelete: (item: NotificationItem) => void
  onLoadMore: () => void
}) {
  if (loading) {
    return (
      <div className="divide-y divide-neutral-100" aria-label="Loading notifications">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-20 animate-pulse bg-neutral-50" />
        ))}
      </div>
    )
  }

  if (!visible.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
        <Bell className="size-8 text-neutral-400" />
        <h2 className="mt-4 text-[15px] font-semibold text-neutral-900">No notifications in this view</h2>
        <p className="mt-1 max-w-sm text-[14px] leading-6 text-neutral-500">
          Report updates, emergency activity, and barangay announcements will appear here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="divide-y divide-neutral-100">
        {visible.map((item) => (
          <div key={item.id} className={cn("flex items-start gap-2 px-3 py-3", !item.is_read && "bg-[#fff8f3]")}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex min-w-0 flex-1 gap-3.5 rounded-lg p-1 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a1a]"
            >
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", typeGroup(item) === "emergencies" ? "bg-red-50 text-red-700" : typeGroup(item) === "announcements" ? "bg-amber-50 text-amber-800" : "bg-neutral-100 text-neutral-700")}>
                <NotificationIcon item={item} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-semibold text-neutral-900">{item.display_title || item.title}</span>
                  <span className="shrink-0 pt-0.5 text-[12px] text-neutral-500">{relativeTime(item.created_at)}</span>
                </span>
                <span className="mt-1 block line-clamp-2 text-[14px] leading-6 text-neutral-600">{notificationSnippet(item.display_body || item.body)}</span>
                {item.image_url ? <img src={item.image_url} alt="" loading="lazy" className="mt-3 h-24 w-full rounded-xl object-cover" /> : null}
                {item.safety_limited ? (
                  <span className="mt-3 block rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                    <span className="block text-[12px] font-bold tracking-wide text-red-800 uppercase">Nearby safety alert</span>
                    <span className="mt-1 block text-[13px] leading-5 text-red-950">{item.safety_guidance || "Stay clear of the area and do not intervene."}</span>
                    <span className="mt-1.5 block text-[11px] leading-4 text-red-800/70">For privacy, the reporter&apos;s identity, exact location, and media are not shared.</span>
                  </span>
                ) : null}
                {item.action_label && !item.safety_limited ? <span className="mt-2 block text-[12px] font-bold text-[#ff6a1a]">{item.action_label}</span> : null}
              </span>
              {!item.is_read ? <span className="mt-2 size-2 shrink-0 rounded-full bg-[#ff6a1a]" aria-label="Unread" /> : null}
            </button>
            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" onClick={() => onArchive(item)} className="flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800" aria-label={`Archive ${item.display_title || item.title}`}>
                <ArchiveIcon className="size-4" />
              </button>
              <button type="button" onClick={() => onDelete(item)} className="flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${item.display_title || item.title}`}>
                <TrashIcon className="size-4" />
              </button>
            </div>
          </div>
        ))}
        {hasMore ? (
          <div className="flex justify-center px-4 py-4">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="min-h-10 rounded-full border border-neutral-200 px-5 text-[13px] font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load older notifications"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
