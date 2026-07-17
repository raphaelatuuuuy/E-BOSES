import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  AlertTriangleIcon,
  BarChart3Icon,
  FileCheck2Icon,
  HomeIcon,
  MapPinnedIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  SolarCommunityIcon,
  SolarHomeIcon,
  SolarReportsIcon,
} from "@/features/dashboard/components/resident-nav-icons"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { useAuthSession } from "@/features/auth/auth-session"

type NavItem = {
  label: string
  path: string | null
  icon?: typeof HomeIcon
  /** Resident SVG icon (regular ↔ solid) */
  NavIcon?: React.ComponentType<{ solid?: boolean; className?: string }>
  isCenter?: boolean
  isAvatar?: boolean
  /** Solid always (e.g. Report FAB) */
  solidAlways?: boolean
}

export function MobileNav() {
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const { user } = useAuthSession()

  const letter = (user?.firstName?.[0] || user?.lastName?.[0] || "?").toUpperCase()

  const isOfficialRole =
    user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"

  const navItems: NavItem[] = isOfficialRole
    ? [
        { label: "Map", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
        { label: "Concerns", path: "/dashboard/reports", icon: BarChart3Icon },
        { label: "Emergency", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
        { label: "Queue", path: "/dashboard/verification-queue", icon: FileCheck2Icon },
        { label: "IDs", path: "/dashboard/ocr-templates", icon: Settings2Icon },
        { label: "Admin", path: "/dashboard/admin", icon: ShieldCheckIcon },
        { label: "Profile", path: "/dashboard/profile", isAvatar: true },
      ]
    : isResponderRole
      ? [
          { label: "Emergency", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
          { label: "Profile", path: "/dashboard/profile", isAvatar: true },
        ]
      : [
          { label: "Home", path: "/dashboard/home", NavIcon: SolarHomeIcon },
          { label: "Community", path: "/dashboard/feed", NavIcon: SolarCommunityIcon },
          { label: "Report", path: null, isCenter: true, solidAlways: true },
          { label: "Reports", path: "/dashboard/reports", NavIcon: SolarReportsIcon },
          { label: "Profile", path: "/dashboard/profile", isAvatar: true },
        ]

  const isResident = !isOfficialRole && !isResponderRole

  return (
    <>
      <nav className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <div
          className={cn(
            "pointer-events-auto mx-auto flex min-h-[68px] items-end justify-around pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2",
            isResident
              ? "w-full border-t border-[#dfe3eb] bg-white px-2"
              : "mx-3 rounded-[2rem] border border-border/60 bg-white px-3 pb-3 pt-2 shadow-sm",
          )}
        >
          {navItems.map((item) => {
            const active = item.path
              ? location.pathname === item.path ||
                (item.path === "/dashboard/home" && location.pathname === "/dashboard")
              : false

            if (item.isCenter) {
              return (
                <button
                  key="create"
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="group -mt-5 flex min-w-[3.25rem] flex-col items-center gap-1"
                >
                  <div
                    className={cn(
                      "flex items-center justify-center rounded-full text-white shadow-sm",
                      isResident
                        ? "size-12 bg-[#ff8133]"
                        : "size-12 bg-primary shadow-primary/30",
                    )}
                  >
                    <i className="bx bxs-edit text-[20px] leading-none text-white" aria-hidden />
                  </div>
                  <span
                    className={cn(
                      "text-[12px] font-light leading-none",
                      isResident ? "text-[#ff6a1a]" : "text-primary",
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              )
            }

            if (item.isAvatar) {
              return (
                <Link
                  key={item.path}
                  to={item.path!}
                  className={cn(
                    "group flex min-w-[3.25rem] flex-col items-center gap-1 px-1 py-1 transition-colors",
                    active ? "text-neutral-900" : "text-neutral-500",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-[15px] font-semibold text-[#2c3a5a] ring-2",
                      active ? "ring-[#ff6a1a]/40" : "ring-transparent",
                    )}
                  >
                    {letter}
                  </span>
                  <span className="text-[12px] font-light leading-none">{item.label}</span>
                </Link>
              )
            }

            if (isResident && item.NavIcon) {
              const NavIcon = item.NavIcon
              return (
                <Link
                  key={item.path}
                  to={item.path!}
                  className={cn(
                    "group flex min-w-[3.25rem] flex-col items-center gap-1 px-1 py-1 transition-colors",
                    active ? "text-[#ff6a1a]" : "text-neutral-500",
                  )}
                >
                  <NavIcon
                    solid={active}
                    className={cn(
                      "size-8",
                      active ? "text-[#ff6a1a]" : "text-neutral-500",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[12px] font-light leading-none",
                      active && "font-normal text-[#ff6a1a]",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              )
            }

            const Icon = item.icon ?? SearchIcon
            return (
              <Link
                key={item.path}
                to={item.path!}
                className={cn(
                  "flex min-w-[3.25rem] flex-col items-center gap-1 px-1 py-1 transition-colors",
                  active ? "text-neutral-900" : "text-neutral-500",
                )}
              >
                {item.label === "Dashboard" || item.label === "Home" ? (
                  <img src="/contents/home.png" alt="" className="size-10 rounded-full object-cover" />
                ) : item.label === "Feed" ? (
                  <img src="/contents/feed.png" alt="" className="size-10 rounded-full object-cover" />
                ) : item.label === "Reports" || item.label === "Concerns" ? (
                  <img
                    src="/contents/reports.png"
                    alt=""
                    className="size-10 rounded-full object-cover"
                  />
                ) : (
                  <Icon className="size-6" />
                )}
                <span className="text-[12px] font-light leading-none">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
