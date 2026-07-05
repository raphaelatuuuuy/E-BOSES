import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HomeIcon,
  CircleUserIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { useSidebar } from "@/features/dashboard/components/sidebar-context"

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

const bottomNavItems: NavItem[] = []

export function Sidebar() {
  const { isOpen, toggle } = useSidebar()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const [profileOpen, setProfileOpen] = useState(false)

  function isActive(path: string) {
    return location.pathname === path
  }

  function handleSignOut() {
    signOut()
    navigate("/")
  }

  const initials = user ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` : "?"
  const avatarKey = user?.avatar || (user?.gender && user?.gender !== "prefer_not_to_say" && user?.date_of_birth
    ? (() => {
        const age = new Date().getFullYear() - new Date(user.date_of_birth!).getFullYear()
        const bucket = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
        const icon = user.gender === "male" ? "man" : "woman"
        return `${bucket}-${icon}`
      })()
    : "")
  const displayName = user ? `${(user.firstName ?? "").split(/\s+/)[0]} ${user.lastName ?? ""}`.trim() : "User"
  const displayRole = user?.role?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "Resident"

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-svh flex-col border-r border-background/10 bg-foreground motion-safe:transition-all motion-safe:duration-300",
        isOpen ? "w-60" : "w-16",
      )}
    >
      {/* Profile section */}
      <div className="border-b border-white/10">
        <button
          type="button"
          onClick={() => setProfileOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-background/10",
            !isOpen && "justify-center px-0",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background/10 text-sm font-bold text-background">
            {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" /> : initials}
          </span>
          {isOpen && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-background">
                  {displayName}
                </p>
                <p className="truncate text-xs text-background/70">
                  {displayRole}
                </p>
              </div>
              {profileOpen ? (
                <ChevronUpIcon className="size-4 shrink-0 text-background/60" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 text-background/60" />
              )}
            </>
          )}
        </button>

        {/* Expandable submenu */}
        {isOpen && profileOpen && (
          <div className="border-t border-white/10 pb-2 pt-1">
            <Link
              to="/dashboard/profile"
              className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-background/65 transition-colors hover:text-primary"
            >
              <CircleUserIcon className="size-4 shrink-0" />
              <span>Profile</span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-2 text-sm font-medium text-background/65 transition-colors hover:text-primary"
            >
              <LogOutIcon className="size-4 shrink-0" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 p-2">
        <ul className="flex flex-col gap-1">
          {topNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path} className="group/nav relative">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium motion-safe:transition-colors",
                    active
                      ? "text-primary"
                      : "text-background/65 hover:text-primary",
                    isOpen ? "gap-3" : "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
                {!isOpen && (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/nav:opacity-100">
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
          {bottomNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path} className="group/btm relative">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium motion-safe:transition-colors",
                    active
                      ? "text-primary"
                      : "text-background/65 hover:text-primary",
                    isOpen ? "gap-3" : "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
                {!isOpen && (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/btm:opacity-100">
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
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/toggle:opacity-100">
                Collapse
              </span>
            )}
          </li>
        </ul>
      </div>
    </aside>
  )
}
