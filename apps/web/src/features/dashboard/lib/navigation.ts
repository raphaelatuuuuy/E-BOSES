import type { LucideIcon } from "lucide-react"
import {
  BellIcon,
  ClipboardListIcon,
  ClockIcon,
  HomeIcon,
  LayoutDashboardIcon,
  MapPinnedIcon,
  MoreHorizontalIcon,
  Settings2Icon,
  SirenIcon,
  TriangleAlert,
  UserCircleIcon,
  UserCogIcon,
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
// Resident — unchanged from current sidebar/mobile-nav (no behavior change).
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
  icon: TriangleAlert,
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

const residentSettings: NavItemConfig = {
  key: "settings",
  label: "Settings",
  to: "/dashboard/settings",
  icon: Settings2Icon,
  isActive: (pathname) => matches(pathname, "/dashboard/settings"),
}

const residentNav: RoleNavConfig = {
  items: [residentHome, residentAlerts, residentReports],
  footer: [residentSettings],
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
  icon: LayoutDashboardIcon,
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
}

const officialEmergencies: NavItemConfig = {
  key: "emergencies",
  label: "Emergencies",
  to: "/dashboard/emergencies",
  icon: SirenIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/emergencies"),
  section: "Operations",
}

const officialConcerns: NavItemConfig = {
  key: "concerns",
  label: "Concerns",
  to: "/dashboard/reports",
  icon: ClipboardListIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/reports"),
  section: "Operations",
}

const officialCommunity: NavItemConfig = {
  key: "community",
  label: "Community",
  to: "/dashboard/community-content",
  icon: UsersIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/community-content"),
  section: "Manage",
}

const officialConfiguration: NavItemConfig = {
  key: "configuration",
  label: "Configuration",
  to: "/dashboard/configuration",
  icon: Settings2Icon,
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
  icon: BellIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/notifications"),
}

const officialProfile: NavItemConfig = {
  key: "profile",
  label: "Profile",
  to: "/dashboard/profile",
  icon: UserCircleIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/profile"),
}

// Phase B: officials-facing settings — mirrors the resident footer item.
const officialSettings: NavItemConfig = {
  key: "settings",
  label: "Settings",
  to: "/dashboard/settings",
  icon: UserCogIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/settings"),
}

// The mobile pill gives each tab ~72px, so the long sidebar labels are
// shortened rather than allowed to wrap or clip.
const officialOperationsMapMobile: NavItemConfig = { ...officialOperationsMap, label: "Alerts" }
const officialEmergenciesMobile: NavItemConfig = { ...officialEmergencies, label: "SOS" }

const officialMoreItems: NavItemConfig[] = [
  officialCommunity,
  officialConfiguration,
  officialNotifications,
  officialProfile,
  officialSettings,
]

const officialNav: RoleNavConfig = {
  items: [
    officialOverview,
    officialOperationsMap,
    officialEmergencies,
    officialConcerns,
    officialCommunity,
    officialConfiguration,
  ],
  // Nothing sits below the nav list: the account block owns profile,
  // notifications and settings, so Settings is no longer a top-level item.
  footer: [],
  account: [
    officialNotifications,
    officialSettings,
  ],
  mobileItems: [
    officialOverview,
    officialOperationsMapMobile,
    officialEmergenciesMobile,
    officialConcerns,
  ],
  more: {
    label: "More",
    icon: MoreHorizontalIcon,
    items: officialMoreItems,
    isActive: (pathname) => officialMoreItems.some((item) => item.isActive(pathname)),
  },
}

// ---------------------------------------------------------------------------
// Responder — Map and Shift are the whole job. Profile is personal, so it sits
// behind the account block like the official's does, not in the nav.
// ---------------------------------------------------------------------------

const responderMap: NavItemConfig = {
  key: "map",
  label: "Map",
  to: "/dashboard/responders/map",
  icon: MapPinnedIcon,
  isActive: (pathname) => matches(pathname, "/dashboard/responders/map"),
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

const responderNav: RoleNavConfig = {
  items: [responderMap, responderShift],
  footer: [],
  // Populating `account` is what turns the sidebar's identity block from inert
  // text into a disclosure, so the avatar becomes the way in — same interaction
  // the official already has.
  account: [{ ...responderProfile, label: "View profile" }],
  // The Dispatch action rides beside this pill rather than inside it, mirroring
  // the resident's SOS button.
  mobileItems: [responderMap, responderShift],
}

export const navigationByRole: Record<Role, RoleNavConfig> = {
  resident: residentNav,
  official: officialNav,
  responder: responderNav,
}

export function getRoleNav(role: Role): RoleNavConfig {
  return navigationByRole[role]
}
