import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArchiveIcon,
  BellIcon,
  ChevronLeftIcon,
  FileTextIcon,
  MegaphoneIcon,
  Trash2Icon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useNotifications, type NotificationItem } from "@/features/dashboard/components/notification-context"
import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
} from "@/features/dashboard/components/resident-top-bar"
import { usePageTitle } from "@/hooks/use-page-title"
import { apiRequest } from "@/lib/api"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"

type Filter = "all" | "unread" | "reports" | "emergencies" | "announcements" | "archived"

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reports", label: "Reports" },
  { value: "emergencies", label: "Emergencies" },
  { value: "announcements", label: "Announcements" },
  { value: "archived", label: "Archived" },
]

const MAX_VISIBLE_NOTIFICATIONS = 50

function typeGroup(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
  if (item.is_archived) return "archived"
  if (item.category === "announcement") return "announcements"
  if (item.category === "emergency") return "emergencies"
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

function initialNotificationFilter(): Filter {
  if (typeof window === "undefined") return "all"
  const type = new URLSearchParams(window.location.search).get("type")
  if (type === "announcements" || type === "emergencies" || type === "reports" || type === "unread" || type === "archived") return type
  return "all"
}

export default function NotificationsPage() {
  usePageTitle("Notifications")
  const navigate = useNavigate()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh } = useNotifications()
  const [filter, setFilter] = useState<Filter>(initialNotificationFilter)
  const [olderNotifications, setOlderNotifications] = useState<NotificationItem[]>([])
  const [nextPage, setNextPage] = useState(2)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [browserState, setBrowserState] = useState<BrowserNotificationState>({
    supported: true,
    permission: "default",
    serverConfigured: true,   // optimistic — corrected by retry loop below
    subscribed: false,
  })
  const [browserBusy, setBrowserBusy] = useState(false)
  const browserStateRef = useRef(browserState)

  useEffect(() => {
    browserStateRef.current = browserState
  })

  useEffect(() => {
    // Retry a few times — the SW may still be activating on fresh page load.
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < 10; i++) {
        const state = await getBrowserNotificationState().catch(() => null)
        if (!state || cancelled) return
        if (state.serverConfigured || state.subscribed) { setBrowserState(state); return }
        await new Promise((r) => setTimeout(r, 500))
      }
      setBrowserState(await getBrowserNotificationState().catch(() => browserStateRef.current))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const allNotifications = useMemo(() => {
    const byId = new Map<number, NotificationItem>()
    for (const item of [...notifications, ...olderNotifications]) byId.set(item.id, item)
    return [...byId.values()].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )
  }, [notifications, olderNotifications])

  const visible = useMemo(
    () =>
      allNotifications
        .filter((item) => {
          if (filter === "all") return !item.is_archived
          if (filter === "unread") return !item.is_read && !item.is_archived
          if (filter === "archived") return item.is_archived
          return typeGroup(item) === filter
        })
        .slice(0, MAX_VISIBLE_NOTIFICATIONS),
    [filter, allNotifications],
  )

  const hasArchivableReadNotifications = useMemo(
    () => allNotifications.some((item) => item.is_read && !item.is_archived),
    [allNotifications],
  )
  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      await markAsRead(item.id)
      setOlderNotifications((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, is_read: true } : entry)),
      )
    }
    if (item.safety_limited || item.type === "witness_alert") return
    if (item.emergency_id) {
      window.dispatchEvent(
        new CustomEvent("eboses:open-emergency-tracking", {
          detail: { emergencyId: item.emergency_id },
        }),
      )
      return
    }
    if (item.action_url) {
      navigate(item.action_url)
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

  async function archiveNotification(id: number) {
    try {
      await apiRequest(`/notifications/${id}/archive/`, { method: "PATCH" })
      await refresh()
    } catch {
      /* ignore */
    }
  }

  async function unarchiveNotification(id: number) {
    try {
      await apiRequest(`/notifications/${id}/archive/`, { method: "PATCH" })
      await refresh()
    } catch {
      /* ignore */
    }
  }

  async function deleteNotification(id: number) {
    if (!window.confirm("Are you sure you want to delete this notification?")) return
    try {
      await apiRequest(`/notifications/${id}/`, { method: "DELETE" })
      await refresh()
    } catch {
      /* ignore */
    }
  }

  async function archiveAllRead() {
    try {
      await apiRequest("/notifications/archive-all/", { method: "POST" })
      await refresh()
    } catch {
      /* ignore */
    }
  }

  async function toggleBrowserPush() {
    setBrowserBusy(true)
    try {
      if (browserState.subscribed) await disableBrowserNotifications()
      else await enableBrowserNotifications()
      const nextState = await getBrowserNotificationState()
      setBrowserState(nextState)
    } catch (error) {
      // The message was previously computed and then discarded, so enabling
      // push could fail — blocked permission, unsupported browser, expired
      // subscription — and the toggle would just quietly snap back with no
      // explanation. Surfacing it is the whole point of catching it.
      toast.error(error instanceof Error ? error.message : "Could not update browser push.")
      setBrowserState(await getBrowserNotificationState().catch(() => browserState))
    } finally {
      setBrowserBusy(false)
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
                <span className="rounded-full bg-brand-orange px-2 py-0.5 text-xs font-bold text-white">
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
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={() => void archiveAllRead()}
                disabled={!hasArchivableReadNotifications}
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
              >
                Archive all read
              </button>
          </header>

          <div className="w-full" aria-label="Notification filters">
            <div className="mb-2 rounded-2xl border border-brand-orange/20 bg-brand-orange-soft p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 pb-4 sm:pb-5">
                  <p className="text-[15px] font-bold text-neutral-900">Stay connected to alerts</p>
                  <p className="mt-1 text-[13px] leading-5 text-neutral-600">
                    Enable push to get timely updates, even when the tab is closed.
                  </p>
                  {!browserState.serverConfigured ? (
                    <p className="mt-1 text-[12px] font-semibold text-amber-700">Server Web Push keys are not configured yet.</p>
                  ) : null}
                  {browserState.config?.public_key_format_valid === false ? (
                    <p className="mt-1 text-[12px] font-semibold text-red-700">
                      Web Push public key is invalid. Decoded length: {browserState.config.public_key_decoded_length ?? "unknown"} · first byte: {browserState.config.public_key_first_byte ?? "unknown"}.
                    </p>
                  ) : null}
                  {browserState.config?.key_pair_valid === false ? (
                    <p className="mt-1 text-[12px] font-semibold text-red-700">
                      Web Push public/private keys do not match. Use the Public Key and Private Key from the same generated pair.
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={browserBusy || !browserState.supported || browserState.permission === "denied" || !browserState.serverConfigured}
                    onClick={() => void toggleBrowserPush()}
                    className="h-11 rounded-full bg-brand-orange px-4 text-[13px] font-bold text-white hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {browserBusy ? "Working" : browserState.subscribed ? "Disable push" : "Enable push"}
                  </button>
                </div>
              </div>
            </div>
            <div className="scrollbar-hide flex w-full gap-2 overflow-x-auto overscroll-x-contain py-3 [-webkit-overflow-scrolling:touch]">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={cn(
                    "min-h-11 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                    filter === item.value
                      ? "border-brand-orange bg-brand-orange text-white"
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
                  <div
                    key={item.id}
                    onClick={() => void openNotification(item)}
                    className={cn(
                      "flex w-full gap-3.5 px-4 py-4 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-orange",
                      !item.is_read && "bg-brand-orange-soft",
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
                          {item.display_title || item.title}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[12px] text-neutral-500">
                          {relativeTime(item.created_at)}
                        </span>
                      </span>
                      <span className="mt-1 block line-clamp-2 text-[14px] leading-6 text-neutral-600">
                        {notificationSnippet(item.display_body || item.body)}
                      </span>
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt=""
                          loading="lazy"
                          className="mt-3 h-24 w-full rounded-xl object-cover"
                        />
                      ) : null}
                      {item.safety_limited ? (
                        <span className="mt-3 block rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                          <span className="block text-[12px] font-bold tracking-wide text-red-800 uppercase">
                            Nearby safety alert
                          </span>
                          <span className="mt-1 block text-[13px] leading-5 text-red-950">
                            {item.safety_guidance || "Stay clear of the area and do not intervene."}
                          </span>
                          <span className="mt-1.5 block text-[11px] leading-4 text-red-800/70">
                            For privacy, the reporter's identity, exact location, and media are not shared.
                          </span>
                        </span>
                      ) : null}
                      {item.action_label && !item.safety_limited ? (
                        <span className="mt-2 block text-[12px] font-bold text-brand-orange">
                          {item.action_label}
                        </span>
                      ) : null}
                    </span>
                    {!item.is_read ? (
                      <span
                        className="mt-2 size-2 shrink-0 rounded-full bg-brand-orange"
                        aria-label="Unread"
                      />
                    ) : null}
                    <div className="flex shrink-0 flex-col gap-1">
                      {item.is_archived ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void unarchiveNotification(item.id)
                          }}
                          className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                          aria-label="Unarchive notification"
                          title="Unarchive"
                        >
                          <ArchiveIcon className="size-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void archiveNotification(item.id)
                          }}
                          className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                          aria-label="Archive notification"
                          title="Archive"
                        >
                          <ArchiveIcon className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteNotification(item.id)
                        }}
                        className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                        aria-label="Delete notification"
                        title="Delete"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                     </div>
                  </div>
                ))}
                {hasMore ? (
                  <div className="flex justify-center px-4 py-4">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      className="min-h-11 rounded-full border border-neutral-200 px-5 text-[13px] font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
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
      </ResidentContentGrid>
    </div>
  )
}