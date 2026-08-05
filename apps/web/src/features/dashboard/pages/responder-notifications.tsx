import { useEffect, useMemo, useState } from "react"
import {
  BellIcon,
  BellOffIcon,
  CheckCheckIcon,
  ClockIcon,
  RadioIcon,
  ShieldAlertIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  useNotifications,
  type NotificationItem,
} from "@/features/dashboard/components/notification-context"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"

/**
 * Responder-scoped notifications. Filters and copy are dispatch-centric —
 * assignments, backup broadcasts, shift reminders — rather than the resident
 * announcement inbox that the shared /dashboard/notifications page serves.
 */

type Filter = "all" | "unread" | "dispatch" | "backup" | "assignment" | "system"

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "dispatch", label: "Dispatch" },
  { value: "backup", label: "Backup" },
  { value: "assignment", label: "Assignment" },
  { value: "system", label: "System" },
]

const FILTER_STORAGE_KEY = "eboses:responder-notifications-filter"

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })

function categoryOf(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
  const type = (item.type ?? "").toLowerCase()
  if (type.startsWith("backup") || type.includes("backup_requested")) return "backup"
  if (type.startsWith("emergency_assigned") || type === "assignment" || type.includes("routed"))
    return "assignment"
  if (item.emergency_id || type.startsWith("emergency") || type === "dispatch_note") return "dispatch"
  return "system"
}

function IconFor({ item }: { item: NotificationItem }) {
  const category = categoryOf(item)
  if (category === "backup") return <RadioIcon className="size-4" />
  if (category === "assignment") return <UsersIcon className="size-4" />
  if (category === "dispatch") return <ShieldAlertIcon className="size-4" />
  return <BellIcon className="size-4" />
}

function relTime(iso: string) {
  const date = new Date(iso)
  return `${dateFmt.format(date)} · ${timeFmt.format(date)}`
}

export default function ResponderNotificationsPage() {
  usePageTitle("Notifications")
  const { notifications, loading, unreadCount, markAsRead, markAllAsRead, refresh } =
    useNotifications()

  const [filter, setFilter] = useState<Filter>(() => {
    if (typeof window === "undefined") return "all"
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY)
    return (FILTERS.find((entry) => entry.value === stored)?.value ?? "all") as Filter
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filter)
    }
  }, [filter])

  const [browserState, setBrowserState] = useState<BrowserNotificationState | null>(null)
  const [togglingPush, setTogglingPush] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getBrowserNotificationState()
      .then((state) => {
        if (!cancelled) setBrowserState(state)
      })
      .catch(() => {
        // Non-blocking — the push card just shows "unavailable" if we cannot read state.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pushEnabled = Boolean(browserState?.permission === "granted" && browserState?.subscribed)
  const pushSupported = Boolean(browserState?.supported)

  const visible = useMemo(() => {
    const rows = notifications.filter((item) => !item.is_archived)
    if (filter === "all") return rows
    if (filter === "unread") return rows.filter((item) => !item.is_read)
    return rows.filter((item) => categoryOf(item) === filter)
  }, [notifications, filter])

  async function togglePush() {
    setTogglingPush(true)
    try {
      if (pushEnabled) {
        await disableBrowserNotifications()
      } else {
        await enableBrowserNotifications()
      }
      const next = await getBrowserNotificationState()
      setBrowserState(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update push notifications.", {
        id: "push-toggle",
      })
    } finally {
      setTogglingPush(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Notifications</h1>
          <p className="text-body text-subtle-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread — dispatch, backup and assignment activity.`
              : "You're all caught up."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void markAllAsRead().catch(() =>
              toast.error("Could not mark all as read.", { id: "mark-all" }),
            )
          }}
          disabled={loading || unreadCount === 0}
          className="flex h-9 items-center gap-1.5 rounded-full border border-card-line px-3 text-body text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground disabled:opacity-50"
        >
          <CheckCheckIcon className="size-4" />
          Mark all read
        </button>
      </header>

      <section
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-3",
          pushEnabled ? "border-sos/30 bg-sos/10" : "border-card-line bg-card-raised",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            pushEnabled ? "bg-sos/20 text-sos" : "bg-card text-muted-foreground",
          )}
        >
          {pushEnabled ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-heading text-foreground">
            {pushEnabled ? "Push notifications on" : "Turn on push notifications"}
          </p>
          <p className="text-body text-subtle-foreground">
            Get dispatch alerts on your device — even when the browser tab is closed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void togglePush()}
          disabled={togglingPush || !pushSupported}
          className={cn(
            "shrink-0 rounded-full px-4 py-2 text-body font-semibold transition-colors disabled:opacity-60",
            pushEnabled
              ? "border border-card-line bg-card text-foreground hover:bg-card-raised"
              : "bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong",
          )}
        >
          {togglingPush ? "…" : pushEnabled ? "Disable" : "Enable"}
        </button>
      </section>

      <nav aria-label="Notification filters" className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((entry) => {
          const active = filter === entry.value
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => setFilter(entry.value)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-body font-semibold transition-colors",
                active
                  ? "border-brand-orange bg-brand-orange text-brand-orange-ink"
                  : "border-card-line text-muted-foreground hover:bg-card-raised hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          )
        })}
      </nav>

      <div className="flex-1">
        {loading && visible.length === 0 ? (
          <p className="py-10 text-center text-body text-subtle-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-line px-6 py-12 text-center">
            <ShieldAlertIcon className="size-7 text-subtle-foreground" />
            <p className="text-heading text-foreground">You're all caught up.</p>
            <p className="text-body text-subtle-foreground">
              Dispatch, backup and assignment updates will land here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!item.is_read) {
                      void markAsRead(item.id).catch(() => void refresh().catch(() => {}))
                    }
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                    item.is_read
                      ? "border-card-line bg-card hover:bg-card-raised"
                      : "border-sos/30 bg-sos/5 hover:bg-sos/10",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      item.is_read
                        ? "bg-card-raised text-muted-foreground"
                        : "bg-sos/20 text-sos",
                    )}
                  >
                    <IconFor item={item} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-heading text-foreground">
                        {item.display_title || item.title}
                      </p>
                      <span className="shrink-0 text-micro tabular-nums text-subtle-foreground">
                        {relTime(item.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-body leading-5 text-muted-foreground">
                      {item.display_body || item.body}
                    </p>
                    {!item.is_read ? (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-sos/20 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-sos">
                        <ClockIcon className="size-3" /> New
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
