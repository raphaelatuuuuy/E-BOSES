"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  BellIcon,
  BellOffIcon,
  CheckCheckIcon,
  FileTextIcon,
  MegaphoneIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { useNotifications, type NotificationItem } from "@/features/dashboard/components/notification-context"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"
import {
  notificationsPageFilter,
  openNotificationsPop,
} from "@/features/dashboard/components/notifications/notifications-event"

/**
 * ONE notifications surface, shared by every role.
 *
 * The resident page, the official pop-up and the responder pop-up all render
 * this same panel — identical structure, filter chips, push card, rows and
 * empty states — differing only in WHAT each role sees (the filter list, the
 * group mapping, the landing copy and where a row opens). Everything is
 * token-based, so it renders correctly on the light resident shell, the light
 * official shell and the dark responder console.
 */

export type NotificationsConfig = {
  /** Role-specific chips, e.g. All/Unread/Reports/Emergencies/Announcements. */
  filters: Array<{ value: string; label: string }>
  /** Buckets an item into one of the role's group filters (null → the neutral bucket). */
  groupOf: (item: NotificationItem) => string | null
  /** Defaults to group chips (emergency red, announcement amber, rest neutral). */
  iconFor?: (item: NotificationItem) => { Icon: LucideIcon; chipClass: string }
  filterStorageKey: string
  /** Shown when the Inbox All filter is empty and on the push card. */
  landingCopy: string
  /** What a row tap does AFTER the item is marked read. Role routes differ. */
  onOpen: (item: NotificationItem) => void
}

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return dateFmt.format(new Date(value))
}

/** Short preview for list rows — avoid full report/chat description. */
function snippet(text: string | null | undefined, max = 90): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 32 ? atWord : slice.trim()
  return `${base}...`
}

function defaultIconFor(item: NotificationItem): { Icon: LucideIcon; chipClass: string } {
  const type = (item.type ?? "").toLowerCase()
  const category = item.category ?? ""
  const isEmergency =
    category === "emergency" ||
    !!item.emergency_id ||
    type.startsWith("emergency") ||
    type === "witness_alert"
  const isAnnouncement = category === "announcement" || type === "announcement"
  if (isEmergency) return { Icon: AlertTriangleIcon, chipClass: "bg-neutral-100 text-sos" }
  if (isAnnouncement) return { Icon: MegaphoneIcon, chipClass: "bg-neutral-100 text-neutral-600" }
  return { Icon: FileTextIcon, chipClass: "bg-neutral-100 text-neutral-700" }
}

/**
 * The one shared notifications panel.
 *
 * Fills its parent both as a full page column (resident notifications page)
 * and as a Dialog/Sheet body (official + responder pop-ups). Scroll
 * containers are wheel-scrollable but the scrollbars are hidden.
 */
export function NotificationsPanel({
  config,
  onBack,
  onClose,
  onLoadMore,
  hasMore,
  loadingMore,
  initialFilter,
  initialView,
  extraItems,
  variant = "panel",
}: {
  config: NotificationsConfig
  onBack?: () => void
  onClose?: () => void
  /**
   * `sheet` drops this panel's own header and lets SheetDialog carry the
   * title, back arrow and X — the same chrome the report flow uses. Mark all
   * read / Archive read move into the body as soft rows.
   */
  variant?: "panel" | "sheet"
  /** Resident page pagination — hidden when omitted. */
  onLoadMore?: () => Promise<unknown>
  hasMore?: boolean
  loadingMore?: boolean
  /** First-run filter override (e.g. a `?type=` URL param); falls back to storage. */
  initialFilter?: string
  /** First-run view override — the Archived tab (e.g. `?type=archived`). */
  initialView?: "inbox" | "archived"
  /** Resident page's paginated tail, merged with the context list. */
  extraItems?: NotificationItem[]
}) {
  const {
    notifications,
    loading,
    unreadCount,
    loadError,
    markAsRead,
    markAllAsRead,
    archiveAllRead,
    refresh,
  } = useNotifications()

  const [view, setView] = useState<"inbox" | "archived">(
    () =>
      initialView ?? (initialFilter === "archived" ? "archived" : "inbox"),
  )

  const [filter, setFilter] = useState(() => {
    if (typeof window === "undefined") return initialFilter ?? "all"
    const fromUrl =
      initialFilter &&
      initialFilter !== "archived" &&
      config.filters.some((entry) => entry.value === initialFilter)
        ? initialFilter
        : null
    const stored = window.localStorage.getItem(config.filterStorageKey)
    return fromUrl ?? config.filters.find((entry) => entry.value === stored)?.value ?? "all"
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(config.filterStorageKey, filter)
    }
  }, [filter, config.filterStorageKey])

  const [browserState, setBrowserState] = useState<BrowserNotificationState>({
    supported: true,
    permission: "default",
    serverConfigured: false,
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
        if (state.serverConfigured || state.subscribed) {
          setBrowserState(state)
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      setBrowserState(await getBrowserNotificationState().catch(() => browserStateRef.current))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const merged = useMemo(() => {
    const byId = new Map<number, NotificationItem>()
    for (const item of [...(extraItems ?? []), ...notifications]) byId.set(item.id, item)
    return [...byId.values()].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )
  }, [notifications, extraItems])

  const visible = useMemo(() => {
    const rows =
      view === "archived"
        ? merged.filter((item) => item.is_archived)
        : merged.filter((item) => !item.is_archived)
    if (filter === "all") return rows
    if (filter === "unread") return rows.filter((item) => !item.is_read)
    return rows.filter((item) => config.groupOf(item) === filter)
  }, [merged, filter, config, view])

  const hasArchivableReadNotifications = useMemo(
    () => notifications.some((item) => item.is_read && !item.is_archived),
    [notifications],
  )

  async function archiveItem(item: NotificationItem) {
    try {
      await apiRequest(`/notifications/${item.id}/archive/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: !item.is_archived }),
      })
      await refresh()
    } catch {
      toast.error("Could not update this notification.", { id: "notif-archive" })
    }
  }

  async function deleteItem(item: NotificationItem) {
    if (!window.confirm("Delete this notification permanently?")) return
    try {
      await apiRequest(`/notifications/${item.id}/`, { method: "DELETE" })
      await refresh()
    } catch {
      toast.error("Could not delete this notification.", { id: "notif-delete" })
    }
  }

  async function toggleBrowserPush() {
    setBrowserBusy(true)
    try {
      if (browserState.subscribed) await disableBrowserNotifications()
      else await enableBrowserNotifications()
      setBrowserState(await getBrowserNotificationState())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update browser push.")
      setBrowserState(await getBrowserNotificationState().catch(() => browserState))
    } finally {
      setBrowserBusy(false)
    }
  }

  async function openItem(item: NotificationItem) {
    if (!item.is_read) {
      await markAsRead(item.id).catch(() => void refresh().catch(() => {}))
    }
    onClose?.()
    // Rows whose action_url points at the notifications page open the pop-up
    // with that filter instead of leaving the current surface (the page still
    // exists for deep links).
    const pageFilter = notificationsPageFilter(item.action_url)
    if (pageFilter) {
      openNotificationsPop(pageFilter)
      return
    }
    config.onOpen(item)
  }

  const iconFor = config.iconFor ?? defaultIconFor

  const filterLabel = config.filters.find((entry) => entry.value === filter)?.label ?? "matching"
  const isEmpty = visible.length === 0
  const emptyTitle = isEmpty
    ? view === "archived"
      ? "Nothing archived yet."
      : filter === "all"
        ? notifications.length === 0
          ? "You're all caught up."
          : "No active notifications."
        : filter === "unread"
          ? "No unread notifications."
          : `No ${filterLabel.toLowerCase()} notifications right now.`
    : null
  const emptySub = isEmpty
    ? view === "archived"
      ? "Notifications you archive will go here."
      : filter === "all"
        ? notifications.length === 0
          ? config.landingCopy
          : "Check back later."
        : "Check back later."
    : null

  /**
   * Sheet chrome: one segmented Inbox/Archived control and a single quiet
   * "Mark all read". Archive-read stays on the full page — a pop-up should not
   * carry every bulk action.
   */
  const sheetToolbar = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div
        role="tablist"
        aria-label="Notification views"
        className="flex items-center gap-0.5 rounded-full bg-neutral-100 p-0.5"
      >
        {(["inbox", "archived"] as const).map((value) => {
          const active = view === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(value)}
              className={cn(
                "h-8 rounded-full px-3.5 text-[14px] font-semibold transition-colors",
                active
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900",
              )}
            >
              {value === "inbox" ? "Inbox" : "Archived"}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          void markAllAsRead().catch(() =>
            toast.error("Could not mark all as read.", { id: "mark-all" }),
          )
        }}
        disabled={loading || unreadCount === 0}
        className="shrink-0 text-[14px] font-semibold text-neutral-600 transition-colors hover:text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-300"
      >
        Mark all read
      </button>
    </div>
  )

  return (
    <div className={cn("flex w-full flex-col", variant === "sheet" ? "" : "h-full min-h-0")}>
      {variant === "sheet" ? sheetToolbar : null}
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-card-line px-3 py-2.5 md:py-3",
          variant === "sheet" && "hidden",
        )}
      >
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-card-raised"
          >
            <ArrowLeftIcon className="size-5" />
          </button>
        ) : null}
        <span className="text-heading font-semibold text-foreground">Notifications</span>
        {unreadCount > 0 ? (
          <span className="flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10.5px] font-semibold leading-none text-brand-orange-ink tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              void markAllAsRead().catch(() =>
                toast.error("Could not mark all as read.", { id: "mark-all" }),
              )
            }}
            disabled={loading || unreadCount === 0}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-card-line px-3 text-body font-semibold text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground disabled:opacity-50"
          >
            <CheckCheckIcon className="size-4" />
            <span className="hidden sm:inline">Mark all read</span>
            <span className="sm:hidden">Read</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void archiveAllRead()
                .then(() => toast.success("Moved read notifications to the archive."))
                .catch(() =>
                  toast.error("Could not archive read notifications.", { id: "archive-all" }),
                )
            }}
            disabled={loading || !hasArchivableReadNotifications}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-card-line px-3 text-body font-semibold text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground disabled:opacity-50"
          >
            <ArchiveIcon className="size-4" />
            <span className="hidden sm:inline">Archive read</span>
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-card-raised"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      {/* In a sheet the dialog body is already the scroll container — a second
          one here is what produced two scrollbars side by side. */}
      <div
        className={cn(
          "min-h-0",
          variant === "sheet"
            ? ""
            : "scrollbar-hide flex-1 overflow-y-auto overscroll-contain px-3 py-3 md:px-6",
        )}
      >
        <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-3">
          <section
            className={cn(
              "flex items-center gap-3 p-3",
              variant === "sheet"
                ? "rounded-[18px] border border-neutral-200"
                : cn(
                    "rounded-2xl border",
                    browserState.subscribed
                      ? "border-brand-orange/40 bg-brand-orange/5"
                      : "border-card-line bg-card-raised",
                  ),
              // Once push is on there is nothing to do here — in a pop-up that
              // row is pure noise above the thing you opened it for.
              variant === "sheet" && browserState.subscribed && "hidden",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                variant === "sheet"
                  ? "text-neutral-500"
                  : browserState.subscribed
                    ? "bg-brand-orange/15 text-brand-orange"
                    : "text-muted-foreground",
              )}
            >
              {browserState.subscribed ? (
                <BellIcon className="size-4" />
              ) : (
                <BellOffIcon className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-semibold",
                  variant === "sheet"
                    ? "text-[15px] text-neutral-900"
                    : "text-[15px] text-foreground",
                )}
              >
                {browserState.subscribed ? "Push notifications on" : "Turn on push notifications"}
              </p>
              {!browserState.serverConfigured ? (
                <p className="mt-1 text-[12px] font-semibold text-neutral-500">
                  Server Web Push keys are not configured yet.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={
                browserBusy ||
                !browserState.supported ||
                browserState.permission === "denied" ||
                !browserState.serverConfigured
              }
              onClick={() => void toggleBrowserPush()}
              // One button, one shape, whichever way it is pointing — only the
              // label changes between Enable and Disable.
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                variant === "sheet"
                  ? "border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-brand-orange-ink"
                  : browserState.subscribed
                    ? "border-card-line text-foreground hover:bg-card-raised"
                    : "border-brand-orange bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong",
              )}
            >
              {browserBusy ? "Working…" : browserState.subscribed ? "Disable" : "Enable"}
            </button>
          </section>

          <div
            role="tablist"
            aria-label="Notification views"
            className={cn(
              "flex w-fit items-center gap-0.5 rounded-full border border-card-line bg-card-raised p-0.5",
              // The sheet toolbar already carries this control.
              variant === "sheet" && "hidden",
            )}
          >
            {(["inbox", "archived"] as const).map((value) => {
              const active = view === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(value)}
                  className={cn(
                    "h-8 rounded-full px-4 text-body font-semibold transition-colors",
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "inbox" ? "Inbox" : "Archived"}
                </button>
              )
            })}
          </div>

          <nav
            aria-label="Notification filters"
            className="scrollbar-hide flex w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 pt-0.5"
          >
            {config.filters.map((entry) => {
              const active = filter === entry.value
              return (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setFilter(entry.value)}
                  aria-pressed={active}
                  className={cn(
                    "shrink-0 rounded-full border px-3.5 py-1.5 text-body font-semibold transition-colors",
                    active
                      ? "border-brand-orange bg-brand-orange text-brand-orange-ink"
                      : variant === "sheet"
                        ? "border-neutral-200 text-neutral-600 hover:border-brand-orange hover:text-brand-orange"
                        : "border-card-line text-muted-foreground hover:bg-card-raised hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              )
            })}
          </nav>

          {loading && visible.length === 0 ? (
            <div
              className="divide-y divide-card-line overflow-hidden rounded-xl border border-card-line"
              aria-label="Loading notifications"
            >
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-16 animate-pulse bg-card-raised" />
              ))}
            </div>
          ) : loadError && visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-body font-semibold text-foreground">
                Could not load notifications.
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded-full border border-card-line px-4 py-2 text-body font-semibold text-foreground transition-colors hover:bg-card-raised"
              >
                Try again
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-card-raised text-muted-foreground">
                <BellIcon className="size-5" />
              </span>
              <p className="mt-2 text-[15px] font-semibold text-foreground">{emptyTitle}</p>
              <p className="mt-1 max-w-sm text-[13px] leading-5 text-subtle-foreground">
                {emptySub}
              </p>
            </div>
          ) : (
            <ul
              className={cn(
                "overflow-hidden border",
                variant === "sheet"
                  ? "divide-y divide-neutral-200 rounded-[18px] border-neutral-200 bg-white"
                  : "divide-y divide-card-line rounded-xl border-card-line bg-card",
              )}
            >
              {visible.map((item) => {
                const { Icon, chipClass } = iconFor(item)
                const body = snippet(item.display_body || item.body)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "relative",
                      !item.is_read &&
                        (variant === "sheet" ? "bg-neutral-50" : "bg-brand-orange/5"),
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className="flex w-full items-start gap-3.5 px-3.5 py-3.5 text-left transition-colors hover:bg-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-orange"
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          chipClass,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 pr-8">
                        <span className="flex items-start justify-between gap-3">
                          <span className="text-[15px] font-semibold text-foreground">
                            {item.display_title || item.title}
                          </span>
                          <span className="shrink-0 pt-0.5 text-[12px] text-muted-foreground">
                            {relativeTime(item.created_at)}
                          </span>
                        </span>
                        {body ? (
                          <span className="mt-0.5 block line-clamp-2 text-[13.5px] leading-5 text-subtle-foreground">
                            {body}
                          </span>
                        ) : null}
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            loading="lazy"
                            className="mt-2 h-24 w-full rounded-xl border border-card-line object-cover"
                          />
                        ) : null}
                        {item.safety_limited ? (
                          <span className="mt-2 block rounded-lg border border-sos/30 bg-sos/10 px-3 py-2.5">
                            <span className="block text-[12px] font-bold tracking-wide text-sos">
                              Nearby safety alert
                            </span>
                            <span className="mt-1 block text-[13px] leading-5 text-neutral-800">
                              {item.safety_guidance ||
                                "Stay clear of the area and do not intervene."}
                            </span>
                            <span className="mt-1.5 block text-[11px] leading-4 text-sos/70">
                              For privacy, the reporter's identity, exact location, and media are
                              not shared.
                            </span>
                          </span>
                        ) : null}
                        {item.action_label && !item.safety_limited ? (
                          <span
                            className={cn(
                              "mt-1.5 block text-[12px] font-bold",
                              variant === "sheet"
                                ? "text-neutral-600 underline underline-offset-2"
                                : "text-brand-orange",
                            )}
                          >
                            {item.action_label}
                          </span>
                        ) : null}
                      </span>
                      {!item.is_read ? (
                        <span
                          className={cn(
                            "mt-2 size-2 shrink-0 rounded-full",
                            variant === "sheet" ? "bg-neutral-900" : "bg-brand-orange",
                          )}
                          aria-label="Unread"
                        />
                      ) : null}
                    </button>
                    <span className="absolute inset-y-0 right-0 z-10 flex shrink-0 flex-col items-center justify-center gap-1 bg-gradient-to-l from-card via-card/70 to-transparent pr-2">
                      <button
                        type="button"
                        onClick={() => void archiveItem(item)}
                        aria-label={
                          item.is_archived ? "Restore notification" : "Archive notification"
                        }
                        title={item.is_archived ? "Restore notification" : "Archive notification"}
                        className="flex size-9 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-card-raised hover:text-foreground"
                      >
                        {item.is_archived ? (
                          <ArchiveRestoreIcon className="size-4" />
                        ) : (
                          <ArchiveIcon className="size-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteItem(item)}
                        aria-label="Delete notification"
                        title="Delete notification"
                        className="flex size-9 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-sos/15 hover:text-sos"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {onLoadMore && hasMore ? (
            <div className="flex justify-center px-4 py-4">
              <button
                type="button"
                onClick={() => void onLoadMore()}
                disabled={loadingMore}
                className="min-h-11 rounded-full border border-card-line px-5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load older notifications"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}