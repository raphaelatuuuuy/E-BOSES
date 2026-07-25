import { Link, useLocation } from "react-router-dom"
import {
  BrainCircuitIcon,
  ClockIcon,
  MapPinnedIcon,
  SlidersHorizontalIcon,
  Settings2Icon,
  ShieldCheckIcon,
  ClipboardListIcon,
  UserCircleIcon,
  FileLock2Icon,
  HomeIcon,
  BellIcon,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
  children?: NavItem[]
}

/** Lucide-react icons for resident nav: home · alerts · reports */
const residentNavItems: { label: string; path: string; icon: React.ElementType }[] = [
  { label: "Home", path: "/dashboard/home", icon: HomeIcon },
  { label: "Alerts", path: "/dashboard/alerts-map", icon: BellIcon },
  { label: "My reports", path: "/dashboard/reports", icon: ClipboardListIcon },
]

const officialNavItems: NavItem[] = [
  { label: "Alert", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
  { label: "Concerns", path: "/dashboard/reports", icon: ClipboardListIcon },
  {
    label: "Configuration",
    path: "/dashboard/configuration/id-proof-template",
    icon: Settings2Icon,
    children: [
      {
        label: "ID & Proof template",
        path: "/dashboard/configuration/id-proof-template",
        icon: ShieldCheckIcon,
      },
      {
        label: "Classification",
        path: "/dashboard/configuration/classification",
        icon: BrainCircuitIcon,
      },
      {
        label: "Map & Dispatch",
        path: "/dashboard/configuration/map-dispatch",
        icon: SlidersHorizontalIcon,
      },
      {
        label: "Users",
        path: "/dashboard/configuration/users",
        icon: UserCircleIcon,
      },
      {
        label: "Privacy requests",
        path: "/dashboard/configuration/privacy-requests",
        icon: FileLock2Icon,
      },
    ],
  },
]

const responderNavItems: NavItem[] = [
  { label: "Map", path: "/dashboard/responders/map", icon: MapPinnedIcon },
  { label: "Shift", path: "/dashboard/responders/shift", icon: ClockIcon },
]

function navLinkClass(active: boolean) {
  return cn(
    "group flex h-11 items-center gap-3 px-2.5 text-[16px] leading-none transition-[colors,font-weight] duration-150",
    "bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent",
    "hover:font-semibold focus-visible:font-semibold",
    active
      ? "font-semibold text-[#07145f]"
      : "font-light text-neutral-700 hover:text-[#07145f] focus-visible:text-[#07145f]",
  )
}

function navIconClass(active: boolean) {
  return cn(
    "size-5 shrink-0 transition-colors",
    active
      ? "text-[#07145f]"
      : "text-neutral-500 group-hover:text-[#07145f] group-focus-visible:text-[#07145f]",
  )
}

/** Nextdoor-style nav column — logo lives in ResidentLogoBar */
function ResidentSidebar() {
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)

  function isActive(path: string) {
    if (path === "/dashboard/home") {
      return (
        location.pathname === path ||
        location.pathname === "/dashboard" ||
        location.pathname === "/dashboard/"
      )
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  return (
    <>
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 [scrollbar-width:thin]">
          <ul className="flex flex-col gap-0.5 px-3">
            {residentNavItems.map((item) => {
              const active = isActive(item.path)
              const Icon = item.icon
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={navLinkClass(active)}
                  >
                    <Icon className={navIconClass(active)} />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="mt-3 px-3 pb-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-11 w-full items-center justify-center rounded-[9999px] bg-[#ff8133] text-[16px] font-semibold text-white transition-colors hover:bg-[#ea6f24] active:scale-[0.99]"
            >
              Report
            </button>
          </div>
        </nav>

        <div className="shrink-0 bg-white px-3 pb-5 pt-2">
          <Link
            to="/dashboard/settings"
            className={cn(
              "flex h-10 items-center px-2.5 text-[16px] transition-[colors,font-weight]",
              "bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent",
              isActive("/dashboard/settings")
                ? "font-semibold text-[#07145f]"
                : "font-medium text-neutral-600 hover:text-[#07145f] focus-visible:text-[#07145f]",
            )}
          >
            Settings
          </Link>
        </div>
      </aside>

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

/**
 * Official / responder sidebar — same white Nextdoor chrome as residents,
 * with staff destinations and letter avatar footer.
 */
function StaffSidebar() {
  const location = useLocation()
  const { user } = useAuthSession()
  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const navItems = isResponderRole ? responderNavItems : isOfficialRole ? officialNavItems : []

  function isActive(path: string) {
    if (path === "/dashboard/home") {
      return (
        location.pathname === path ||
        location.pathname === "/dashboard" ||
        location.pathname === "/dashboard/"
      )
    }
    if (path === "/dashboard/configuration/id-proof-template") {
      return (
        location.pathname === path ||
        location.pathname.startsWith(`${path}/`) ||
        location.pathname.startsWith("/dashboard/configuration/map-dispatch") ||
        location.pathname.startsWith("/dashboard/ocr-templates") ||
        location.pathname.startsWith("/dashboard/ocr-configuration") ||
        location.pathname.startsWith("/dashboard/verification-queue")
      )
    }
    if (path === "/dashboard/configuration/classification") {
      return (
        location.pathname === path ||
        location.pathname.startsWith(`${path}/`) ||
        location.pathname.startsWith("/dashboard/concern-classification")
      )
    }
    if (path === "/dashboard/configuration/users") {
      return (
        location.pathname === path ||
        location.pathname.startsWith(`${path}/`) ||
        location.pathname.startsWith("/dashboard/admin")
      )
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 [scrollbar-width:thin]">
        <ul className="flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const childActive = item.children?.some((child) => isActive(child.path)) ?? false
            const active = isActive(item.path) || childActive
            const Icon = item.icon
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={navLinkClass(active)}
                >
                  <Icon className={navIconClass(active)} strokeWidth={1.75} />
                  {item.label}
                </Link>
                {item.children && active ? (
                  <ul className="ml-8 mt-1 flex flex-col gap-0.5 border-l border-neutral-100 pl-2">
                    {item.children.map((child) => {
                      const childIsActive = isActive(child.path)
                      const ChildIcon = child.icon
                      return (
                        <li key={child.path}>
                          <Link
                            to={child.path}
                            aria-current={childIsActive ? "page" : undefined}
                            className={cn(
                              "group flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] leading-tight transition-colors",
                              childIsActive
                                ? "bg-[#fff4ed] font-semibold text-[#07145f]"
                                : "font-medium text-neutral-500 hover:bg-neutral-50 hover:text-[#07145f]",
                            )}
                          >
                            <ChildIcon className="size-3.5 shrink-0" strokeWidth={1.9} />
                            <span className="min-w-0">{child.label}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}

export function Sidebar() {
  const { user } = useAuthSession()
  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)

  if (!isOfficialRole && !isResponderRole) {
    return <ResidentSidebar />
  }

  return <StaffSidebar />
}

export function SidebarSosButton() {
  return null
}
