"use client"

import { useState } from "react"
import { BellIcon, SettingsIcon } from "lucide-react"

import { SheetDialog, SheetIconButton } from "@/features/dashboard/components/sheet-dialog"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import { OfficialProfilePanel } from "@/features/dashboard/components/official/official-profile-panel"
import { OfficialNotificationsPanel } from "@/features/dashboard/components/official/official-notifications-panel"
import { SettingsWorkspace } from "@/features/dashboard/components/settings/settings-workspace"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { useNotificationsPopGate } from "@/features/dashboard/components/notifications/notifications-event"

/**
 * The official's personal surfaces. Notifications, Profile and Settings all
 * open as the product's SheetDialog, so they carry the same chrome as the
 * report flow. The standalone notifications and settings pages stay for
 * residents and deep links.
 */

/**
 * The official's Notifications entry point, rendered in the light mobile
 * header. Opens the full notification panel as a full-screen sheet (over the
 * top and bottom nav) with a Back button — the same panel the sidebar account
 * block opens as a dialog on desktop.
 */
export function OfficialNotificationsButton() {
  const [open, setOpen] = useState(false)
  const { unreadCount } = useNotifications()

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
        <span
          className="inline-flex size-7 shrink-0 items-center justify-center text-neutral-700 opacity-55 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"
          aria-hidden="true"
        >
          <BellIcon className="size-full" />
        </span>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-orange px-1 text-[10px] font-bold leading-none text-white tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <SheetDialog open onClose={() => setOpen(false)} title="Notifications" size="wide">
          <OfficialNotificationsPanel variant="sheet" onClose={() => setOpen(false)} />
        </SheetDialog>
      ) : null}
    </>
  )
}

/**
 * Notifications pop-up, opened by the sidebar account block on desktop.
 * Desktop: dialog with the panel's own header (X to close). Mobile: the same
 * full-screen sheet shape as the header entry, with a Back button.
 */
export function OfficialNotificationsDialog({
  open,
  onOpenChange,
  initialFilter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** First-run filter override (e.g. an announcements row tap). */
  initialFilter?: string
}) {
  if (!open) return null

  return (
    <SheetDialog open onClose={() => onOpenChange(false)} title="Notifications" size="wide">
      <OfficialNotificationsPanel
        variant="sheet"
        onClose={() => onOpenChange(false)}
        initialFilter={initialFilter}
      />
    </SheetDialog>
  )
}

/**
 * Shell-mounted listener: opens the official notifications pop-up whenever a
 * row or link asks for it. Mounted once in the staff sidebar (desktop) and in
 * the mobile chrome — never both on the same viewport.
 */
export function OfficialNotificationsGate() {
  const [state, setState] = useState<{ open: boolean; filter?: string }>({ open: false })
  useNotificationsPopGate((filter) => setState({ open: true, filter }))
  return (
    <OfficialNotificationsDialog
      open={state.open}
      onOpenChange={(open) => setState((current) => ({ ...current, open }))}
      initialFilter={state.filter}
    />
  )
}

/**
 * Profile pop-up. Desktop: dialog with the official's identity, account
 * details, Settings and Sign out. Mobile: full-screen sheet with a Back
 * button — the mobile header avatar opens this.
 */
export function OfficialProfileDialog({
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
      <OfficialProfilePanel />
    </SheetDialog>
  )
}

/**
 * Settings pop-up — the same workspace the resident Settings page renders,
 * in dialog (desktop) / full-screen sheet (mobile) form. The Hub back arrow
 * closes it.
 */
export function OfficialSettingsDialog({
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
 * Official mobile chrome — bell + avatar in the light staff header. Bell
 * opens the notifications sheet; the avatar opens the Profile sheet.
 */
export function OfficialMobileChrome() {
  const [profileOpen, setProfileOpen] = useState(false)
  const { user } = useAuthSession()
  const avatarInitials = initials(user?.full_name || "Account")

  return (
    <>
      <div className="flex items-center gap-0.5">
        <OfficialNotificationsButton />
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          aria-label="Open profile"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[11px] font-bold text-brand-navy">
            {avatarInitials}
          </span>
        </button>
      </div>
      <OfficialProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onOpenSettings={(closeDialog) => {
          closeDialog()
          openSettingsDialog()
        }}
      />
      <OfficialNotificationsGate />
    </>
  )
}