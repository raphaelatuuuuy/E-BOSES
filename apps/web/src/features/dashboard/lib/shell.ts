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

/** Preferred (max) sidebar width at full size — resident feed shell. */
export const SIDEBAR_W = 360
/** Floor when zooming / narrow CSS viewport — keep nav readable without eating the main pane. */
export const SIDEBAR_MIN = 220

/**
 * Staff (official/responder) sidebar: a fixed 232px navy panel with full text
 * labels, section headings and an account block pinned to the bottom.
 *
 * Labels (not an icon rail) because barangay staff are volunteers trained only
 * on Word and Excel (research.md, "Peopleware/Manpower") — icon-only navigation
 * would make them guess. 232px is wide enough for "Configuration" plus a count
 * badge and still leaves the resident shell's wider feed nav untouched.
 */
export const SIDEBAR_W_STAFF = 232

/**
 * Responder sidebar — wider than the official's 232px because it hosts the
 * identity block (avatar + name + position) and the centred nav group, which
 * need a little more air than the official's text rows.
 */
export const SIDEBAR_W_RESPONDER = 248

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

/**
 * Desktop vs. mobile shell hook — matchMedia(`min-width: DESKTOP_MIN_PX`).
 * Moved from dashboard.tsx's `useResidentDesktop` (identical behavior).
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= DESKTOP_MIN_PX : true,
  )

  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_PX}px)`)
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  return isDesktop
}

export type ShellRole = "resident" | "official" | "responder"

export interface RouteChrome {
  /** Route renders a back-chevron chrome (settings/profile/notifications). */
  backChrome: boolean
  /** Route is part of the account verification wizard (own full-bleed flow). */
  accountWizard: boolean
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
    pathname.startsWith("/dashboard/settings") ||
    pathname.startsWith("/dashboard/profile") ||
    pathname.startsWith("/dashboard/notifications")

  const accountWizard =
    pathname.startsWith("/dashboard/settings/reverify/") ||
    pathname === "/dashboard/settings/change-password"

  const hideMobileNav = backChrome || accountWizard || fullBleedMap

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

  return { backChrome, accountWizard, fullBleedMap, hideMobileNav, workspace }
}
