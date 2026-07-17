import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangleIcon, BellIcon, CheckCheckIcon, CloudOffIcon, FileTextIcon, MegaphoneIcon, WifiIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Topbar } from "@/features/dashboard/components/topbar"
import { useNotifications, type NotificationItem } from "@/features/dashboard/components/notification-context"
import { usePageTitle } from "@/hooks/use-page-title"
import { apiRequest } from "@/lib/api"

type Filter = "all" | "unread" | "reports" | "emergencies" | "announcements"

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reports", label: "Reports" },
  { value: "emergencies", label: "Emergencies" },
  { value: "announcements", label: "Announcements" },
]

function typeGroup(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
  if (item.emergency_id || item.type.startsWith("emergency") || item.type === "witness_alert") return "emergencies"
  if (item.type === "announcement") return "announcements"
  return "reports"
}

function NotificationIcon({ item }: { item: NotificationItem }) {
  const group = typeGroup(item)
  if (group === "emergencies") return <AlertTriangleIcon className="size-5" />
  if (group === "announcements") return <MegaphoneIcon className="size-5" />
  return <FileTextIcon className="size-5" />
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

export default function NotificationsPage() {
  usePageTitle("Notifications")
  const navigate = useNavigate()
  const { notifications, unreadCount, loading, connectionState, markAsRead, markAllAsRead } = useNotifications()
  const [filter, setFilter] = useState<Filter>("all")
  const [olderNotifications, setOlderNotifications] = useState<NotificationItem[]>([])
  const [nextPage, setNextPage] = useState(2)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const allNotifications = useMemo(() => {
    const byId = new Map<number, NotificationItem>()
    for (const item of [...notifications, ...olderNotifications]) byId.set(item.id, item)
    return [...byId.values()].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )
  }, [notifications, olderNotifications])

  const visible = useMemo(() => allNotifications.filter((item) => {
    if (filter === "all") return true
    if (filter === "unread") return !item.is_read
    return typeGroup(item) === filter
  }), [filter, allNotifications])

  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      await markAsRead(item.id)
      setOlderNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry))
    }
    if (item.emergency_id) {
      navigate(`/dashboard/emergency-history?alert=${item.emergency_public_id || item.emergency_id}`)
      return
    }
    if (item.concern_id) {
      navigate(`/dashboard/reports/${item.concern_public_id || item.concern_id}`)
      return
    }
    navigate("/dashboard/home")
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await apiRequest<NotificationItem[]>(`/notifications/?page=${nextPage}&page_size=20`)
      setOlderNotifications((current) => [...current, ...next])
      setNextPage((current) => current + 1)
      setHasMore(next.length === 20)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="min-h-full bg-white">
      <Topbar />
      <main className="mx-auto w-full max-w-[760px] px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e6e9ef] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#020c4e]">Notifications</h1>
              {unreadCount ? <span className="rounded-full bg-[#ff8133] px-2 py-0.5 text-xs font-bold text-white">{unreadCount}</span> : null}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[#5b6475]">
              {connectionState === "live" ? <WifiIcon className="size-4 text-emerald-700" /> : <CloudOffIcon className="size-4 text-amber-700" />}
              {connectionState === "live" ? "Live updates connected" : connectionState === "connecting" ? "Connecting to live updates" : "Using polling fallback"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void markAllAsRead().then(() => {
                setOlderNotifications((current) => current.map((item) => ({ ...item, is_read: true })))
              })
            }}
            disabled={!unreadCount}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#2447b3] hover:bg-[#eef3ff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCheckIcon className="size-4" />
            Mark all read
          </button>
        </div>

        <div className="-mx-4 overflow-x-auto border-b border-[#e6e9ef] px-4 sm:mx-0 sm:px-0" aria-label="Notification filters">
          <div className="flex min-w-max gap-1 py-3">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={cn(
                  "min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors",
                  filter === item.value ? "bg-[#020c4e] text-white" : "text-[#5b6475] hover:bg-[#f2f4f7] hover:text-[#020c4e]",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-[#e6e9ef]" aria-label="Loading notifications">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse bg-[#f7f8fa]" />)}
          </div>
        ) : visible.length ? (
          <div className="divide-y divide-[#e6e9ef]">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openNotification(item)}
                className={cn(
                  "flex w-full gap-3 px-1 py-4 text-left transition-colors hover:bg-[#f7f8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8133]",
                  !item.is_read && "bg-[#fff8f3]",
                )}
              >
                <span className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  typeGroup(item) === "emergencies" ? "bg-red-50 text-red-700" : typeGroup(item) === "announcements" ? "bg-amber-50 text-amber-800" : "bg-[#eef3ff] text-[#2447b3]",
                )}>
                  <NotificationIcon item={item} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-bold text-[#020c4e]">{item.title}</span>
                    <span className="shrink-0 text-xs text-[#687386]">{relativeTime(item.created_at)}</span>
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-[#4f596a]">{item.body}</span>
                </span>
                {!item.is_read ? <span className="mt-2 size-2 shrink-0 rounded-full bg-[#ff8133]" aria-label="Unread" /> : null}
              </button>
            ))}
            {hasMore ? (
              <div className="flex justify-center py-5">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="min-h-11 rounded-md border border-[#cbd8ee] px-5 text-sm font-bold text-[#2447b3] hover:border-[#ff8133] hover:text-[#ff8133] disabled:opacity-60"
                >
                  {loadingMore ? "Loading" : "Load older notifications"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <BellIcon className="size-8 text-[#8a94a6]" />
            <h2 className="mt-4 text-base font-bold text-[#020c4e]">No notifications in this view</h2>
            <p className="mt-1 max-w-sm text-sm leading-6 text-[#5b6475]">Report updates, emergency activity, and barangay announcements will appear here.</p>
          </div>
        )}
      </main>
    </div>
  )
}
