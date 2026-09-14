"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  BellRingIcon,
  CheckCircle2Icon,
  InboxIcon,
  CheckCheckIcon,
  LoaderCircleIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import {
  useNotifications,
  type NotificationItem,
} from "@/features/dashboard/components/notification-context"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import {
  browserNotificationErrorMessage,
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  showBrowserNotificationFeedback,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  notificationsPageFilter,
  openNotificationsPop,
} from "@/features/dashboard/components/notifications/notifications-event"
import { notificationIconFor } from "@/features/dashboard/components/notifications/notification-visuals"

type NotificationView = "inbox" | "archived"
const notificationViewEvent = "eboses:notification-view"
const holdTimers = new WeakMap<HTMLElement, number>()

function NotificationImage({
  item,
  onPreview,
}: {
  item: NotificationItem
  onPreview: (items: MediaPreviewItem[]) => void
}) {
  const images = item.images?.length
    ? item.images
    : item.image_url
      ? [
          {
            url: item.image_url,
            filename: "Notification photo",
            mime_type: "image",
          },
        ]
      : []
  if (!images.length) return null

  const previewItems = images.map((image) =>
    toMediaPreviewItem(image.url, image.filename, image.mime_type)
  )

  return (
    <button
      type="button"
      aria-label={`Preview ${images.length === 1 ? "photo" : `${images.length} photos`}`}
      onClick={(event) => {
        event.stopPropagation()
        onPreview(previewItems)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="group relative mt-2 block w-full overflow-hidden rounded-lg border border-neutral-200 text-left empty:hidden focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:outline-none"
    >
      <AuthenticatedMediaImage
        src={images[0].url}
        alt={`Photo attached to ${item.display_title || item.title}`}
        className="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        hideOnError
      />
      {images.length > 1 ? (
        <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
          1 / {images.length}
        </span>
      ) : null}
    </button>
  )
}

export function NotificationViewActions({
  initialView = "inbox",
  dark = false,
}: {
  initialView?: NotificationView
  dark?: boolean
}) {
  const [view, setView] = useState<NotificationView>(initialView)
  return (
    <div
      role="tablist"
      aria-label="Notification views"
      className="flex items-center gap-0.5 rounded-full bg-neutral-100 p-1"
    >
      {(
        [
          ["inbox", InboxIcon, "Inbox"],
          ["archived", ArchiveIcon, "Archived"],
        ] as const
      ).map(([value, Icon, label]) => {
        const active = view === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => {
              setView(value)
              window.dispatchEvent(
                new CustomEvent(notificationViewEvent, { detail: value })
              )
            }}
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-colors",
              dark
                ? active
                  ? "bg-brand-orange/15 text-brand-orange shadow-sm"
                  : "text-nav-muted hover:bg-brand-orange/10 hover:text-brand-orange"
                : active
                  ? "bg-white/70 text-neutral-900 shadow-sm"
                  : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900"
            )}
          >
            <Icon className="size-[18px]" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * ONE notifications surface, shared by every role.
 *
 * The resident page, the official pop-up and the responder pop-up all render
 * this same panel — identical structure, filter chips, push card, rows and
 * empty states — differing only in WHAT each role sees (the filter list, the
 * group mapping, the landing copy and where a row opens). Everything is
 * token-based, so it renders correctly on the light resident, official and
 * responder shells.
 */

export type NotificationsConfig = {
  /** Contextual heading for the role using this shared surface. */
  heading?: string
  /** The available read-state filters for the notification list. */
  filters: Array<{ value: string; label: string }>
  /** Buckets an item into one of the role's group filters (null → the neutral bucket). */
  groupOf: (item: NotificationItem) => string | null
  /** Defaults to group chips (emergency red, announcement amber, rest neutral). */
  iconFor?: (item: NotificationItem) => { Icon: LucideIcon; chipClass: string }
  /** Legacy compatibility switch; responder notifications now stay light. */
  dark?: boolean
  filterStorageKey: string
  /** Shown when the Inbox All filter is empty and on the push card. */
  landingCopy: string
  /** What a row tap does AFTER the item is marked read. Role routes differ. */
  onOpen: (item: NotificationItem) => void
}

const dateFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
})

function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  )
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return dateFmt.format(new Date(value))
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
  const { user } = useAuthSession()

  const [view, setView] = useState<"inbox" | "archived">(
    () => initialView ?? (initialFilter === "archived" ? "archived" : "inbox")
  )
  const [browserNotificationState, setBrowserNotificationState] =
    useState<BrowserNotificationState | null>(null)
  const [changingBrowserNotifications, setChangingBrowserNotifications] =
    useState(false)
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewItem[] | null>(
    null
  )

  useEffect(() => {
    let active = true
    void getBrowserNotificationState()
      .then((nextState) => {
        if (active) setBrowserNotificationState(nextState)
      })
      .catch(() => {
        if (active) {
          setBrowserNotificationState({
            supported: false,
            permission: "unsupported",
            serverConfigured: false,
            subscribed: false,
          })
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function onViewChange(event: Event) {
      const next = (event as CustomEvent<NotificationView>).detail
      if (next === "inbox" || next === "archived") setView(next)
    }
    window.addEventListener(notificationViewEvent, onViewChange)
    return () => window.removeEventListener(notificationViewEvent, onViewChange)
  }, [])

  const [filter, setFilter] = useState(() => {
    if (typeof window === "undefined") {
      return initialFilter === "read" || initialFilter === "unread"
        ? initialFilter
        : "unread"
    }
    const fromUrl =
      initialFilter === "read" || initialFilter === "unread"
        ? initialFilter
        : null
    const stored = window.localStorage.getItem(config.filterStorageKey)
    return (
      fromUrl ?? (stored === "read" || stored === "unread" ? stored : "unread")
    )
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(config.filterStorageKey, filter)
    }
  }, [filter, config.filterStorageKey])

  const merged = useMemo(() => {
    const byId = new Map<number, NotificationItem>()
    for (const item of [...(extraItems ?? []), ...notifications])
      byId.set(item.id, item)
    return [...byId.values()].sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    )
  }, [notifications, extraItems])

  const visible = useMemo(() => {
    const rows =
      view === "archived"
        ? merged.filter((item) => item.is_archived)
        : merged.filter((item) => !item.is_archived)
    if (filter === "unread") return rows.filter((item) => !item.is_read)
    if (filter === "read") return rows.filter((item) => item.is_read)
    return rows
  }, [merged, filter, view])

  const hasArchivableReadNotifications = useMemo(
    () => notifications.some((item) => item.is_read && !item.is_archived),
    [notifications]
  )

  async function archiveItem(item: NotificationItem) {
    try {
      await apiRequest(`/notifications/${item.id}/archive/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: !item.is_archived }),
      }, { csrf: true })
      await refresh()
    } catch {
      toast.error("Could not update this notification.", {
        id: "notif-archive",
      })
    }
  }

  async function deleteItem(item: NotificationItem) {
    try {
      await apiRequest(
        `/notifications/${item.id}/`,
        { method: "DELETE" },
        { csrf: true }
      )
      await refresh()
    } catch {
      toast.error("Could not delete this notification.", { id: "notif-delete" })
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

  async function enableNotifications() {
    setChangingBrowserNotifications(true)
    try {
      await enableBrowserNotifications()
      const nextState = await getBrowserNotificationState()
      setBrowserNotificationState(nextState)
      await showBrowserNotificationFeedback(user?.lastName, true).catch(
        () => false
      )
      toast.success("Browser notifications enabled on this device.")
    } catch (error) {
      toast.error(browserNotificationErrorMessage(error, "enable"))
    } finally {
      setChangingBrowserNotifications(false)
    }
  }

  async function disableNotifications() {
    setChangingBrowserNotifications(true)
    try {
      await showBrowserNotificationFeedback(user?.lastName, false).catch(
        () => false
      )
      await disableBrowserNotifications()
      const nextState = await getBrowserNotificationState()
      setBrowserNotificationState(nextState)
      toast.success("Browser notifications disabled on this device.")
    } catch (error) {
      toast.error(browserNotificationErrorMessage(error, "disable"))
    } finally {
      setChangingBrowserNotifications(false)
    }
  }

  const iconFor = config.iconFor ?? notificationIconFor
  const darkTheme = Boolean(config.dark)
  const browserNotificationsEnabled = Boolean(
    browserNotificationState?.supported &&
    browserNotificationState.permission === "granted" &&
    browserNotificationState.subscribed
  )
  const browserNotificationsUnavailable = Boolean(
    browserNotificationState &&
    (!browserNotificationState.supported ||
      !browserNotificationState.serverConfigured)
  )
  const browserNotificationsBlocked =
    browserNotificationState?.permission === "denied"
  const browserNotificationButtonLabel = browserNotificationsEnabled
    ? "Disable"
    : "Enable"

  const isEmpty = visible.length === 0
  const emptyTitle = isEmpty
    ? view === "archived"
      ? "Nothing archived yet."
      : filter === "unread"
        ? "No unread notifications."
        : "No read notifications right now."
    : null
  const emptySub = isEmpty
    ? view === "archived"
      ? "Notifications you archive will go here."
      : "Check back later."
    : null

  /**
   * Sheet chrome: one segmented Inbox/Archived control and a single quiet
   * "Mark all read". Archive-read stays on the full page — a pop-up should not
   * carry every bulk action.
   */
  const sheetToolbar = null

  return (
    <div
      className={cn(
        "ops-plain flex w-full flex-col",
        variant === "sheet" ? "" : "h-full min-h-0"
      )}
    >
      {variant === "sheet" ? sheetToolbar : null}
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-card-line px-3 py-2.5 md:py-3",
          variant === "sheet" && "hidden"
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
        <span className="text-heading font-semibold text-foreground">
          {config.heading ?? "Updates"}
        </span>
        {unreadCount > 0 ? (
          <span className="shrink-0 text-[11px] leading-none font-semibold text-current tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              void markAllAsRead().catch(() =>
                toast.error("Could not mark all as read.", { id: "mark-all" })
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
                .then(() =>
                  toast.success("Moved read notifications to the archive.")
                )
                .catch(() =>
                  toast.error("Could not archive read notifications.", {
                    id: "archive-all",
                  })
                )
            }}
            disabled={loading || !hasArchivableReadNotifications}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-card-line px-3 text-body font-semibold text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground disabled:opacity-50"
          >
            <ArchiveIcon className="size-4" />
            <span className="hidden sm:inline">Archive read</span>
          </button>
          <div
            role="tablist"
            aria-label="Notification views"
            className="flex items-center gap-0.5"
          >
            {(
              [
                ["inbox", InboxIcon, "Inbox"],
                ["archived", ArchiveIcon, "Archived"],
              ] as const
            ).map(([value, Icon, label]) => {
              const active = view === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={label}
                  title={label}
                  onClick={() => setView(value)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-card-raised text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-card-raised hover:text-foreground"
                  )}
                >
                  <Icon className="size-[18px]" />
                </button>
              )
            })}
          </div>
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
            : "scrollbar-hide flex-1 overflow-y-auto overscroll-contain px-3 py-3 md:px-6"
        )}
      >
        <div className="mx-auto flex max-w-3xl min-w-0 flex-col gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
                  <BellRingIcon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="text-[14px] font-semibold text-neutral-900">
                  Push notification
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void (browserNotificationsEnabled
                    ? disableNotifications()
                    : enableNotifications())
                }
                disabled={
                  changingBrowserNotifications ||
                  (!browserNotificationsEnabled &&
                    (browserNotificationsUnavailable ||
                      browserNotificationsBlocked ||
                      !browserNotificationState))
                }
                className={cn(
                  "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:cursor-default disabled:opacity-60",
                  browserNotificationsEnabled
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : "border border-neutral-200 text-neutral-900 hover:bg-neutral-50"
                )}
              >
                {changingBrowserNotifications || !browserNotificationState ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : browserNotificationsEnabled ? (
                  <CheckCircle2Icon className="size-3.5" />
                ) : null}
                {browserNotificationButtonLabel}
              </button>
            </div>
          </div>

          <nav
            aria-label="Notification filters"
            className="scrollbar-hide flex w-full gap-1 overflow-x-auto overscroll-x-contain rounded-full bg-neutral-100 p-1"
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
                    "min-w-0 flex-1 rounded-full px-2 py-2 text-center text-[clamp(10px,1.8vw,14px)] leading-tight font-semibold transition-colors",
                    darkTheme
                      ? active
                        ? "bg-brand-orange/15 text-brand-orange shadow-sm"
                        : "text-nav-muted hover:bg-brand-orange/10 hover:text-brand-orange"
                      : active
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:bg-white/60 hover:text-neutral-900"
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
              <span className="flex size-12 items-center justify-center text-neutral-800">
                <InboxIcon className="size-6" />
              </span>
              <p className="mt-2 text-[15px] font-semibold text-neutral-950">
                {emptyTitle}
              </p>
              <p className="mt-1 max-w-sm text-[13px] leading-5 text-neutral-600">
                {emptySub}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((item) => {
                const configuredIcon = iconFor(item)
                const urgent = item.priority === "urgent"
                const Icon = configuredIcon.Icon
                const iconClass = configuredIcon.chipClass
                const iconColorClass = iconClass.replace(/\bbg-\S+/g, "").trim()
                const body = (item.display_body || item.body || "")
                  .replace(/\s+/g, " ")
                  .trim()
                const hasMedia = Boolean(item.images?.length || item.image_url)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "relative touch-pan-y overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-colors",
                      !item.is_read &&
                        (urgent ? "border-sos/30 bg-sos/5" : "bg-neutral-50"),
                      urgent && !item.is_read
                        ? "hover:bg-sos/10"
                        : darkTheme
                          ? "hover:bg-brand-orange/10"
                          : "hover:bg-neutral-100"
                    )}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        if (event.currentTarget.dataset.held === "true") {
                          delete event.currentTarget.dataset.held
                          event.preventDefault()
                          return
                        }
                        void openItem(item)
                      }}
                      className={cn(
                        "flex w-full items-start gap-2.5 bg-transparent px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none focus-visible:ring-inset",
                        hasMedia ? "pb-1" : "",
                      )}
                      onPointerDown={(event) => {
                        document
                          .querySelectorAll<HTMLElement>(
                            "[data-notification-actions]"
                          )
                          .forEach((actions) => {
                            actions.style.opacity = ""
                            actions.style.transform = ""
                            actions.style.pointerEvents = ""
                            actions.style.left = ""
                            actions.style.right = ""
                            actions.style.background = ""
                          })
                        event.currentTarget.setPointerCapture(event.pointerId)
                        event.currentTarget.dataset.swipeStart = String(
                          event.clientX
                        )
                        delete event.currentTarget.dataset.held
                        const target = event.currentTarget
                        holdTimers.set(
                          target,
                          window.setTimeout(() => {
                            const actions =
                              target.parentElement?.querySelector<HTMLElement>(
                                "[data-notification-actions]"
                              )
                            if (!actions) return
                            target.dataset.held = "true"
                            actions.style.opacity = "1"
                            actions.style.transform = "translateX(0)"
                            actions.style.pointerEvents = "auto"
                            actions.style.left = "0"
                            actions.style.right = "0"
                          }, 450)
                        )
                      }}
                      onPointerMove={(event) => {
                        const start = Number(
                          event.currentTarget.dataset.swipeStart
                        )
                        if (!Number.isFinite(start)) return
                        const delta = Math.min(0, event.clientX - start)
                        const actions =
                          event.currentTarget.parentElement?.querySelector<HTMLElement>(
                            "[data-notification-actions]"
                          )
                        if (actions && delta < 0) {
                          actions.style.opacity = "1"
                          actions.style.transform = `translateX(${Math.max(delta, -88)}px)`
                          actions.style.pointerEvents = "auto"
                        }
                      }}
                      onPointerUp={(event) => {
                        const start = Number(
                          event.currentTarget.dataset.swipeStart
                        )
                        const delta = event.clientX - start
                        const timer = holdTimers.get(event.currentTarget)
                        if (timer) window.clearTimeout(timer)
                        const actions =
                          event.currentTarget.parentElement?.querySelector<HTMLElement>(
                            "[data-notification-actions]"
                          )
                        if (delta < -48) event.preventDefault()
                        if (event.currentTarget.dataset.held === "true") {
                          event.preventDefault()
                          event.stopPropagation()
                        }
                        if (
                          actions &&
                          delta > -48 &&
                          event.currentTarget.dataset.held !== "true"
                        ) {
                          actions.style.opacity = ""
                          actions.style.transform = ""
                          actions.style.pointerEvents = ""
                        }
                        if (
                          actions &&
                          event.currentTarget.dataset.held !== "true"
                        ) {
                          actions.style.left = ""
                          actions.style.right = ""
                          actions.style.background = ""
                        }
                        delete event.currentTarget.dataset.swipeStart
                      }}
                      onPointerCancel={(event) => {
                        const timer = holdTimers.get(event.currentTarget)
                        if (timer) window.clearTimeout(timer)
                        holdTimers.delete(event.currentTarget)
                        delete event.currentTarget.dataset.swipeStart
                        delete event.currentTarget.dataset.held
                        const actions =
                          event.currentTarget.parentElement?.querySelector<HTMLElement>(
                            "[data-notification-actions]"
                          )
                        if (actions) {
                          actions.style.opacity = ""
                          actions.style.transform = ""
                          actions.style.pointerEvents = ""
                          actions.style.left = ""
                          actions.style.right = ""
                          actions.style.background = ""
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="flex size-5 shrink-0 items-center justify-center">
                              <Icon
                                className={cn("size-3.5", iconColorClass)}
                                aria-hidden="true"
                              />
                            </span>
                            <span
                              className={cn(
                                "min-w-0 text-[14px] leading-5 font-normal text-neutral-950",
                                urgent && !item.is_read && "text-sos"
                              )}
                            >
                              {item.display_title || item.title}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-neutral-700">
                            {relativeTime(item.created_at)}
                          </span>
                        </span>
                        {body ? (
                          <span className="mt-0.5 block text-[13px] leading-[1.35] break-words whitespace-normal text-neutral-700">
                            {body}
                          </span>
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
                              For privacy, the reporter's identity, exact
                              location, and media are not shared.
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {hasMedia ? (
                      <div className="mr-11 ml-3.5 pb-3.5">
                        <NotificationImage
                          item={item}
                          onPreview={setMediaPreview}
                        />
                      </div>
                    ) : null}
                    <span
                      data-notification-actions
                      className="pointer-events-none absolute inset-0 z-10 flex shrink-0 flex-row items-stretch justify-center gap-0 bg-neutral-100 opacity-0 transition-[opacity,transform] duration-200"
                    >
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void archiveItem(item)
                        }}
                        aria-label={
                          item.is_archived
                            ? "Restore notification"
                            : "Archive notification"
                        }
                        title={
                          item.is_archived
                            ? "Restore notification"
                            : "Archive notification"
                        }
                        className="flex min-w-24 flex-1 flex-col items-center justify-center gap-1 border-r border-neutral-200 px-4 text-neutral-700 transition-colors hover:bg-neutral-200"
                      >
                        {item.is_archived ? (
                          <ArchiveRestoreIcon className="size-4" />
                        ) : (
                          <ArchiveIcon className="size-4" />
                        )}
                        <span className="text-[11px] font-semibold">
                          {item.is_archived ? "Restore" : "Archive"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          void deleteItem(item)
                        }}
                        aria-label="Delete notification"
                        title="Delete notification"
                        className="flex min-w-24 flex-1 flex-col items-center justify-center gap-1 px-4 text-neutral-700 transition-colors hover:bg-neutral-200"
                      >
                        <Trash2Icon className="size-4" />
                        <span className="text-[11px] font-semibold">
                          Delete
                        </span>
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
      {mediaPreview ? (
        <MediaLightbox
          items={mediaPreview}
          index={0}
          onClose={() => setMediaPreview(null)}
        />
      ) : null}
    </div>
  )
}
