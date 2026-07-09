"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangleIcon,
  BellIcon,
  Building2Icon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  MegaphoneIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useHorizontalDragScroll } from "@/features/dashboard/hooks/use-horizontal-drag-scroll"
import {
  useNotifications,
  type NotificationItem,
} from "@/features/dashboard/components/notification-context"

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type FilterKey = "all" | "announcements" | "alerts" | "reports"

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "announcements", label: "Announcements" },
  { key: "alerts", label: "Alerts" },
  { key: "reports", label: "Reports" },
]

function filterMatches(item: NotificationItem, filter: FilterKey): boolean {
  if (filter === "all") return true
  const type = item.type.toLowerCase()
  if (filter === "announcements") return type.includes("announcement")
  if (filter === "alerts") return type.includes("emergency") || type.includes("alert") || Boolean(item.emergency_id)
  return Boolean(item.concern_id) || type.includes("report") || ["submitted", "assigned", "resolved", "rejected"].includes(type)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function notificationToMode(
  type: string,
): "submitted" | "assigned" | "rejected" | "resolved" {
  if (type === "assigned") return "assigned"
  if (type === "rejected") return "rejected"
  if (type === "resolved") return "resolved"
  return "submitted"
}

function reportStatusHeadline(item: NotificationItem) {
  const status = (item.concern_status || item.type || "").toLowerCase()
  if (status === "submitted" || status === "under_review") return "Your report is under review."
  if (status === "assigned" || status === "in_progress") return "Your report has been assigned."
  if (status === "resolved") return "Your report has been resolved."
  if (status === "rejected") return "Your report was not approved."
  if (status === "appealed") return "Your appeal is under review."
  return "Your report was updated."
}

function notificationMeta(item: NotificationItem): {
  source: string
  icon: typeof ClipboardListIcon
  iconClass: string
  cardClass: string
  unreadClass: string
  unreadDotClass: string
  titleClass: string
  sourceClass: string
  avatarText?: string
} {
  const type = item.type.toLowerCase()
  if (type.includes("announcement")) {
    return {
      source: "BARANGAY ANNOUNCEMENT",
      icon: MegaphoneIcon,
      iconClass: "bg-[#6b8cff] text-white",
      cardClass: "border-[#d9deec] bg-[#f8f9fd]",
      unreadClass: "border-[#bdc9ff] bg-[#f3f6ff]",
      unreadDotClass: "bg-[#6b8cff]",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#07145f]",
      avatarText: item.title.trim().slice(0, 2).toUpperCase() || "BA",
    }
  }
  if (type.includes("emergency") || type.includes("alert") || item.emergency_id) {
    return {
      source: "E-BOSES ALERT",
      icon: AlertTriangleIcon,
      iconClass: "bg-red-100 text-red-600",
      cardClass: "border-red-200 bg-red-50",
      unreadClass: "border-red-300 bg-red-50 shadow-[0_2px_8px_rgba(220,38,38,0.12)]",
      unreadDotClass: "bg-red-500",
      titleClass: "text-red-950",
      sourceClass: "text-red-700",
    }
  }
  if (type.includes("resolved")) {
    return {
      source: reportStatusHeadline(item),
      icon: CheckCircleIcon,
      iconClass: "bg-[#eef3ff] text-[#07145f]",
      cardClass: "border-[#dfe7f5] bg-white",
      unreadClass: "border-[#cbd8ee] bg-[#fbfcff]",
      unreadDotClass: "bg-red-500",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#0f9f46]",
    }
  }
  if (type.includes("barangay") || type.includes("advisory")) {
    return {
      source: "BARANGAY ANNOUNCEMENT",
      icon: Building2Icon,
      iconClass: "bg-[#6b8cff] text-white",
      cardClass: "border-[#d9deec] bg-[#f8f9fd]",
      unreadClass: "border-[#bdc9ff] bg-[#f3f6ff]",
      unreadDotClass: "bg-[#6b8cff]",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#07145f]",
      avatarText: item.title.trim().slice(0, 2).toUpperCase() || "BA",
    }
  }
  return {
    source: reportStatusHeadline(item),
    icon: ClipboardListIcon,
    iconClass: "bg-[#fff1ea] text-[#ff5003]",
    cardClass: "border-[#dfe7f5] bg-white",
    unreadClass: "border-[#ffd0bd] bg-[#fff9f5] shadow-[0_2px_8px_rgba(255,106,26,0.10)]",
    unreadDotClass: "bg-red-500",
    titleClass: "text-[#07145f]",
    sourceClass: "text-[#0f9f46]",
  }
}

// ---------------------------------------------------------------------------
// Shared notification row (used by both mobile & desktop)
// ---------------------------------------------------------------------------

function NotificationRow({
  item,
  onMarkRead,
}: {
  item: NotificationItem
  onMarkRead: (id: number) => void
}) {
  const meta = notificationMeta(item)
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={() => {
        if (!item.is_read) onMarkRead(item.id)
        if (item.emergency_id) {
          window.dispatchEvent(
            new CustomEvent("eboses:open-emergency-tracking", {
              detail: { emergencyId: item.emergency_id },
            }),
          )
          return
        }
        if (!item.concern_id) return
        window.dispatchEvent(
          new CustomEvent("eboses:open-status-dialog", {
            detail: { concernId: item.concern_id, mode: notificationToMode(item.type) },
          }),
        )
      }}
      className={cn(
        "relative flex min-h-[86px] w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-[#cbd8ee] md:min-h-[90px]",
        item.is_read ? "border-[#d9deec] bg-[#f3f4f8] shadow-none" : cn("shadow-[0_1px_4px_rgba(7,20,95,0.10)]", meta.cardClass, meta.unreadClass),
      )}
    >
      <div className={cn("relative mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold md:size-11", meta.iconClass)}>
        {meta.avatarText ? meta.avatarText : <Icon className="size-5 md:size-5.5" strokeWidth={2.4} />}
        {!item.is_read ? <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white bg-red-500" /> : null}
      </div>

      <div className="min-w-0 flex-1 pr-12">
        <p className={cn("text-[10px] font-black leading-3 tracking-normal", item.is_read ? "text-[#8b96b8]" : meta.sourceClass)}>
          {meta.source}
        </p>
        <p className={cn("mt-1 truncate text-sm font-extrabold leading-tight md:text-[15px]", item.is_read ? "text-[#5f6885]" : meta.titleClass)}>
          {item.title}
        </p>
        {item.body ? (
          <p className={cn("mt-1 line-clamp-2 text-xs font-medium leading-4 md:text-[13px]", item.is_read ? "text-[#7b849d]" : "text-[#43507f]")}>
            {item.body}
          </p>
        ) : null}
      </div>
      <span className="absolute right-3 top-3 text-[10px] font-semibold text-[#8b96b8]">
        {timeAgo(item.created_at)}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Notification list (filtered + shared between views)
// ---------------------------------------------------------------------------

function NotificationList({
  notifications,
  filter,
  query,
  onMarkRead,
}: {
  notifications: NotificationItem[]
  filter: FilterKey
  query: string
  onMarkRead: (id: number) => void
}) {
  const needle = query.trim().toLowerCase()
  const filtered = notifications
    .filter((n) => filterMatches(n, filter))
    .filter((n) => {
      if (!needle) return true
      return `${n.title} ${n.body} ${n.type}`.toLowerCase().includes(needle)
    })

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-[#68739c]">
        <BellIcon aria-hidden="true" className="size-9 opacity-40" />
        <p className="text-sm font-semibold">No notifications yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 pb-8 md:px-5">
      {filtered.map((n) => (
        <NotificationRow key={n.id} item={n} onMarkRead={onMarkRead} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop panel (inside popover)
// ---------------------------------------------------------------------------

function DesktopPanel({
  loading,
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onClose,
}: {
  loading: boolean
  notifications: NotificationItem[]
  unreadCount: number
  onMarkAllRead: () => void
  onMarkRead: (id: number) => void
  filter: FilterKey
  onFilterChange: (f: FilterKey) => void
  query: string
  onQueryChange: (value: string) => void
  onClose: () => void
}) {
  const filterDragScroll = useHorizontalDragScroll<HTMLDivElement>()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center justify-between px-7 py-6">
        <h3 className="font-heading text-2xl font-extrabold text-[#07145f]">Notifications</h3>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-sm font-bold text-[#0057ff] transition-colors hover:text-[#ff6a1a]"
          >
            Mark all as read
          </button>
          <button type="button" onClick={onClose} className="text-[#07145f] transition-colors hover:text-[#ff6a1a]" aria-label="Close notifications">
            <XIcon className="size-6" />
          </button>
        </div>
      </div>

      <div {...filterDragScroll} className="scrollbar-hide flex shrink-0 cursor-grab touch-pan-x gap-5 overflow-x-scroll overscroll-x-contain border-b border-[#dfe7f5] px-7 pb-4 active:cursor-grabbing">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={cn(
              "shrink-0 rounded-full px-6 py-2.5 text-sm font-extrabold transition-colors",
              filter === f.key
                ? "bg-[#ff6a1a] text-white"
                : "text-[#07145f] hover:bg-[#eef3ff]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-[130px_minmax(0,1fr)_48px] gap-3 px-7 py-5">
        <button type="button" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#dfe7f5] bg-white text-sm font-semibold text-[#07145f]">
          Newest first
          <ChevronRightIcon className="size-4 rotate-90" />
        </button>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#2447b3]" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search notifications"
            className="h-10 w-full rounded-lg border border-[#dfe7f5] bg-white pl-11 pr-4 text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
          />
        </div>
        <button type="button" className="flex h-10 items-center justify-center rounded-lg border border-[#dfe7f5] bg-white text-[#2447b3] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]" aria-label="Filter notifications">
          <SlidersHorizontalIcon className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[#68739c]">
            <p className="text-sm font-semibold">Loading...</p>
          </div>
        ) : (
          <NotificationList
            notifications={notifications}
            filter={filter}
            query={query}
            onMarkRead={onMarkRead}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile sheet (fixed overlay with backdrop blur)
// ---------------------------------------------------------------------------

function MobileSheet({
  unreadCount,
  loading,
  notifications,
  onMarkRead,
  filter,
  onFilterChange,
}: {
  unreadCount: number
  loading: boolean
  notifications: NotificationItem[]
  onMarkRead: (id: number) => void
  filter: FilterKey
  onFilterChange: (f: FilterKey) => void
}) {
  const [open, setOpen] = React.useState(false)
  const filterDragScroll = useHorizontalDragScroll<HTMLDivElement>()

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const sheet =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[220] flex items-end justify-center bg-black/55 md:hidden"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex h-[82dvh] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mt-4 h-2 w-24 shrink-0 rounded-full bg-[#d8deee]" />
              <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-7">
                <h3 className="font-heading text-2xl font-extrabold text-[#07145f]">Notifications</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-9 items-center justify-center rounded-full text-[#07145f] hover:bg-[#eef3ff]"
                  aria-label="Close notifications"
                >
                  <XIcon className="size-7" strokeWidth={2} />
                </button>
              </div>

              <div {...filterDragScroll} className="scrollbar-hide flex shrink-0 cursor-grab touch-pan-x gap-2 overflow-x-scroll overscroll-x-contain border-b border-[#dfe7f5] px-6 pb-4 active:cursor-grabbing">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => onFilterChange(f.key)}
                    className={cn(
                      "shrink-0 rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                      filter === f.key
                        ? "bg-[#ff6a1a] text-white"
                        : "text-[#07145f] hover:bg-[#eef3ff]",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-[#68739c]">
                    <p className="text-sm font-semibold">Loading...</p>
                  </div>
                ) : (
                  <NotificationList
                    notifications={notifications}
                    filter={filter}
                    query=""
                    onMarkRead={onMarkRead}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {/* Bell trigger (mobile only) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary md:hidden"
        aria-label="Open notifications"
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {sheet}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotificationPopover() {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications()
  const [filter, setFilter] = React.useState<FilterKey>("all")
  const [query, setQuery] = React.useState("")
  const [desktopOpen, setDesktopOpen] = React.useState(false)

  React.useEffect(() => {
    if (!desktopOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDesktopOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [desktopOpen])

  const desktopOverlay =
    desktopOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[220] hidden bg-black/55 md:block"
            onClick={() => setDesktopOpen(false)}
          >
            <div
              className="fixed bottom-0 right-0 top-0 flex w-[620px] max-w-[calc(100vw-3rem)] flex-col bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <DesktopPanel
                loading={loading}
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAllRead={() => void markAllAsRead()}
                onMarkRead={(id) => void markAsRead(id)}
                filter={filter}
                onFilterChange={setFilter}
                query={query}
                onQueryChange={setQuery}
                onClose={() => setDesktopOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {/* Desktop bell trigger */}
      <button
        type="button"
        onClick={() => setDesktopOpen(true)}
        className="relative hidden size-10 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary md:flex"
        aria-label="Open notifications"
      >
        <BellIcon aria-hidden="true" className="size-6" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#ff6a1a] text-[11px] font-extrabold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {desktopOverlay}

      <MobileSheet
        unreadCount={unreadCount}
        loading={loading}
        notifications={notifications}
        onMarkRead={(id) => void markAsRead(id)}
        filter={filter}
        onFilterChange={setFilter}
      />
    </>
  )
}
