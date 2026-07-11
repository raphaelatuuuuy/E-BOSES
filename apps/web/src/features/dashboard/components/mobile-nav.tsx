import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  AlertTriangleIcon,
  BarChart3Icon,
  HomeIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { useAuthSession } from "@/features/auth/auth-session"
import { computeDefaultAvatar } from "@/features/dashboard/avatar-utils"

type NavItem = {
  label: string
  path: string | null
  icon?: typeof HomeIcon
  isCenter?: boolean
  isAvatar?: boolean
}

export function MobileNav() {
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const { user } = useAuthSession()

  const initials = user ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` : "?"
  const avatarKey = user ? computeDefaultAvatar(user) : ""

  const isOfficialRole = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponderRole = user?.role === "first_responder"
  const navItems: NavItem[] = isOfficialRole
    ? [
        { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
        { label: "Emergency", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
        { label: "Admin", path: "/dashboard/admin", icon: ShieldCheckIcon },
        { label: "Profile", path: "/dashboard/profile", isAvatar: true },
      ]
    : isResponderRole
    ? [
        { label: "Emergency", path: "/dashboard/emergencies", icon: AlertTriangleIcon },
        { label: "Profile", path: "/dashboard/profile", isAvatar: true },
      ]
    : [
        { label: "Home", path: "/dashboard/home", icon: HomeIcon },
        { label: "Feed", path: "/dashboard/feed", icon: UsersIcon },
        { label: "Create", path: null, icon: PlusIcon, isCenter: true },
        { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
        { label: "Profile", path: "/dashboard/profile", isAvatar: true },
      ]

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-30 shadow-lg md:hidden">
        <div className="mx-3 mb-3 mt-1 flex items-end justify-around rounded-[2rem] border border-border/60 bg-white px-3 pb-3 pt-2 shadow-sm">
          {navItems.map((item) => {
            const active = item.path ? location.pathname === item.path : false

            if (item.isCenter) {
              const Icon = item.icon!
              return (
                <button
                  key="create"
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="-mt-5 flex flex-col items-center gap-0.5"
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/30">
                    <Icon className="size-6 text-primary-foreground" />
                  </div>
                  <span className="text-xs font-semibold text-primary">
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
                    "flex flex-col items-center gap-0.5 px-2 py-1 transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span className="flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-muted-foreground">
                    {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full object-cover" /> : initials}
                  </span>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              )
            }

            const Icon = item.icon!
            return (
              <Link
                key={item.path}
                to={item.path!}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {item.label === "Home" ? (
                  <img src="/contents/home.png" alt="" className="size-10 rounded-full object-cover" />
                ) : item.label === "Feed" ? (
                  <img src="/contents/feed.png" alt="" className="size-10 rounded-full object-cover" />
                ) : item.label === "Reports" ? (
                  <img src="/contents/reports.png" alt="" className="size-10 rounded-full object-cover" />
                ) : (
                  <Icon className="size-6" />
                )}
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Create Report dialog (controlled by nav button) */}
      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
