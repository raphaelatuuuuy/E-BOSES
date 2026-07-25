import type { ComponentType } from "react"
import {
  BellRinging,
  Clock,
  ClipboardText,
  FileLock,
  Funnel,
  Gear,
  House,
  MapPin,
  ShieldCheck,
  Siren,
  UserCircle,
  Users,
  Warning,
} from "@phosphor-icons/react"

import type { AuthUser } from "@/features/auth/api"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"

export type DashboardNavIcon = ComponentType<{
  className?: string
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone"
}>

export interface DashboardNavItem {
  label: string
  path: string
  icon: DashboardNavIcon
  children?: DashboardNavItem[]
}

const residentNavItems: DashboardNavItem[] = [
  { label: "Home", path: "/dashboard/home", icon: House },
  { label: "Alerts", path: "/dashboard/alerts-map", icon: Warning },
  { label: "My reports", path: "/dashboard/reports", icon: ClipboardText },
  { label: "History", path: "/dashboard/emergency-history", icon: Clock },
]

const officialNavItems: DashboardNavItem[] = [
  { label: "Operations", path: "/dashboard/alerts-map", icon: MapPin },
  { label: "Emergencies", path: "/dashboard/emergencies", icon: Siren },
  { label: "Concerns", path: "/dashboard/reports", icon: ClipboardText },
  { label: "Community", path: "/dashboard/community-content", icon: BellRinging },
  {
    label: "Configuration",
    path: "/dashboard/configuration/id-proof-template",
    icon: Gear,
    children: [
      { label: "ID & proof", path: "/dashboard/configuration/id-proof-template", icon: ShieldCheck },
      { label: "Classification", path: "/dashboard/configuration/classification", icon: Funnel },
      { label: "Map & dispatch", path: "/dashboard/configuration/map-dispatch", icon: MapPin },
      { label: "Users", path: "/dashboard/configuration/users", icon: UserCircle },
      { label: "Privacy requests", path: "/dashboard/configuration/privacy-requests", icon: FileLock },
    ],
  },
]

const responderNavItems: DashboardNavItem[] = [
  { label: "Dispatch", path: "/dashboard/responders/map", icon: MapPin },
  { label: "Shift", path: "/dashboard/responders/shift", icon: Clock },
  { label: "Profile", path: "/dashboard/responders/profile", icon: Users },
]

export function dashboardRoleFor(user?: AuthUser | null) {
  if (isResponderUser(user)) return "responder"
  if (isOfficialUser(user)) return "official"
  return "resident"
}

export function dashboardNavItemsFor(user?: AuthUser | null): DashboardNavItem[] {
  const role = dashboardRoleFor(user)
  if (role === "responder") return responderNavItems
  if (role === "official") return officialNavItems
  return residentNavItems
}

export function isDashboardNavItemActive(pathname: string, item: DashboardNavItem): boolean {
  if (item.path === "/dashboard/home") {
    return pathname === "/dashboard" || pathname === "/dashboard/" || pathname === item.path
  }
  if (item.path === "/dashboard/configuration/id-proof-template" && item.children?.length) {
    return (
      pathname.startsWith("/dashboard/configuration") ||
      pathname.startsWith("/dashboard/ocr-templates") ||
      pathname.startsWith("/dashboard/ocr-configuration") ||
      pathname.startsWith("/dashboard/verification-queue") ||
      pathname.startsWith("/dashboard/concern-classification") ||
      pathname.startsWith("/dashboard/admin")
    )
  }
  if (item.path === "/dashboard/configuration/id-proof-template") {
    return (
      pathname === item.path ||
      pathname.startsWith(`${item.path}/`) ||
      pathname.startsWith("/dashboard/ocr-templates") ||
      pathname.startsWith("/dashboard/ocr-configuration") ||
      pathname.startsWith("/dashboard/verification-queue")
    )
  }
  if (item.children?.some((child) => isDashboardNavItemActive(pathname, child))) {
    return true
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}
