import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  BarChart3Icon,
  CircleUserIcon,
  HomeIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"

type NavItem = {
  label: string
  path: string | null
  icon: typeof HomeIcon
  isCenter?: boolean
}

const navItems: NavItem[] = [
  { label: "Home", path: "/dashboard/home", icon: HomeIcon },
  { label: "Feed", path: "/dashboard/feed", icon: UsersIcon },
  { label: "Create", path: null, icon: PlusIcon, isCenter: true },
  { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
  { label: "Profile", path: "/dashboard/profile", icon: CircleUserIcon },
]

export function MobileNav() {
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card shadow-lg md:hidden">
        <div className="mx-3 mb-3 mt-1 flex items-end justify-around rounded-[2rem] border border-border/60 bg-background px-3 pb-3 pt-2 shadow-sm">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.path ? location.pathname === item.path : false

            if (item.isCenter) {
              return (
                <button
                  key="create"
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="-mt-5 flex flex-col items-center gap-0.5"
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/30">
                    <PlusIcon className="size-6 text-primary-foreground" />
                  </div>
                  <span className="text-xs font-semibold text-primary">
                    {item.label}
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={item.path}
                to={item.path!}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-6" />
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
