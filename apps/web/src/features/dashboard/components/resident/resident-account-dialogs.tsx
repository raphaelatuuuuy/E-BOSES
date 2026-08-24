"use client"

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { InboxIcon, SettingsIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { SheetDialog, SheetIconButton } from "@/features/dashboard/components/sheet-dialog"

import { useNotifications } from "@/features/dashboard/components/notification-context"
import { NotificationViewActions, NotificationsPanel } from "@/features/dashboard/components/notifications/notifications-panel"
import { createResidentNotificationsConfig } from "@/features/dashboard/components/notifications/resident-config"
import { useNotificationsPopGate } from "@/features/dashboard/components/notifications/notifications-event"
import { SettingsWorkspace } from "@/features/dashboard/components/settings/settings-workspace"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { ResidentProfilePanel } from "@/features/dashboard/components/resident/resident-profile-panel"

/**
 * The resident's personal surfaces: notifications, profile and settings all
 * open as the product's SheetDialog — bottom sheet on a phone, centred card on
 * a desktop — so every pop-up shares the report flow's chrome. The standalone
 * pages still exist so deep links keep working.
 */

/** The resident's bell + notifications pop-up. */
export function ResidentNotificationsButton() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()

  const config = createResidentNotificationsConfig(navigate)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : "Open notifications"
        }
        className="group relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-50"
      >
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center text-neutral-700 transition-opacity duration-150",
            "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
          )}
          aria-hidden="true"
        >
          <InboxIcon className="size-full" />
        </span>
        {unreadCount > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-brand-orange"
            aria-hidden="true"
          />
        ) : null}
      </button>

      {open ? (
        <SheetDialog open onClose={() => setOpen(false)} title="Notifications" size="wide" actions={<NotificationViewActions />}>
          <NotificationsPanel config={config} variant="sheet" onClose={() => setOpen(false)} />
        </SheetDialog>
      ) : null}
    </>
  )
}

/**
 * Settings pop-up — the same workspace the resident Settings page renders,
 * in dialog (desktop) / full-screen sheet (mobile) form. The Hub back arrow
 * closes it.
 */
export function ResidentSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!open) return null
  return <SettingsWorkspace variant="sheet" onExit={() => onOpenChange(false)} />
}

/**
 * Profile pop-up. Desktop: dialog with the resident's identity, account
 * details, Settings and Sign out. Mobile: full-screen sheet with a Back
 * button — the mobile header avatar opens this.
 */
export function ResidentProfileDialog({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Swaps this pop-up for the Settings pop-up instead of navigating. */
  onOpenSettings?: (closeDialog: () => void) => void
}) {
  if (!open) return null
  const close = () => onOpenChange(false)
  const openSettings = onOpenSettings
    ? () => onOpenSettings(close)
    : () => openSettingsDialog()

  return (
    <SheetDialog
      open={open}
      onClose={close}
      title="Profile"
      actions={
        <SheetIconButton label="Settings" onClick={openSettings}>
          <SettingsIcon className="size-6" strokeWidth={2} />
        </SheetIconButton>
      }
    >
      <ResidentProfilePanel />
    </SheetDialog>
  )
}

/**
 * Notifications pop-up in dialog (desktop) / full-screen sheet (mobile)
 * form, used by the shell-mounted gate below and available to any surface
 * that needs to open notifications with a specific filter.
 */
export function ResidentNotificationsDialog({
  open,
  onOpenChange,
  initialFilter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** First-run filter override (e.g. an announcements row tap). */
  initialFilter?: string
}) {
  const navigate = useNavigate()
  if (!open) return null
  const config = createResidentNotificationsConfig(navigate)

  return (
    <SheetDialog open onClose={() => onOpenChange(false)} title="Notifications" size="wide" actions={<NotificationViewActions initialView={initialFilter === "archived" ? "archived" : "inbox"} />}>
      <NotificationsPanel
        config={config}
        variant="sheet"
        onClose={() => onOpenChange(false)}
        initialFilter={initialFilter}
      />
    </SheetDialog>
  )
}

/**
 * Shell-mounted listener: opens the resident notifications pop-up whenever a
 * row or link asks for it (e.g. an announcement row whose action_url points
 * at the notifications page). Mounted once in the dashboard shell.
 */
export function ResidentNotificationsGate() {
  const [state, setState] = useState<{ open: boolean; filter?: string }>({ open: false })
  useNotificationsPopGate((filter) => setState({ open: true, filter }))
  return (
    <ResidentNotificationsDialog
      open={state.open}
      onOpenChange={(open) => setState((current) => ({ ...current, open }))}
      initialFilter={state.filter}
    />
  )
}
