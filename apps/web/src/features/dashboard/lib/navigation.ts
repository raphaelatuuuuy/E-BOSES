import type { LucideIcon } from "lucide-react"
import {
  InboxIcon,
  BoltIcon,
  ClipboardListIcon,
  ChartColumn,
  HomeIcon,
  MapPinnedIcon,
  NewspaperIcon,
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

const residentFeed: NavItemConfig = {
  key: "feed",
  label: "Feed",
  to: "/dashboard/feed",
  icon: NewspaperIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/feed"),
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

const residentAlertsMobile: NavItemConfig = {
  ...residentAlerts,
  label: "Alerts",
}

const residentNav: RoleNavConfig = {
  items: [residentHome, residentFeed, residentAlerts, residentReports],
  footer: [],

  // Mirrors current mobile-nav.tsx order: Home, Feed, Map.
  mobileItems: [residentHome, residentFeed, residentAlertsMobile],
}

// ---------------------------------------------------------------------------
// Official — Concerns owns both routine reports and emergency reports. The
// sidebar promotes that same row to the emergency icon while live emergencies
// are present; Configuration keeps its 5 children.
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
  isActive: (pathname) =>
    matches(pathname, "/dashboard/reports") || matches(pathname, "/dashboard/emergencies"),
  section: "Operations",
  capability: "resolve_concerns",
}

const officialCommunity: NavItemConfig = {
  key: "community",
  label: "Announcements",
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

// The mobile pill gives each tab ~72px, so the long sidebar labels are
// shortened rather than allowed to wrap or clip.
const officialOperationsMapMobile: NavItemConfig = {
  ...officialOperationsMap,
  label: "Alerts",
  // The live map is readable by every official; geography is only required
  // for changing its configuration.
  capability: undefined,
}

const officialOverviewMobile: NavItemConfig = {
  ...officialOverview,
  label: "Home",
  icon: HomeIcon,
}

const officialFeedMobile: NavItemConfig = {
  key: "feed",
  label: "Feed",
  to: "/dashboard/feed",
  icon: NewspaperIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/feed"),
}

const officialConcernsMobile: NavItemConfig = {
  ...officialConcerns,
  label: "Reports",
  capability: undefined,
}

const officialNav: RoleNavConfig = {
  items: [
    officialOverview,
    officialOperationsMap,
    officialConcerns,
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
    officialOverviewMobile,
    officialFeedMobile,
    officialConcernsMobile,
    officialOperationsMapMobile,
  ],
  more: {
    label: "Config",
    icon: BoltIcon,
    // The official mobile tab is a direct destination, not an overflow sheet.
    // Keep the shape for shared navigation typing and desktop consumers.
    items: [officialConfiguration],
    isActive: (pathname) => officialConfiguration.isActive(pathname),
  },
}

// ---------------------------------------------------------------------------
// Responder — responders work from the same light map and concern queue as
// officials. Presence and nearest-responder dispatch are automatic; there is
// no dispatch or shift destination in the navigation.
// ---------------------------------------------------------------------------

const responderAlerts: NavItemConfig = {
  key: "alerts-map",
  label: "Alert map",
  to: "/dashboard/alerts-map",
  icon: MapPinnedIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/alerts-map"),
}

const responderOverview: NavItemConfig = {
  key: "overview",
  label: "Overview",
  to: "/dashboard/overview",
  icon: ChartColumn,
  isActive: (pathname) => matches(pathname, "/dashboard/overview"),
}

const responderConcerns: NavItemConfig = {
  key: "concerns",
  label: "Concerns",
  to: "/dashboard/reports",
  icon: ClipboardListIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/reports"),
}

const responderFeed: NavItemConfig = {
  key: "feed",
  label: "Feed",
  to: "/dashboard/feed",
  icon: NewspaperIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/feed"),
}

const responderConcernsMobile: NavItemConfig = {
  ...responderConcerns,
  label: "Reports",
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
  items: [responderOverview, responderAlerts, responderConcerns, responderFeed],
  footer: [],
  // Personal destinations, revealed by the account block: Profile first,
  // Notifications below it (both open as dialogs on desktop).
  account: [
    { ...responderProfile, label: "View profile" },
    responderNotifications,
  ],
  mobileItems: [
    { ...responderOverview, label: "Home", icon: HomeIcon },
    responderFeed,
    responderConcernsMobile,
    { ...responderAlerts, label: "Alerts" },
  ],
}

export const navigationByRole: Record<Role, RoleNavConfig> = {
  resident: residentNav,
  official: officialNav,
  responder: responderNav,
}

export function getRoleNav(role: Role): RoleNavConfig {
  return navigationByRole[role]
}
