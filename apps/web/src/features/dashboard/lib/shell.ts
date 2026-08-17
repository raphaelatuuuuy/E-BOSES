import * as React from "react"

/**
 * Shared dashboard shell layout constants + chrome helpers.
 *
 * These were previously scattered across dashboard.tsx (inline pathname
 * checks + a magic `1800` staff shell max) and resident-top-bar.tsx (the
 * `RESIDENT_*` layout constants). Consolidated here as the single source of
 * truth; resident-top-bar.tsx re-exports the constants under their old names
 * so existing consumers keep working unchanged.
 */

/** Desktop breakpoint — matches `min-width: 1024px`. */
export const DESKTOP_MIN_PX = 1024

/** Resident shell max width (grid + content column clamp). */
export const SHELL_MAX_RESIDENT = 1600
/** Official/responder ("staff") shell max width. */
export const SHELL_MAX_STAFF = 1800

/**
 * Wider sidebar width used by the responder rail. Residents and officials use
 * the compact 72px icon rail in the desktop shell.
 */
export const SIDEBAR_W = 248

/** @deprecated every role now uses the single `SIDEBAR_W` column. */
export const SIDEBAR_MIN = SIDEBAR_W

/**
 * @deprecated the official and responder rails merged into the shared
 * `SIDEBAR_W` / `SIDEBAR_MIN` column width.
 */
export const SIDEBAR_W_STAFF = SIDEBAR_W

/** @deprecated see `SIDEBAR_W_STAFF`. */
export const SIDEBAR_W_RESPONDER = SIDEBAR_W

/**
 * Vertical space the mobile nav row occupies, including its safe-area padding.
 *
 * Anything that floats at the bottom of a mobile screen offsets by this so it
 * comes to rest above the nav instead of behind it.
 */
export const MOBILE_NAV_CLEARANCE =
  "calc(3.75rem + max(1.25rem, env(safe-area-inset-bottom) + 0.75rem))"

/**
 * Same, for the responder's full-width bottom bar. It is a flush bar rather
 * than a floating pill, so it sits 4rem tall against the viewport floor and
 * absorbs the safe-area inset itself instead of clearing it.
 */
export const MOBILE_BAR_CLEARANCE =
  "calc(4rem + env(safe-area-inset-bottom))"

/** Layout tokens — MUST match home body grid. */
export const FEED_MAX = 680
export const RAIL_W = 288
export const SEARCH_MAX = 480
export const CONTENT_GAP = 24
export const CONTENT_MAX = FEED_MAX + CONTENT_GAP + RAIL_W
/** Soft shell min at preferred sizes (not forced — see dashboard zoom min). */
export const LAYOUT_MIN = SIDEBAR_W + CONTENT_MAX

export function useMinWidth(px: number) {
  const [matches, setMatches] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= px : true,
  )

  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`)
    const apply = () => setMatches(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [px])

  return matches
}

export function useIsDesktop() {
  return useMinWidth(DESKTOP_MIN_PX)
}

export type ShellRole = "resident" | "official" | "responder"

export interface RouteChrome {
  /** Route renders a back-chevron chrome (settings/profile/notifications). */
  backChrome: boolean
  /** Route wants edge-to-edge map chrome (no page padding / bottom-nav gap). */
  fullBleedMap: boolean
  /** Bottom MobileNav should be hidden for this route. */
  hideMobileNav: boolean
  /**
   * Route owns its own vertical space: the shell's `main` stops scrolling
   * and the page fills it exactly (`h-full`), scrolling inside its own
   * panes instead.
   *
   * This is what lets the triage screens put a queue, a record and an
   * action panel side by side and have each scroll independently. On a
   * scrolling document those three columns share one scrollbar, so the
   * shortest one dictates the viewport and the tallest one pushes the
   * page down — which is how the concern view ended up with a 128px
   * primary column at 1280px wide.
   */
  workspace: boolean
}

/**
 * Port of the pathname-matching chrome logic previously inlined in
 * dashboard.tsx (~lines 58-70). Same routes → same booleans.
 *
 * Chrome is decided purely by pathname — the role-specific routes are already
 * distinct paths (e.g. `/dashboard/responders/map`), so no role argument is
 * needed. Add one back here if a shared path ever needs different chrome per
 * role.
 */
export function getRouteChrome(pathname: string): RouteChrome {
  const isAlertsMapRoute =
    pathname === "/dashboard/alerts-map" || pathname.endsWith("/alerts-map")
  const fullBleedMap = isAlertsMapRoute

  const backChrome =
    pathname.startsWith("/dashboard/profile") ||
    pathname.startsWith("/dashboard/notifications")

  const hideMobileNav = backChrome || fullBleedMap

  // Triage surfaces. Desktop only — below the desktop breakpoint these fall
  // back to a single scrolling column with list<->detail navigation, so the
  // shell must keep scrolling there.
  //
  // The responder dispatch console joins them: its left column (dispatch +
  // timeline) and right column (map + comms) each scroll on their own, which
  // only works if the shell stops scrolling around them. On a phone it reverts
  // to one scrolling column like the rest.
  const workspace =
    pathname === "/dashboard/emergencies" ||
    pathname === "/dashboard/reports" ||
    pathname.startsWith("/dashboard/reports/") ||
    pathname === "/dashboard/responders/dispatch" ||
    isAlertsMapRoute

  return { backChrome, fullBleedMap, hideMobileNav, workspace }
}
