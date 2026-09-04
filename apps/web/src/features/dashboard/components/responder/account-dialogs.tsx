"use client"

import { useState } from "react"
import { InboxIcon } from "lucide-react"

import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"

import { useNotifications } from "@/features/dashboard/components/notification-context"
import { ResponderProfilePanel } from "@/features/dashboard/components/responder/responder-profile-panel"
import { ResponderNotificationsPanel } from "@/features/dashboard/components/responder/responder-notifications-panel"
import { NotificationViewActions } from "@/features/dashboard/components/notifications/notifications-panel"
import { useNotificationsPopGate } from "@/features/dashboard/components/notifications/notifications-event"

const RESPONDER_DIALOG_THEME = "bg-white text-neutral-900"

/**
 * The responder's personal surfaces. Profile and Notifications both open as
 * the product's SheetDialog, carrying the same chrome as the report flow. The
 * standalone `/dashboard/responders/notifications` page no longer exists — the
 * panel carries the full feature set in every surface.
 */

/**
 * The responder's Notifications entry point, rendered in the light mobile
 * header. Opens the full notification panel as a full-screen sheet (over the
 * top and bottom nav) with a Back button — the same panel the sidebar account
 * block opens as a dialog on desktop.
 */
export function ResponderNotificationsButton() {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<string | undefined>()
  const { unreadCount } = useNotifications()
  useNotificationsPopGate((nextFilter) => {
    setFilter(nextFilter)
    setOpen(true)
  })

  const ariaLabel =
    unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : "Open notifications"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className="group relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
      >
        <InboxIcon className="size-6 text-neutral-700 group-hover:text-neutral-900" />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-brand-orange"
            aria-hidden="true"
          />
        ) : null}
      </button>
      {open ? (
        <SheetDialog className={RESPONDER_DIALOG_THEME} open onClose={() => setOpen(false)} title="Dispatch updates" size="wide" actions={<NotificationViewActions />}>
          <ResponderNotificationsPanel
            variant="sheet"
            onClose={() => setOpen(false)}
            initialFilter={filter}
          />
        </SheetDialog>
      ) : null}
    </>
  )
}

/**
 * Notifications pop-up, opened by the sidebar account block on desktop and by
 * nothing on mobile (the mobile header uses `ResponderNotificationsButton`).
 * Desktop: dialog with the panel's own header (X to close). Mobile: the same
 * full-screen sheet shape as the header entry, with a Back button.
 */
export function ResponderNotificationsDialog({
  open,
  onOpenChange,
  initialFilter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** First-run filter override (e.g. a row tap); falls back to storage. */
  initialFilter?: string
}) {
  if (!open) return null

  return (
    <SheetDialog className={RESPONDER_DIALOG_THEME} open onClose={() => onOpenChange(false)} title="Dispatch updates" size="wide" actions={<NotificationViewActions initialView={initialFilter === "archived" ? "archived" : "inbox"} />}>
      <ResponderNotificationsPanel
        variant="sheet"
        onClose={() => onOpenChange(false)}
        initialFilter={initialFilter}
      />
    </SheetDialog>
  )
}

/**
 * Shell-mounted listener: opens the responder notifications pop-up whenever a
 * row or link asks for it. Mounted once in the responder sidebar (desktop) —
 * the mobile header button carries the same listener.
 */
export function ResponderNotificationsGate() {
  const [state, setState] = useState<{ open: boolean; filter?: string }>({ open: false })
  useNotificationsPopGate((filter) => setState({ open: true, filter }))
  return (
    <ResponderNotificationsDialog
      open={state.open}
      onOpenChange={(open) => setState((current) => ({ ...current, open }))}
      initialFilter={state.filter}
    />
  )
}

/**
 * Profile pop-up. Desktop: dialog with the real responder profile (identity,
 * response unit, career totals, account details, sign out). Mobile: full-
 * screen sheet with a Back button — the mobile header avatar opens this.
 */
export function ResponderProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!open) return null

  return (
    <SheetDialog className={RESPONDER_DIALOG_THEME} open onClose={() => onOpenChange(false)} title="Profile" size="wide">
      <ResponderProfilePanel />
    </SheetDialog>
  )
}
