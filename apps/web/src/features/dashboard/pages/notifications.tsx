import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  BellIcon,
  ChevronLeftIcon,
  FileTextIcon,
  MegaphoneIcon,
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
import { appInstalledStandalone } from "@/lib/pwa"

type Filter = "all" | "unread" | "reports" | "emergencies" | "announcements"

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reports", label: "Reports" },
  { value: "emergencies", label: "Emergencies" },
  { value: "announcements", label: "Announcements" },
]

function typeGroup(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
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
  if (type === "announcements" || type === "emergencies" || type === "reports" || type === "unread") return type
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
  const [testPushBusy, setTestPushBusy] = useState(false)
  const [testPushResult, setTestPushResult] = useState<string | null>(null)
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null)
  const [installedStandalone, setInstalledStandalone] = useState(appInstalledStandalone())

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
      setBrowserState(await getBrowserNotificationState().catch(() => browserState))
    })()
    return () => { cancelled = true }
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event)
    }
    function onInstalled() {
      setInstalledStandalone(true)
      setInstallPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onInstalled)
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
    if (item.safety_limited || item.type === "witness_alert") return
    if (item.action_url) {
      navigate(item.action_url)
      return
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

  async function toggleBrowserPush() {
    setBrowserBusy(true)
    setTestPushResult(null)
    try {
      if (browserState.subscribed) await disableBrowserNotifications()
      else await enableBrowserNotifications()
      const nextState = await getBrowserNotificationState()
      setBrowserState(nextState)
      setTestPushResult(
        nextState.subscribed
          ? "Push enabled for this browser. Click Send test to verify closed-tab delivery."
          : "Push disabled for this browser.",
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update browser push."
      setTestPushResult(message)
      setBrowserState(await getBrowserNotificationState().catch(() => browserState))
    } finally {
      setBrowserBusy(false)
    }
  }

  async function sendTestPush() {
    setTestPushBusy(true)
    setTestPushResult(null)
    try {
      const result = await apiRequest<{
        push_result?: {
          status?: string
          failure_count?: number
          failure_details?: Array<{ status_code?: number | null; reason?: string; message?: string; type?: string; push_service?: string }>
          push_services?: string[]
          config?: {
            key_pair_valid?: boolean | null
            subject_valid?: boolean
          }
        }
        active_subscriptions?: number
      }>("/notifications/browser-push/test/", { method: "POST" })
      const status = result.push_result?.status || "unknown"
      const subscriptions = result.active_subscriptions ?? 0
      const failures = result.push_result?.failure_count ?? 0
      const failure = result.push_result?.failure_details?.[0]
      const pushService = failure?.push_service || result.push_result?.push_services?.[0] || ""
      const failureText = failure
        ? ` ${failure.status_code ? `${failure.status_code} ` : ""}${failure.reason || failure.type || ""}${pushService ? ` · ${pushService}` : ""}${failure.message ? ` — ${failure.message}` : ""}`.trim()
        : ""
      const configText =
        result.push_result?.config?.key_pair_valid === false
          ? " VAPID key pair is invalid/mismatched."
          : result.push_result?.config?.subject_valid === false
            ? " VAPID subject is invalid."
            : ""
      setTestPushResult(
        status === "delivered" || status === "partial"
          ? `Server sent push: ${status}${failures ? ` (${failures} failed)` : ""}. If no desktop popup appears, check Windows/browser notification settings.`
          : `Push not shown because server returned: ${status}${failureText ? ` (${failureText})` : ""}. Active subscriptions: ${subscriptions}.${configText}`,
      )
      setBrowserState(await getBrowserNotificationState())
      await refresh()
    } catch (error) {
      setTestPushResult(error instanceof Error ? error.message : "Could not send test notification.")
    } finally {
      setTestPushBusy(false)
    }
  }

  async function installApp() {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> }) | null
    if (!prompt?.prompt) return
    await prompt.prompt()
    await prompt.userChoice?.catch(() => null)
    setInstalledStandalone(appInstalledStandalone())
    setInstallPrompt(null)
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
            <div className="mb-2 rounded-2xl border border-[#ffd8c2] bg-[#fff7f2] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-neutral-900">Install E-Boses and enable background alerts</p>
                  <p className="mt-1 text-[13px] leading-5 text-neutral-600">
                    Push notifications work even when the browser tab is closed after this device is subscribed.
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
                    className="h-10 rounded-full bg-[#ff6a1a] px-4 text-[13px] font-bold text-white hover:bg-[#e85f17] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {browserBusy ? "Working" : browserState.subscribed ? "Disable push" : "Enable push"}
                  </button>
                  <button
                    type="button"
                    disabled={testPushBusy || !browserState.supported || browserState.permission !== "granted" || !browserState.serverConfigured || !browserState.subscribed}
                    onClick={() => void sendTestPush()}
                    className="h-10 rounded-full border border-[#ff6a1a] bg-white px-4 text-[13px] font-bold text-[#ff6a1a] hover:bg-[#fff0e8] disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400 disabled:opacity-60"
                  >
                    {testPushBusy ? "Sending" : "Send test"}
                  </button>
                  <button
                    type="button"
                    disabled={installedStandalone || !installPrompt}
                    onClick={() => void installApp()}
                    className="h-10 rounded-full border border-neutral-300 bg-white px-4 text-[13px] font-bold text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {installedStandalone ? "Installed" : installPrompt ? "Install app" : "Add to home screen"}
                  </button>
                </div>
              </div>
              {testPushResult ? (
                <p className="mt-3 rounded-xl border border-[#ffd8c2] bg-white px-3 py-2 text-[12px] font-semibold leading-5 text-neutral-700">
                  {testPushResult}
                </p>
              ) : null}
            </div>
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
                            For privacy, the reporter’s identity, exact location, and media are not shared.
                          </span>
                        </span>
                      ) : null}
                      {item.action_label && !item.safety_limited ? (
                        <span className="mt-2 block text-[12px] font-bold text-[#ff6a1a]">
                          {item.action_label}
                        </span>
                      ) : null}
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
      </ResidentContentGrid>
    </div>
  )
}
