import { useState } from "react"
import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { isResponderUser } from "@/features/auth/roles"
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
 * Both staff roles use light chrome and their own account dialogs.
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
          className="ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-soft text-[15px] font-bold text-navy-muted">
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
}: {
  homeTo: string
}) {
  const { user } = useAuthSession()
  const communityName = user?.barangay || "E-Boses community"
  const responder = isResponderUser(user)

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3",
        "border-shell-border bg-white",
      )}
    >
      <Link to={homeTo} className="flex min-w-0 items-center gap-2 no-underline">
        <img
          src="/contents/logo.webp"
          alt={`Boses ${communityName}`}
          className="size-8 shrink-0 object-contain"
        />
        <div className="flex flex-col">
          <span className="truncate text-[22px] font-bold leading-none tracking-tight text-brand-orange">
            Boses
          </span>
          <span
            className="mt-0.5 text-[11px] font-bold leading-tight tracking-wide text-brand-navy"
          >
            {communityName}
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-0.5">
        {responder ? (
          <ResponderMobileChrome />
        ) : (
          <OfficialMobileChrome />
        )}
      </div>
    </header>
  )
}
