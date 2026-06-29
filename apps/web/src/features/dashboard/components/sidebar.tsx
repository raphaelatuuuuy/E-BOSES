import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HomeIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RssIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useMockUser } from "@/features/dashboard/components/mock-user-context"
import { useSidebar } from "@/features/dashboard/components/sidebar-context"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

const topNavItems: NavItem[] = [
  { label: "Home", path: "/dashboard/home", icon: HomeIcon },
  { label: "Feed", path: "/dashboard/feed", icon: RssIcon },
  { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
]

const bottomNavItems: NavItem[] = [
  { label: "Settings", path: "/dashboard/settings", icon: SettingsIcon },
]

export function Sidebar() {
  const { isOpen, toggle } = useSidebar()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useMockUser()
  const [profileOpen, setProfileOpen] = useState(false)

  function isActive(path: string) {
    return location.pathname === path
  }

  function handleSignOut() {
    navigate("/")
  }

  const initials = `${user.firstName[0]}${user.lastName[0]}`

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 flex h-svh flex-col border-r border-white/10 bg-[#020c4e] transition-all duration-300",
        isOpen ? "w-60" : "w-16",
      )}
    >
      {/* Profile section */}
      <div className="border-b border-white/10">
        <button
          type="button"
          onClick={() => setProfileOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/5",
            !isOpen && "justify-center px-0",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">
            {initials}
          </span>
          {isOpen && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-blue-200/80">
                  {user.role}
                </p>
              </div>
              {profileOpen ? (
                <ChevronUpIcon className="size-4 shrink-0 text-white/60" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 text-white/60" />
              )}
            </>
          )}
        </button>

        {/* Expandable submenu */}
        {isOpen && profileOpen && (
          <div className="border-t border-white/10 pb-2 pt-1">
            <Link
              to="/dashboard/profile"
              className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              <UserIcon className="size-4 shrink-0" />
              <span>Profile</span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOutIcon className="size-4 shrink-0" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {topNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90",
                    !isOpen && "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer section */}
      <div className="border-t border-white/10 p-2">
        <ul className="space-y-1">
          {bottomNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90",
                    !isOpen && "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
              </li>
            )
          })}

          {/* Toggle button */}
          <li>
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "flex w-full items-center gap-3 rounded-none px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white/90",
                !isOpen && "justify-center px-0",
              )}
            >
              {isOpen ? (
                <PanelLeftCloseIcon className="size-5 shrink-0" />
              ) : (
                <PanelLeftOpenIcon className="size-5 shrink-0" />
              )}
              {isOpen && <span>Collapse</span>}
            </button>
          </li>
        </ul>
      </div>
    </aside>
  )
}
