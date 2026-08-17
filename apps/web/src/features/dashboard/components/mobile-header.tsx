import { useState } from "react"
import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { OfficialMobileChrome } from "@/features/dashboard/components/official/official-account-dialogs"
import {
  ResponderNotificationsButton,
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
 * Both tones open their own dialogs instead of navigating to separate
 * pages: the dark tone uses the responder's (account-dialogs.tsx), the light
 * tone uses the official's (official-account-dialogs.tsx).
 */

function ResponderMobileChrome() {
  const [profileOpen, setProfileOpen] = useState(false)
  const { user } = useAuthSession()
  const avatarInitials = initials(user?.full_name || "Account").charAt(0)

  return (
    <>
      <div className="flex items-center gap-0.5">
        <ResponderNotificationsButton />
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          aria-label="Open profile"
          className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-nav-raised"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
            {avatarInitials}
          </span>
        </button>
      </div>
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
          <OfficialMobileChrome />
        )}
      </div>
    </header>
  )
}
