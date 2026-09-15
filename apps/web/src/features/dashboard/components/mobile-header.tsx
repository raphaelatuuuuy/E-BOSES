import { useState } from "react"
import { Link } from "react-router-dom"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { useOfficialBadges } from "@/features/dashboard/hooks/use-official-badges"
import { useOfficialUnitScope } from "@/features/dashboard/hooks/use-official-unit"
import {
  LiveDot,
  liveDotAriaLabel,
} from "@/features/dashboard/components/home/live-dot"
import { railLiveMapSrc } from "@/features/dashboard/components/home/home-style"
import { OfficialMobileChrome } from "@/features/dashboard/components/official/official-account-dialogs"
import {
  ResponderNotificationsButton,
  ResponderProfileDialog,
} from "@/features/dashboard/components/responder/account-dialogs"

/**
 * Staff (official/responder) sticky mobile header — resident-style live rail
 * dot + community name, with staff inbox and avatar controls.
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
  const communityName = (user?.barangay || "Your community").replace(
    /^Barangay\s+/i,
    "",
  )
  const responder = isResponderUser(user)
  const official = isOfficialUser(user)
  const { selectedUnitId } = useOfficialUnitScope(official ? user : null)
  const { badges, criticalReport, communityCenter } = useOfficialBadges(
    official || responder,
    selectedUnitId,
    responder ? "responder" : "official",
  )
  const activeAlertCount =
    (badges.emergencies ?? 0) + (criticalReport ? 1 : 0)
  const hasActiveAlerts = activeAlertCount > 0
  const railLatitude = communityCenter?.latitude ?? 14.5995
  const railLongitude = communityCenter?.longitude ?? 120.9842

  return (
    <header
      className="sticky top-0 z-40 mt-5 flex h-14 shrink-0 items-center gap-2 bg-white px-3"
    >
      <LiveDot
        src={railLiveMapSrc(railLatitude, railLongitude)}
        alert={hasActiveAlerts}
        label={liveDotAriaLabel(
          communityName,
          hasActiveAlerts,
          activeAlertCount,
        )}
        title={
          criticalReport
            ? `Critical report: ${criticalReport.official_title || criticalReport.title}`
            : hasActiveAlerts
              ? `${activeAlertCount} active alert${activeAlertCount === 1 ? "" : "s"}`
              : undefined
        }
        to="/dashboard/alerts-map"
      />
      <Link
        to={homeTo}
        className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900 no-underline"
      >
        {communityName}
      </Link>
      <div className="flex shrink-0 items-center gap-0.5">
        {responder ? (
          <ResponderMobileChrome />
        ) : (
          <OfficialMobileChrome />
        )}
      </div>
    </header>
  )
}
