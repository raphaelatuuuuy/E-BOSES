import { Link, useLocation } from "react-router-dom"

import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useResidentSearch } from "@/features/dashboard/components/resident-search-context"
import { RotatingSearchField } from "@/features/dashboard/components/rotating-search-field"

function staffPageTitle(pathname: string) {
  if (pathname.includes("/emergencies")) return "Emergency ops"
  if (pathname.includes("/alerts-map")) return "Alerts map"
  if (pathname.includes("/reports")) return "Concerns"
  if (pathname.includes("/verification-queue")) return "Verification"
  if (pathname.includes("/ocr-templates")) return "ID templates"
  if (pathname.includes("/concern-classification")) return "Classification"
  if (pathname.includes("/admin")) return "Admin"
  if (pathname.includes("/profile")) return "Profile"
  if (pathname.includes("/settings")) return "Settings"
  if (pathname.includes("/notifications")) return "Notifications"
  if (pathname.includes("/home")) return "Dashboard"
  return "Operations"
}

/** Layout tokens — MUST match home body grid */
export const RESIDENT_FEED_MAX = 680
/** Preferred (max) sidebar width at full size */
export const RESIDENT_SIDEBAR_W = 360
/** Floor when zooming / narrow CSS viewport — keep nav readable without eating the main pane */
export const RESIDENT_SIDEBAR_MIN = 220
export const RESIDENT_RAIL_W = 288
export const RESIDENT_SEARCH_MAX = 480
export const RESIDENT_CONTENT_GAP = 24
export const RESIDENT_CONTENT_MAX = RESIDENT_FEED_MAX + RESIDENT_CONTENT_GAP + RESIDENT_RAIL_W
/** Soft shell min at preferred sizes (not forced — see dashboard zoom min) */
export const RESIDENT_LAYOUT_MIN = RESIDENT_SIDEBAR_W + RESIDENT_CONTENT_MAX
export const RESIDENT_DESKTOP_MIN_PX = 1024

/**
 * Shared feed|rail grid for home body (composer + rail cards).
 */
export function ResidentContentGrid({
  children,
  className = "",
  align = "start",
}: {
  children: React.ReactNode
  className?: string
  align?: "start" | "center"
}) {
  return (
    <div
      className={className}
      style={{
        display: "grid",
        width: "100%",
        maxWidth: RESIDENT_CONTENT_MAX,
        marginLeft: "auto",
        marginRight: "auto",
        gridTemplateColumns: `minmax(0, ${RESIDENT_FEED_MAX}px) minmax(0, ${RESIDENT_RAIL_W}px)`,
        columnGap: RESIDENT_CONTENT_GAP,
        alignItems: align,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Main top chrome (desktop):
 * Search centered over feed column · bell + avatar on the right
 */
export function ResidentMainTopBar() {
  const { search, setSearch } = useResidentSearch()

  return (
    <header className="sticky top-0 z-40 h-14 w-full shrink-0 bg-white">
      <div className="relative flex h-14 w-full items-center">
        <div className="pointer-events-none absolute inset-0 flex justify-center">
          <ResidentContentGrid className="h-14" align="center">
            <div className="pointer-events-auto flex min-w-0 items-center justify-center">
              <RotatingSearchField
                value={search}
                onChange={setSearch}
                maxWidth={RESIDENT_SEARCH_MAX}
              />
            </div>
            <div aria-hidden className="min-w-0" />
          </ResidentContentGrid>
        </div>

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0.5 pr-4">
          <NotificationPopover />
          <ProfileAccountMenu placeLabel="Marikina Heights" />
        </div>
      </div>
    </header>
  )
}

/** Logo block — same horizontal inset as sidebar nav buttons */
export function ResidentLogoBar({ homeTo = "/dashboard/home" }: { homeTo?: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center px-3">
      <Link
        to={homeTo}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 no-underline"
      >
        <img src="/contents/logo.png" alt="" className="size-9 shrink-0 object-contain" />
        <span className="truncate text-[26px] font-bold leading-none tracking-tight text-[#ff6a1a]">
          E-Boses
        </span>
      </Link>
    </div>
  )
}

/**
 * Official / responder top chrome (desktop):
 * Page title left · bell + avatar right — same white bar as residents.
 */
export function OfficialMainTopBar() {
  const location = useLocation()
  const title = staffPageTitle(location.pathname)

  return (
    <header className="sticky top-0 z-40 h-14 w-full shrink-0 border-b border-neutral-100 bg-white">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold tracking-tight text-neutral-900 sm:text-[18px]">
            {title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <NotificationPopover />
          <ProfileAccountMenu placeLabel="Marikina Heights" />
        </div>
      </div>
    </header>
  )
}

/** @deprecated use ResidentMainTopBar */
export function ResidentTopBar() {
  return <ResidentMainTopBar />
}
