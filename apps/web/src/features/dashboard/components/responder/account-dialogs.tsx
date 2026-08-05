"use client"

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellIcon,
  FileTextIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MegaphoneIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useNotifications, type NotificationItem } from "@/features/dashboard/components/notification-context"
import { displayPosition } from "@/features/dashboard/lib/position"

/**
 * The responder's account surfaces as dialogs, not pages.
 *
 * The desktop sidebar account block and the dark mobile header both used to
 * link out to the resident-styled `/dashboard/profile` and
 * `/dashboard/notifications` pages — two hops through a light theme on the way
 * to personal destinations. These dialogs render the profile and the
 * notification list inline, on the console's own palette, so a responder never
 * leaves the shell for their own account.
 */

type NotificationGroup = "emergencies" | "announcements" | "reports"

function notificationGroup(item: NotificationItem): NotificationGroup {
  if (item.category === "announcement" || item.type === "announcement") return "announcements"
  if (
    item.category === "emergency" ||
    item.emergency_id ||
    item.type.startsWith("emergency") ||
    item.type === "witness_alert"
  ) {
    return "emergencies"
  }
  return "reports"
}

function notificationSnippet(text: string | null | undefined, max = 90): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  return `${(atWord.length >= 32 ? atWord : slice.trim()).trim()}...`
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const group = notificationGroup(item)
  const Icon =
    group === "emergencies"
      ? AlertTriangleIcon
      : group === "announcements"
        ? MegaphoneIcon
        : FileTextIcon
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors duration-[--duration-micro] hover:bg-card-raised",
        !item.is_read && "bg-card-raised",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          group === "emergencies"
            ? "bg-sos/15 text-sos"
            : group === "announcements"
              ? "bg-brand-orange/15 text-brand-orange"
              : "bg-ice/10 text-ice",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-[13.5px] font-semibold leading-snug text-foreground">
            {item.display_title || item.title}
          </span>
          {!item.is_read ? (
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ice" aria-label="Unread" />
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">
          {notificationSnippet(item.display_body || item.body) || "No details."}
        </span>
        <span className="mt-1 block text-[11px] font-medium text-subtle-foreground">
          {relativeTime(item.created_at)}
        </span>
      </span>
    </button>
  )
}

export function ResponderNotificationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { notifications, loading, markAsRead } = useNotifications()
  const items = notifications.slice(0, 20)
  const unread = notifications.filter((item) => !item.is_read).length

  async function openNotification(item: NotificationItem) {
    if (!item.is_read) {
      await markAsRead(item.id).catch(() => {})
    }
    onOpenChange(false)
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
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-card-line bg-card">
        <DialogHeader>
          <DialogTitle>
            Notifications
            {unread > 0 ? (
              <span className="ml-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10.5px] font-black leading-none text-brand-orange-ink tabular-nums">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-0 px-2 py-2 sm:px-2 sm:py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-subtle-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              <span className="text-label">Loading notifications…</span>
            </div>
          ) : items.length > 0 ? (
            <div className="flex flex-col">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={() => void openNotification(item)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <BellIcon className="size-7 text-subtle-foreground" />
              <p className="mt-3 text-heading text-foreground">No notifications yet</p>
              <p className="mt-1 max-w-[260px] text-body text-muted-foreground">
                Dispatch updates and barangay announcements will appear here.
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              navigate("/dashboard/notifications")
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-orange px-4 py-2.5 text-label font-bold text-brand-orange-ink transition-colors duration-[--duration-micro] hover:bg-brand-orange-strong"
          >
            View all notifications
            <ArrowRightIcon className="size-4" />
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ResponderProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const [signingOut, setSigningOut] = useState(false)
  const name = user?.full_name || "Account"
  const position = displayPosition(user)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      onOpenChange(false)
      navigate("/sign-in", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-card-line bg-card">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col items-center px-4 pt-2 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-nav-active text-[20px] font-black text-nav-text-active ring-1 ring-white/10">
              {initials(name)}
            </span>
            <p className="mt-3 text-title text-foreground">{name}</p>
            <p className="mt-1 text-body font-medium text-subtle-foreground">{position}</p>
            <p className="mt-4 max-w-[300px] text-body leading-6 text-muted-foreground">
              Your dispatch, map and shift records all live in the sidebar. Account settings are
              handled by your barangay coordinator.
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sos/15 px-4 py-2.5 text-label font-bold text-sos transition-colors duration-[--duration-micro] hover:bg-sos/25 disabled:opacity-60"
          >
            {signingOut ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <LogOutIcon className="size-4" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
