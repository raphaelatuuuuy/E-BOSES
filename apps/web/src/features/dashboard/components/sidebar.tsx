import { Link, useLocation } from "react-router-dom"
import {
  AlertTriangleIcon,
  BarChart3Icon,
  FileCheck2Icon,
  HomeIcon,
  MapPinnedIcon,
  PhoneIcon,
  Settings2Icon,
  ShieldCheckIcon,
  BrainCircuitIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

import { useSidebar } from "@/features/dashboard/components/sidebar-context"
import { useAuthSession } from "@/features/auth/auth-session"
import { computeDefaultAvatar } from "@/features/dashboard/avatar-utils"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

/** Resident nav — text only (icons removed) */
const residentNavItems: { label: string; path: string }[] = [
  { label: "Home", path: "/dashboard/home" },
  { label: "Report", path: "/dashboard/reports" },
  { label: "Alerts", path: "/dashboard/feed" },
]

const officialNavItems: NavItem[] = [
  { label: "Dashboard", path: "/dashboard/home", icon: HomeIcon },
  { label: "Alerts Map", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
  { label: "Emergency Ops", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
  { label: "Concerns", path: "/dashboard/reports", icon: BarChart3Icon },
  { label: "Verification Queue", path: "/dashboard/verification-queue", icon: FileCheck2Icon },
  { label: "ID & Proof Templates", path: "/dashboard/ocr-templates", icon: Settings2Icon },
  { label: "Concern Classification", path: "/dashboard/concern-classification", icon: BrainCircuitIcon },
  { label: "Admin", path: "/dashboard/admin", icon: ShieldCheckIcon },
]

const responderNavItems: NavItem[] = []

const bottomNavItems: NavItem[] = [
  { label: "Profile", path: "/dashboard/profile", icon: UsersIcon },
]

type SosPlacement = "inline" | "sidebar" | "compact"

function normalizeSosPlacement(value: string | null): SosPlacement {
  if (value === "bottom_bar") return "sidebar"
  if (value === "floating") return "inline"
  if (value === "sidebar" || value === "compact" || value === "inline") return value
  return "inline"
}

function SidebarSosButton({ isOpen }: { isOpen: boolean }) {
  const [placement, setPlacement] = useState<SosPlacement>(() =>
    normalizeSosPlacement(localStorage.getItem("eboses:sos-placement")),
  )

  useEffect(() => {
    function handlePlacement(event: Event) {
      const nextPlacement = (event as CustomEvent<{ placement?: SosPlacement }>).detail
        ?.placement
      setPlacement(
        normalizeSosPlacement(nextPlacement || localStorage.getItem("eboses:sos-placement")),
      )
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

/** Nextdoor-style nav column — logo lives in ResidentTopBar; sticky under top bar */
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
      {/* Nav under logo (logo is sibling in dashboard left column) */}
      <aside className="flex h-full min-h-0 w-full flex-col bg-white">
        <nav className="flex flex-1 flex-col pt-6">
          <ul className="flex flex-col gap-0.5 px-3">
            {residentNavItems.map((item) => {
              const active = isActive(item.path)
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-11 items-center rounded-lg px-2.5 text-[15px] font-light transition-[background-color,color,font-weight] duration-150",
                      "hover:font-medium focus-visible:font-medium active:font-medium",
                      active
                        ? "bg-neutral-100 font-medium text-[#07145f]"
                        : "text-neutral-700 hover:bg-neutral-50 hover:text-[#07145f] focus-visible:text-[#07145f]",
                    )}
                  >
                    <span className="leading-none">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Wider than nav links — nearly full sidebar column */}
          <div className="mt-3 px-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-11 w-full items-center justify-center rounded-full bg-[#ff6a1a] text-[15px] font-semibold tracking-wide text-white transition-colors hover:bg-[#e85f12] active:scale-[0.99]"
            >
              Report
            </button>
          </div>
        </nav>

        <div className="mt-auto px-3 pb-5 pt-2">
          <Link
            to="/dashboard/settings"
            className="flex h-10 items-center rounded-lg px-2.5 text-[15px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-[#07145f] focus-visible:text-[#07145f]"
          >
            Settings
          </Link>
        </div>
      </aside>

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

/** Dark admin sidebar (officials / responders) */
function StaffSidebar() {
  const { isOpen } = useSidebar()
  const location = useLocation()
  const { user } = useAuthSession()
  const isOfficialRole = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"
  const navItems = isOfficialRole ? officialNavItems : isResponderRole ? responderNavItems : []

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
      <div
        className={cn(
          "flex items-start gap-3 border-b border-white/10 px-4 py-4",
          !isOpen && "justify-center px-0 py-4",
        )}
      >
        <img src="/contents/logo.png" alt="E-Boses" className="size-10 shrink-0 object-contain" />
        {isOpen && (
          <div>
            <div className="text-lg font-bold tracking-wide text-white">
              E-<span className="text-orange-500">BOSES</span>
            </div>
            <div className="text-[10px] leading-tight text-white/80">
              YOUR VOICE.
              <br />
              OUR ACTION.
              <br />
              BETTER COMMUNITY.
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 p-2">
        <ul className="flex flex-col gap-1">
          <li className="group/sos relative">
            <Link
              to="/dashboard/emergencies"
              className={cn(
                "sos-glow flex w-full items-center rounded-lg bg-red-600 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(220,38,38,0.28)] transition-colors hover:bg-red-700",
                isOpen ? "gap-3 px-3 py-2.5" : "justify-center px-0 py-2.5",
              )}
            >
              <AlertTriangleIcon className="size-5 shrink-0" />
              {isOpen && <span>Alerts</span>}
            </Link>
            {!isOpen && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-red-600 px-3.5 text-xs font-bold text-white opacity-0 shadow-lg transition-opacity group-hover/sos:opacity-100">
                Emergency Ops
              </span>
            )}
          </li>
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
                    active ? "text-primary" : "text-background/65 hover:text-primary",
                    isOpen ? "gap-3" : "justify-center px-0",
                  )}
                >
                  {item.label === "Dashboard" ? (
                    <img
                      src="/contents/home.png"
                      alt=""
                      className="size-10 shrink-0 rounded-full object-cover"
                    />
                  ) : item.label === "Reports" || item.label === "Concerns" ? (
                    <img
                      src="/contents/reports.png"
                      alt=""
                      className="size-10 shrink-0 rounded-full object-cover"
                    />
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

      <div className="border-t border-white/10 p-2">
        <ul className="flex flex-col gap-1">
          {bottomNavItems.map((item) => {
            const isProfile = item.label === "Profile"
            const avatarKey = user ? computeDefaultAvatar(user) : ""
            const displayName = user
              ? `${(user.firstName ?? "").split(/\s+/)[0]} ${user.lastName ?? ""}`.trim()
              : "User"
            const displayRole =
              user?.role?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ??
              "Resident"

            return (
              <li key={item.path} className="group/btm relative">
                {isProfile ? (
                  <Link
                    to="/dashboard/profile"
                    className={cn(
                      "flex w-full items-center rounded-md px-3 text-sm font-medium motion-safe:transition-colors text-background/65 hover:text-primary",
                      isOpen ? "gap-3" : "justify-center px-0",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                      <img
                        src={`/contents/${avatarKey}.png`}
                        alt=""
                        className="block size-full scale-125 object-cover"
                      />
                    </span>
                    {isOpen && (
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                        <p className="truncate text-xs text-white/60">{displayRole}</p>
                      </div>
                    )}
                  </Link>
                ) : (
                  <Link
                    to={item.path}
                    className={cn(
                      "flex items-center rounded-md px-3 text-sm font-medium motion-safe:transition-colors",
                      isActive(item.path) ? "text-primary" : "text-background/65 hover:text-primary",
                      isOpen ? "gap-3" : "justify-center px-0",
                    )}
                  >
                    <item.icon className="size-10 shrink-0" />
                    {isOpen && <span>{item.label}</span>}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
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

export { SidebarSosButton }
