import { Link, useLocation } from "react-router-dom"
import {
  AlertTriangleIcon,
  BarChart3Icon,
  HomeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PhoneIcon,
  Settings2Icon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { useSidebar } from "@/features/dashboard/components/sidebar-context"
import { useAuthSession } from "@/features/auth/auth-session"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

const topNavItems: NavItem[] = [
  { label: "Home", path: "/dashboard/home", icon: HomeIcon },
  { label: "Feed", path: "/dashboard/feed", icon: UsersIcon },
  { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
]

const officialNavItems: NavItem[] = [
  { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
  { label: "Emergency Ops", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
  { label: "ID & Proof Templates", path: "/dashboard/ocr-templates", icon: Settings2Icon },
  { label: "Admin", path: "/dashboard/admin", icon: ShieldCheckIcon },
  { label: "Profile", path: "/dashboard/profile", icon: UsersIcon },
]

const responderNavItems: NavItem[] = [
  { label: "Emergency Ops", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
  { label: "Profile", path: "/dashboard/profile", icon: UsersIcon },
]

const bottomNavItems: NavItem[] = []
type SosPlacement = "inline" | "sidebar" | "compact"

function normalizeSosPlacement(value: string | null): SosPlacement {
  if (value === "bottom_bar") return "sidebar"
  if (value === "floating") return "inline"
  if (value === "sidebar" || value === "compact" || value === "inline") return value
  return "inline"
}

function SidebarSosButton({ isOpen }: { isOpen: boolean }) {
  const [placement, setPlacement] = useState<SosPlacement>(() => normalizeSosPlacement(localStorage.getItem("eboses:sos-placement")))

  useEffect(() => {
    function handlePlacement(event: Event) {
      const nextPlacement = (event as CustomEvent<{ placement?: SosPlacement }>).detail?.placement
      setPlacement(normalizeSosPlacement(nextPlacement || localStorage.getItem("eboses:sos-placement")))
    }
    window.addEventListener("eboses:sos-placement-change", handlePlacement)
    return () => window.removeEventListener("eboses:sos-placement-change", handlePlacement)
  }, [])

  if (placement !== "sidebar") return null

  return (
    <li className="group/sos relative">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
        className={cn(
          "sos-glow flex w-full items-center rounded-lg bg-red-600 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(220,38,38,0.28)] transition-colors hover:bg-red-700",
          isOpen ? "gap-3 px-3 py-2.5" : "justify-center px-0 py-2.5",
        )}
      >
        <PhoneIcon className="size-5 shrink-0" fill="currentColor" />
        {isOpen && <span>SOS</span>}
      </button>
      {!isOpen && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-red-600 px-3.5 text-xs font-bold text-white opacity-0 shadow-lg transition-opacity group-hover/sos:opacity-100">
          Send SOS
        </span>
      )}
    </li>
  )
}

export function Sidebar() {
  const { isOpen, toggle } = useSidebar()
  const location = useLocation()
  const { user } = useAuthSession()
  const isOfficialRole = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"
  const navItems = isOfficialRole ? officialNavItems : isResponderRole ? responderNavItems : topNavItems

  function isActive(path: string) {
    return location.pathname === path
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-svh flex-col border-r border-background/10 bg-foreground motion-safe:transition-all motion-safe:duration-300",
        isOpen ? "w-52" : "w-14",
      )}
    >
      {/* Logo section */}
      <div className={cn("flex items-start gap-3 border-b border-white/10 px-4 py-4", !isOpen && "justify-center px-0 py-4")}>
        <img src="/contents/logo.png" alt="E-Boses" className="size-10 shrink-0 object-contain" />
        {isOpen && (
          <div>
            <div className="text-lg font-bold tracking-wide text-white">
              E-<span className="text-orange-500">BOSES</span>
            </div>
            <div className="text-[10px] leading-tight text-white/80">
              YOUR VOICE.<br />
              OUR ACTION.<br />
              BETTER COMMUNITY.
            </div>
          </div>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 p-2">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path} className="group/nav relative">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 text-sm font-medium motion-safe:transition-colors",
                    active
                      ? "text-primary"
                      : "text-background/65 hover:text-primary",
                    isOpen ? "gap-3" : "justify-center px-0",
                  )}
                >
                  {item.label === "Home" ? (
                    <img src="/contents/home.png" alt="" className="size-10 shrink-0 rounded-full object-cover" />
                  ) : item.label === "Feed" ? (
                    <img src="/contents/feed.png" alt="" className="size-10 shrink-0 rounded-full object-cover" />
                  ) : item.label === "Reports" ? (
                    <img src="/contents/reports.png" alt="" className="size-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <Icon className="size-10 shrink-0" />
                  )}
                  {isOpen && <span>{item.label}</span>}
                </Link>
                {!isOpen && (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/nav:opacity-100">
                    {item.label}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer section */}
      <div className="border-t border-white/10 p-2">
        <ul className="flex flex-col gap-1">
          <SidebarSosButton isOpen={isOpen} />

          {bottomNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path} className="group/btm relative">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 text-sm font-medium motion-safe:transition-colors",
                    active
                      ? "text-primary"
                      : "text-background/65 hover:text-primary",
                    isOpen ? "gap-3" : "justify-center px-0",
                  )}
                >
                  <Icon className="size-10 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
                {!isOpen && (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/btm:opacity-100">
                    {item.label}
                  </span>
                )}
              </li>
            )
          })}

          {/* Toggle button */}
          <li className="group/toggle relative">
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-background/65 transition-colors hover:text-primary",
                isOpen ? "gap-3" : "justify-center px-0",
              )}
            >
              {isOpen ? (
                <PanelLeftCloseIcon className="size-5 shrink-0" />
              ) : (
                <PanelLeftOpenIcon className="size-5 shrink-0" />
              )}
              {isOpen && <span>Collapse</span>}
            </button>
            {!isOpen && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/toggle:opacity-100">
                Collapse
              </span>
            )}
          </li>
        </ul>
      </div>
    </aside>
  )
}
