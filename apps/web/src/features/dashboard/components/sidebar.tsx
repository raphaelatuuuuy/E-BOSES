import { Link, useLocation } from "react-router-dom"
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  FileCheck2Icon,
  HomeIcon,
  MapPinnedIcon,
  Settings2Icon,
  ShieldCheckIcon,
  ClipboardListIcon,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { FeedUserAvatar } from "@/features/dashboard/components/feed-post-card"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

/** Same Flaticon glyphs as mobile bottom nav: home · alerts · reports */
const residentNavItems: { label: string; path: string; iconSrc: string }[] = [
  { label: "Home", path: "/dashboard/home", iconSrc: "/contents/nav-home.png" },
  { label: "Alerts", path: "/dashboard/alerts-map", iconSrc: "/contents/nav-alert.png" },
  { label: "My reports", path: "/dashboard/reports", iconSrc: "/contents/nav-clipboard.png" },
]

function NavMaskIcon({ src, className }: { src: string; className?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
      aria-hidden
    />
  )
}

const officialNavItems: NavItem[] = [
  { label: "Dashboard", path: "/dashboard/home", icon: HomeIcon },
  { label: "Alerts map", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
  { label: "Emergency ops", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
  { label: "Concerns", path: "/dashboard/reports", icon: ClipboardListIcon },
  { label: "Verification", path: "/dashboard/verification-queue", icon: FileCheck2Icon },
  { label: "ID templates", path: "/dashboard/ocr-templates", icon: Settings2Icon },
  { label: "Classification", path: "/dashboard/concern-classification", icon: BrainCircuitIcon },
  { label: "Admin", path: "/dashboard/admin", icon: ShieldCheckIcon },
]

const responderNavItems: NavItem[] = [
  { label: "Emergency ops", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
  { label: "Alerts map", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
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
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={navLinkClass(active)}
                  >
                    <NavMaskIcon src={item.iconSrc} className={navIconClass(active)} />
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
  const isOfficialRole = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"
  const navItems = isOfficialRole ? officialNavItems : isResponderRole ? responderNavItems : []

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

  const displayName = user
    ? `${(user.firstName ?? "").split(/\s+/)[0]} ${user.lastName ?? ""}`.trim() || user.email
    : "Staff"
  const displayRole =
    user?.role?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Official"

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 [scrollbar-width:thin]">
        {/* Primary emergency shortcut — orange/red CTA like resident Report */}
        <div className="px-3 pb-2">
          <Link
            to="/dashboard/emergencies"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[9999px] bg-[#f23b35] text-[15px] font-semibold text-white transition-colors hover:bg-[#e02f2a] active:scale-[0.99]"
          >
            <AlertTriangleIcon className="size-4" strokeWidth={2.25} />
            Emergency ops
          </Link>
        </div>

        <ul className="mt-2 flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const active = isActive(item.path)
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
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="shrink-0 space-y-1 bg-white px-3 pb-5 pt-2">
        <Link
          to="/dashboard/settings"
          className={cn(
            "flex h-10 items-center px-2.5 text-[16px] transition-[colors,font-weight]",
            isActive("/dashboard/settings")
              ? "font-semibold text-[#07145f]"
              : "font-medium text-neutral-600 hover:text-[#07145f]",
          )}
        >
          Settings
        </Link>
        <Link
          to="/dashboard/profile"
          className={cn(
            "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-neutral-50",
            isActive("/dashboard/profile") && "bg-neutral-50",
          )}
        >
          <FeedUserAvatar
            user={{
              id: user?.id ?? 0,
              full_name: displayName,
              initials: displayName.slice(0, 2).toUpperCase(),
              role: user?.role ?? "barangay_official",
              last_seen_at: null,
            }}
            size="sm"
            className="!size-9 !text-[14px]"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-neutral-900">{displayName}</p>
            <p className="truncate text-[12px] text-neutral-500">{displayRole}</p>
          </div>
        </Link>
      </div>
    </aside>
  )
}

export function Sidebar() {
  const { user } = useAuthSession()
  const isOfficialRole = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"

  if (!isOfficialRole && !isResponderRole) {
    return <ResidentSidebar />
  }

  return <StaffSidebar />
}

export function SidebarSosButton(_props: { isOpen: boolean }) {
  return null
}
