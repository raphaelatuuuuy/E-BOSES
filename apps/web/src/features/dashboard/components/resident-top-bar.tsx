import { Link, useLocation } from "react-router-dom"

import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useResidentSearch } from "@/features/dashboard/components/resident-search-context"
import { RotatingSearchField } from "@/features/dashboard/components/rotating-search-field"

/** Layout tokens — MUST match home body grid */
export const RESIDENT_FEED_MAX = 680
/** Preferred (max) sidebar width at full size */
export const RESIDENT_SIDEBAR_W = 360
/** Floor when zooming / narrow CSS viewport — still readable for nav + Report */
export const RESIDENT_SIDEBAR_MIN = 320
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
 * Main top chrome:
 * - Search centered over the FEED column (same grid as body)
 * - Bell + avatar at the far right of the main column
 */
export function ResidentMainTopBar() {
  const location = useLocation()
  const { search, setSearch } = useResidentSearch()
  const isHome =
    location.pathname === "/dashboard/home" ||
    location.pathname === "/dashboard" ||
    location.pathname === "/dashboard/"

  return (
    <header className="sticky top-0 z-40 h-14 w-full shrink-0 bg-white">
      <div className="relative flex h-14 w-full items-center">
        {/*
          Same centered content band as home (feed | rail).
          Search only in the feed column → sits left of true main-center,
          centered on the feed itself.
        */}
        <div className="pointer-events-none absolute inset-0 flex justify-center">
          <ResidentContentGrid className="h-14" align="center">
            <div className="pointer-events-auto flex min-w-0 items-center justify-center">
              {isHome ? (
                <RotatingSearchField
                  value={search}
                  onChange={setSearch}
                  maxWidth={RESIDENT_SEARCH_MAX}
                />
              ) : null}
            </div>
            {/* empty rail cell — keeps search over feed only */}
            <div aria-hidden className="min-w-0" />
          </ResidentContentGrid>
        </div>

        {/* Bell + avatar — slightly inset from the far right */}
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0.5 pr-[16px] md:pr-[16px]">
          <NotificationPopover />
          <ProfileAccountMenu placeLabel="Marikina Heights" />
        </div>
      </div>
    </header>
  )
}

/** Logo block — same horizontal inset as sidebar nav buttons */
export function ResidentLogoBar() {
  return (
    <div className="flex h-14 shrink-0 items-center px-3">
      <Link
        to="/dashboard/home"
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

/** @deprecated use ResidentMainTopBar */
export function ResidentTopBar() {
  return <ResidentMainTopBar />
}
