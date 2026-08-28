import type { LucideIcon } from "lucide-react"
import {
  InboxIcon,
  BoltIcon,
  ClipboardListIcon,
  ChartColumn,
  ClockIcon,
  HomeIcon,
  MapPinnedIcon,
  MoreHorizontalIcon,
  TriangleAlert,
  UserCircleIcon,
  UsersIcon,
} from "lucide-react"

/**
 * Single source of truth for dashboard navigation IA — consumed by both
 * sidebar.tsx (desktop) and mobile-nav.tsx (bottom pill + official "More"
 * sheet). Adding/removing a destination here updates both surfaces.
 */

export type Role = "resident" | "official" | "responder"

export interface NavChildConfig {
  key: string
  label: string
  to: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
}

export interface NavItemConfig {
  key: string
  label: string
  to: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
  /**
   * Capability required to see this destination. Filtering is presentation
   * only — the endpoints behind each screen enforce the same capability
   * server-side. Undefined means every role that has this nav can see it.
   */
  capability?: string
  children?: NavChildConfig[]
  /**
   * Heading this item sits under in the labelled staff sidebar. Items sharing
   * a section render as one group; the heading prints once, above the first.
   * Omitted on resident/responder navs, which are short enough to be flat.
   */
  section?: string
}

export interface MoreSheetConfig {
  label: string
  icon: LucideIcon
  items: NavItemConfig[]
  isActive: (pathname: string) => boolean
}

export interface RoleNavConfig {
  /** Desktop sidebar items, in order. */
  items: NavItemConfig[]
  /** Desktop sidebar footer items (below the scrollable list), in order. */
  footer: NavItemConfig[]
  /**
   * Items revealed by the sidebar's account block. Personal destinations
   * (profile, notifications, settings) live here rather than in the main nav,
   * which is reserved for barangay work.
   */
  account?: NavItemConfig[]
  /** Mobile bottom-pill items, in order (excludes the official "More" tab). */
  mobileItems: NavItemConfig[]
  /** Official-only: mobile "More" tab, opens a Sheet listing `items`. */
  more?: MoreSheetConfig
}

function matches(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`)
}

// ---------------------------------------------------------------------------
// Resident mobile navigation uses the same compact, expanding-label treatment
// as the official navigation; only the destinations differ.
// ---------------------------------------------------------------------------

function isResidentHomeActive(pathname: string) {
  return (
    pathname === "/dashboard/home" ||
    pathname === "/dashboard" ||
    pathname === "/dashboard/"
  )
}

const residentHome: NavItemConfig = {
  key: "home",
  label: "Home",
  to: "/dashboard/home",
  icon: HomeIcon,
  isActive: isResidentHomeActive,
}

const residentAlerts: NavItemConfig = {
  key: "alerts",
  label: "Alerts",
  to: "/dashboard/alerts-map",
  icon: MapPinnedIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/alerts-map"),
}

const residentReports: NavItemConfig = {
  key: "reports",
  label: "My reports",
  to: "/dashboard/reports",
  icon: ClipboardListIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/reports"),
}

const residentReportsMobile: NavItemConfig = {
  ...residentReports,
  label: "Reports",
}

const residentNav: RoleNavConfig = {
  items: [residentHome, residentAlerts, residentReports],
  footer: [],

  // Mirrors current mobile-nav.tsx order: Home, Reports, Alerts.
  mobileItems: [residentHome, residentReportsMobile, residentAlerts],
}

// ---------------------------------------------------------------------------
// Official — gains Emergencies + Community (routes already exist in App.tsx
// but were unreachable from any nav); Configuration keeps its 5 children.
// ---------------------------------------------------------------------------

// Configuration is one destination now. It previously carried five children in
// a sidebar flyout and needs to hold eleven sections, so the sections live on a
// hub page instead — which also means a single path prefix decides active
// state, replacing the three overlapping legacy matchers that used to be here.

const officialOverview: NavItemConfig = {
  key: "overview",
  label: "Overview",
  to: "/dashboard/overview",
  icon: ChartColumn,
  isActive: (pathname) => matches(pathname, "/dashboard/overview"),
  section: "Operations",
}

const officialOperationsMap: NavItemConfig = {
  key: "operations-map",
  label: "Alert map",
  to: "/dashboard/alerts-map",
  icon: MapPinnedIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/alerts-map"),
  section: "Operations",
  capability: "configure_geography",
}

const officialConcerns: NavItemConfig = {
  key: "concerns",
  label: "Concerns",
  to: "/dashboard/reports",
  icon: ClipboardListIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/reports") || matches(pathname, "/dashboard/emergencies"),
  section: "Operations",
  capability: "resolve_concerns",
}

const officialCommunity: NavItemConfig = {
  key: "community",
  label: "Community",
  to: "/dashboard/community-content",
  icon: UsersIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/community-content"),
  section: "Manage",
  capability: "publish_announcements",
}

const officialConfiguration: NavItemConfig = {
  key: "configuration",
  label: "Configuration",
  to: "/dashboard/configuration",
  icon: BoltIcon,
  isActive: (pathname) =>
    matches(pathname, "/dashboard/configuration") ||
    // Legacy deep links that still redirect into Configuration.
    pathname.startsWith("/dashboard/ocr-") ||
    pathname.startsWith("/dashboard/verification-queue") ||
    pathname.startsWith("/dashboard/concern-classification") ||
    pathname.startsWith("/dashboard/admin"),
  section: "Manage",
}

const officialNotifications: NavItemConfig = {
  key: "notifications",
  label: "Notifications",
  to: "/dashboard/notifications",
  icon: InboxIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/notifications"),
}

const officialProfile: NavItemConfig = {
  key: "profile",
  label: "Profile",
  to: "/dashboard/profile",
  icon: UserCircleIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/profile"),
}

// The mobile pill gives each tab ~72px, so the long sidebar labels are
// shortened rather than allowed to wrap or clip.
const officialOperationsMapMobile: NavItemConfig = { ...officialOperationsMap, label: "Alerts" }

const officialMoreItems: NavItemConfig[] = [
  officialCommunity,
  officialConfiguration,
  officialNotifications,
  officialProfile,
]

const officialNav: RoleNavConfig = {
  items: [
    officialConcerns,
    officialOverview,
    officialOperationsMap,
    officialCommunity,
    officialConfiguration,
  ],
  // Nothing sits below the nav list: the account block owns profile and
  // notifications, and Settings lives behind the profile pop-up's gear icon.
  footer: [],
  account: [
    officialNotifications,
  ],
  mobileItems: [
    officialConcerns,
    officialOverview,
    officialOperationsMapMobile,
  ],
  more: {
    label: "More",
    icon: MoreHorizontalIcon,
    items: officialMoreItems,
    isActive: (pathname) => officialMoreItems.some((item) => item.isActive(pathname)),
  },
}

// ---------------------------------------------------------------------------
// Responder — Dispatch is the job; Map answers "where is everything"; Shift is
// the record of the day. Profile and Notifications are personal, so they sit
// behind the account block like the official's do, not in the nav.
// ---------------------------------------------------------------------------

export const responderDispatch: NavItemConfig = {
  key: "dispatch",
  label: "Dispatch",
  to: "/dashboard/responders/dispatch",
  icon: TriangleAlert,
  isActive: (pathname) => matches(pathname, "/dashboard/responders/dispatch"),
}

const responderShift: NavItemConfig = {
  key: "shift",
  label: "Shift",
  to: "/dashboard/responders/shift",
  icon: ClockIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/responders/shift"),
}

const responderProfile: NavItemConfig = {
  key: "profile",
  label: "Profile",
  to: "/dashboard/responders/profile",
  icon: UserCircleIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/responders/profile"),
}

const responderNotifications: NavItemConfig = {
  key: "notifications",
  label: "Notifications",
  to: "/dashboard/notifications",
  icon: InboxIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/notifications"),
}

const responderNav: RoleNavConfig = {
  items: [responderDispatch, responderShift],
  footer: [],
  // Personal destinations, revealed by the account block: Profile first,
  // Notifications below it (both open as dialogs on desktop).
  account: [
    { ...responderProfile, label: "View profile" },
    responderNotifications,
  ],
  // The mobile pill carries exactly the job tabs — Shift | Dispatch — each a
  // circle at rest, an oblong when its page is open, and Dispatch turns
  // SOS-red while a dispatch is assigned.
  mobileItems: [responderShift, responderDispatch],
}

export const navigationByRole: Record<Role, RoleNavConfig> = {
  resident: residentNav,
  official: officialNav,
  responder: responderNav,
}

export function getRoleNav(role: Role): RoleNavConfig {
  return navigationByRole[role]
}
