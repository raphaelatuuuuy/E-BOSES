import { Link } from "react-router-dom"

import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useResidentSearch } from "@/features/dashboard/components/resident-search-context"
import { RotatingSearchField } from "@/features/dashboard/components/rotating-search-field"
import {
  CONTENT_GAP,
  CONTENT_MAX,
  DESKTOP_MIN_PX,
  FEED_MAX,
  LAYOUT_MIN,
  RAIL_W,
  SEARCH_MAX,
  SIDEBAR_MIN,
  SIDEBAR_W,
} from "@/features/dashboard/lib/shell"

/**
 * Layout constants moved to `lib/shell.ts` (single source of truth for the
 * dashboard shell). Re-exported here under their historical `RESIDENT_*`
 * names so existing consumers (home.tsx, notifications.tsx,
 * profile-account-menu.tsx, resident-alerts-map.tsx) keep working unchanged.
 */
export const RESIDENT_FEED_MAX = FEED_MAX
export const RESIDENT_SIDEBAR_W = SIDEBAR_W
export const RESIDENT_SIDEBAR_MIN = SIDEBAR_MIN
export const RESIDENT_RAIL_W = RAIL_W
export const RESIDENT_SEARCH_MAX = SEARCH_MAX
export const RESIDENT_CONTENT_GAP = CONTENT_GAP
export const RESIDENT_CONTENT_MAX = CONTENT_MAX
export const RESIDENT_LAYOUT_MIN = LAYOUT_MIN
export const RESIDENT_DESKTOP_MIN_PX = DESKTOP_MIN_PX

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
export function ResidentLogoBar({
  homeTo = "/dashboard/home",
  tone = "light",
}: {
  homeTo?: string
  /** `dark` renders on the navy staff rail; `light` on the white resident shell. */
  tone?: "light" | "dark"
}) {
  // Navy staff panel — same lockup as the light shell, recoloured for the dark
  // surface (ref 8 "AeuxGlobal": mark + wordmark, white on near-black).
  if (tone === "dark") {
    return (
      <div className="flex h-16 shrink-0 items-center px-3">
        <Link
          to={homeTo}
          className="flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 no-underline transition-colors hover:bg-nav-raised"
        >
          <img
            src="/contents/logo.webp"
            alt="Boses Marikina Heights"
            className="size-8 shrink-0 object-contain"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[19px] font-bold leading-none tracking-tight text-brand-orange">
              Boses
            </span>
            <span className="mt-0.5 truncate text-[10px] font-semibold leading-tight tracking-wide text-nav-muted">
              Marikina Heights
            </span>
          </span>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-14 shrink-0 items-center px-3">
      <Link
        to={homeTo}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 no-underline"
      >
        <img src="/contents/logo.webp" alt="Boses Marikina Heights" className="size-9 shrink-0 object-contain" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[26px] font-bold leading-none tracking-tight text-brand-orange">
            Boses
          </span>
          <span className="truncate text-[11px] font-bold leading-tight tracking-wide text-brand-navy">
            Marikina Heights
          </span>
        </div>
      </Link>
    </div>
  )
}

/**
 * Official / responder top chrome (desktop):
 * Page title left · bell + avatar right — same white bar as residents.
 */
export function OfficialMainTopBar() {
  const { search, setSearch } = useResidentSearch()

  return (
    <header className="sticky top-0 z-40 h-14 w-full shrink-0 border-b border-neutral-100 bg-white">
      <div className="relative flex h-14 w-full items-center">
        <div className="pointer-events-none absolute inset-0 flex justify-center">
          <div className="flex h-14 w-full max-w-md items-center justify-center px-4 sm:px-6">
            <div className="pointer-events-auto w-full">
              <RotatingSearchField
                value={search}
                onChange={setSearch}
                maxWidth={RESIDENT_SEARCH_MAX}
              />
            </div>
          </div>
        </div>
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0.5 pr-4 sm:pr-6">
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
