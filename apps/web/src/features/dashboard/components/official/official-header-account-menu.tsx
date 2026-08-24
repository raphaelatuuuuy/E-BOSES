import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { InboxIcon, LogOutIcon, UserCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import { displayPosition } from "@/features/dashboard/lib/position"
import {
  OfficialNotificationsDialog,
  OfficialProfileDialog,
} from "@/features/dashboard/components/official/official-account-dialogs"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"

/**
 * The official desktop header's account trigger — avatar, name and role,
 * pinned to the header's top-right instead of the sidebar floor. Opens the
 * same profile/notifications/sign-out menu the sidebar used to, just anchored
 * downward from the top instead of upward from the bottom.
 */
export function OfficialHeaderAccountMenu() {
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const { unreadCount } = useNotifications()

  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const avatarInitials = initials(user?.full_name || "Account").charAt(0)
  const rolePosition = displayPosition(user)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate("/sign-in", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const itemClass =
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[12.5px] leading-none text-nav-text transition-colors hover:bg-nav-raised hover:text-nav-text-active"
  const iconClass = "size-4 shrink-0 text-nav-muted"

  return (
    <div className="relative shrink-0">
      {open ? (
        <ul
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-[1100] flex w-52 flex-col gap-0.5 rounded-xl p-3 shadow-[0_14px_35px_rgba(15,23,42,0.16)] ring-1",
            "bg-nav-raised ring-nav-border before:absolute before:right-6 before:top-[-6px] before:size-3 before:rotate-45 before:border-l before:border-t before:border-nav-border before:bg-nav-raised",
          )}
        >
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setProfileOpen(true)
              }}
              className={itemClass}
            >
              <UserCircleIcon className={iconClass} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-left font-medium">View profile</span>
            </button>
          </li>

          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setNotificationsOpen(true)
              }}
              className={itemClass}
            >
              <InboxIcon className={iconClass} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-left font-medium">Notifications</span>
              {unreadCount > 0 ? (
                <span className="size-2.5 shrink-0 rounded-full bg-brand-orange" aria-hidden="true" />
              ) : null}
            </button>
          </li>

          <li>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className={cn(itemClass, "disabled:opacity-60")}
            >
              <LogOutIcon className={iconClass} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 whitespace-nowrap text-left font-medium">
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </li>
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-nav-raised"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted ring-1 ring-transparent">
          {avatarInitials}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] font-bold leading-tight text-nav-text-active">
            {user?.full_name || "Account"}
          </span>
          <span className="truncate text-[10.5px] font-semibold leading-tight text-nav-muted">
            {rolePosition}
          </span>
        </span>
      </button>

      <OfficialProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onOpenSettings={(closeDialog) => {
          closeDialog()
          openSettingsDialog()
        }}
      />
      <OfficialNotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </div>
  )
}
