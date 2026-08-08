import { useState } from "react"
import { Link } from "react-router-dom"
import { Bell } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import {
  ResponderNotificationsDialog,
  ResponderProfileDialog,
} from "@/features/dashboard/components/responder/account-dialogs"

/**
 * Staff (official/responder) sticky mobile header — brand logo + bell +
 * avatar. Residents use their own mobile chrome (search lives in the page
 * body).
 *
 * `tone="dark"` is the responder's. The header previously hardcoded
 * `bg-white`, so inside the `.staff-dark` shell it painted a white slab across
 * the top of every otherwise-dark screen — the bar the user reported. It is
 * tone-switched rather than tokenised because the official shell is still on
 * the light palette and shares this component; once officials migrate, this
 * prop collapses to the dark branch.
 *
 * On the dark tone the bell and avatar open the responder's own dialogs
 * (account-dialogs.tsx) instead of the light NotificationPopover /
 * ProfileAccountMenu, which are resident-styled and navigate to separate
 * pages.
 */

function ResponderMobileChrome() {
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const { unreadCount } = useNotifications()
  const { user } = useAuthSession()
  const avatarInitials = initials(user?.full_name || "Account")

  return (
    <>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setNotifOpen(true)}
          aria-label={
            unreadCount > 0
              ? `Open notifications, ${unreadCount} unread`
              : "Open notifications"
          }
          className="group relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-nav-raised"
        >
          <Bell className="size-5 text-nav-muted group-hover:text-nav-text-active" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-brand-orange px-0.5 text-[10px] font-bold text-brand-orange-ink">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          aria-label="Open profile"
          className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-nav-raised"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-nav-active text-[11px] font-black text-white ring-1 ring-white/10">
            {avatarInitials}
          </span>
        </button>
      </div>
      <ResponderNotificationsDialog open={notifOpen} onOpenChange={setNotifOpen} />
      <ResponderProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  )
}

export function StaffMobileHeader({
  homeTo,
  tone = "light",
}: {
  homeTo: string
  tone?: "light" | "dark"
}) {
  const dark = tone === "dark"

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3",
        dark ? "border-nav-border bg-nav-bg" : "border-shell-border bg-white",
      )}
    >
      <Link to={homeTo} className="flex min-w-0 items-center gap-2 no-underline">
        <img
          src="/contents/logo.webp"
          alt="Boses Marikina Heights"
          className="size-8 shrink-0 object-contain"
        />
        <div className="flex flex-col">
          <span className="truncate text-[18px] font-bold leading-none tracking-tight text-brand-orange">
            Boses
          </span>
          <span
            className={cn(
              "text-[9px] font-bold leading-tight tracking-wide",
              dark ? "text-nav-muted" : "text-brand-navy",
            )}
          >
            Marikina Heights
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-0.5">
        {dark ? (
          <ResponderMobileChrome />
        ) : (
          <>
            <NotificationPopover tone={tone} />
            <ProfileAccountMenu placeLabel="Marikina Heights" />
          </>
        )}
      </div>
    </header>
  )
}
