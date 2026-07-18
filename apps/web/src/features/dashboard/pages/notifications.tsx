import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  BellIcon,
  ChevronLeftIcon,
  FileTextIcon,
  MegaphoneIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { useNotifications, type NotificationItem } from "@/features/dashboard/components/notification-context"
import { ResidentSideRail } from "@/features/dashboard/components/resident-side-rail"
import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
} from "@/features/dashboard/components/resident-top-bar"
import { usePageTitle } from "@/hooks/use-page-title"
import { apiRequest } from "@/lib/api"
import { parseStoredAddress } from "@/features/dashboard/components/address-confirm-flow"

type Filter = "all" | "unread" | "reports" | "emergencies" | "announcements"

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reports", label: "Reports" },
  { value: "emergencies", label: "Emergencies" },
  { value: "announcements", label: "Announcements" },
]

function typeGroup(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
  if (item.emergency_id || item.type.startsWith("emergency") || item.type === "witness_alert") {
    return "emergencies"
  }
  if (item.type === "announcement") return "announcements"
  return "reports"
}

function NotificationIcon({ item }: { item: NotificationItem }) {
  const group = typeGroup(item)
  if (group === "emergencies") return <AlertTriangleIcon className="size-5" />
  if (group === "announcements") return <MegaphoneIcon className="size-5" />
  return <FileTextIcon className="size-5" />
}

/** Short preview for list rows — avoid full report/chat description. */
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
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

export default function NotificationsPage() {
  usePageTitle("Notifications")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications()
  const [filter, setFilter] = useState<Filter>("all")
  const [olderNotifications, setOlderNotifications] = useState<NotificationItem[]>([])
  const [nextPage, setNextPage] = useState(2)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const streetLabel = useMemo(() => {
    const raw = (user?.address ?? "").trim()
    if (!raw || raw.toLowerCase() === "pending") return null
    const { street } = parseStoredAddress(raw)
    return street.trim() || null
  }, [user?.address])

  const allNotifications = useMemo(() => {
    const byId = new Map<number, NotificationItem>()
    for (const item of [...notifications, ...olderNotifications]) byId.set(item.id, item)
    return [...byId.values()].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )
  }, [notifications, olderNotifications])

  const visible = useMemo(
    () =>
      allNotifications.filter((item) => {
        if (filter === "all") return true
        if (filter === "unread") return !item.is_read
        return typeGroup(item) === filter
      }),
    [filter, allNotifications],
  )

  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      await markAsRead(item.id)
      setOlderNotifications((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, is_read: true } : entry)),
      )
    }
    if (item.emergency_id) {
      navigate(
        `/dashboard/emergency-history?alert=${item.emergency_public_id || item.emergency_id}`,
      )
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
      const next = await apiRequest<NotificationItem[]>(
        `/notifications/?page=${nextPage}&page_size=20`,
      )
      setOlderNotifications((current) => [...current, ...next])
      setNextPage((current) => current + 1)
      setHasMore(next.length === 20)
    } finally {
      setLoadingMore(false)
    }
  }

  function goBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate("/dashboard/home")
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <style>{`
        /* Mobile: single column (rail hidden). Desktop: feed | rail like Home */
        .notif-layout { display: block !important; }
        @media (min-width: ${RESIDENT_DESKTOP_MIN_PX}px) {
          .notif-layout {
            display: grid !important;
          }
        }
      `}</style>
      <ResidentContentGrid className="notif-layout min-w-0 flex-1 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-12 md:pt-4 lg:px-0">
        {/* Main column: header + filters + list share one full-width band */}
        <div className="min-w-0 w-full">
          <header className="mb-1 flex h-12 w-full items-center gap-1">
            <button
              type="button"
              onClick={goBack}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
              aria-label="Back"
            >
              <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h1 className="truncate text-[17px] font-semibold tracking-tight text-neutral-900 sm:text-xl">
                Notifications
              </h1>
              {unreadCount ? (
                <span className="rounded-full bg-[#ff6a1a] px-2 py-0.5 text-xs font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                void markAllAsRead().then(() => {
                  setOlderNotifications((current) =>
                    current.map((item) => ({ ...item, is_read: true })),
                  )
                })
              }}
              disabled={!unreadCount}
              className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
            >
              Mark all read
            </button>
          </header>

          <div className="w-full" aria-label="Notification filters">
            <div className="scrollbar-hide flex w-full gap-2 overflow-x-auto overscroll-x-contain py-3 [-webkit-overflow-scrolling:touch]">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                    filter === item.value
                      ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {loading ? (
              <div className="divide-y divide-neutral-100" aria-label="Loading notifications">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse bg-neutral-50" />
                ))}
              </div>
            ) : visible.length ? (
              <div className="divide-y divide-neutral-100">
                {visible.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openNotification(item)}
                    className={cn(
                      "flex w-full gap-3.5 px-4 py-4 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff6a1a]",
                      !item.is_read && "bg-[#fff8f3]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        typeGroup(item) === "emergencies"
                          ? "bg-red-50 text-red-700"
                          : typeGroup(item) === "announcements"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-neutral-100 text-neutral-700",
                      )}
                    >
                      <NotificationIcon item={item} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-[15px] font-semibold text-neutral-900">
                          {item.title}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[12px] text-neutral-500">
                          {relativeTime(item.created_at)}
                        </span>
                      </span>
                      <span className="mt-1 block line-clamp-2 text-[14px] leading-6 text-neutral-600">
                        {notificationSnippet(item.body)}
                      </span>
                    </span>
                    {!item.is_read ? (
                      <span
                        className="mt-2 size-2 shrink-0 rounded-full bg-[#ff6a1a]"
                        aria-label="Unread"
                      />
                    ) : null}
                  </button>
                ))}
                {hasMore ? (
                  <div className="flex justify-center px-4 py-4">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      className="min-h-10 rounded-full border border-neutral-200 px-5 text-[13px] font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
                    >
                      {loadingMore ? "Loading…" : "Load older notifications"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
                <BellIcon className="size-8 text-neutral-400" />
                <h2 className="mt-4 text-[15px] font-semibold text-neutral-900">
                  No notifications in this view
                </h2>
                <p className="mt-1 max-w-sm text-[14px] leading-6 text-neutral-500">
                  Report updates, emergency activity, and barangay announcements will appear here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Desktop right rail (same column as Home) */}
        <ResidentSideRail streetLabel={streetLabel} />
      </ResidentContentGrid>
    </div>
  )
}
