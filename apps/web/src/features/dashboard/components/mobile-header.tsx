import { Link } from "react-router-dom"

import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"

/**
 * Staff (official/responder) sticky mobile header — brand logo + bell +
 * avatar. Extracted from dashboard.tsx (was inlined ~lines 162-180).
 * Residents use their own mobile chrome (search lives in the page body).
 */
export function StaffMobileHeader({ homeTo }: { homeTo: string }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-shell-border bg-white px-3">
      <Link to={homeTo} className="flex min-w-0 items-center gap-2 no-underline">
        <img src="/contents/logo.png" alt="Boses Marikina Heights" className="size-8 shrink-0 object-contain" />
        <div className="flex flex-col">
          <span className="truncate text-[18px] font-bold leading-none tracking-tight text-brand-orange">
            Boses
          </span>
          <span className="text-[9px] font-bold leading-tight tracking-wide text-brand-navy">
            Marikina Heights
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-0.5">
        <NotificationPopover />
        <ProfileAccountMenu placeLabel="Marikina Heights" />
      </div>
    </header>
  )
}
