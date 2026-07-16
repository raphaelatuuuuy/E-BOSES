import { SearchIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { useAuthSession } from "@/features/auth/auth-session"

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false)
  const { user } = useAuthSession()

  const isStaffRole = user?.role === "barangay_official" || user?.role === "first_responder" || user?.is_staff || user?.is_superuser

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center bg-[#f7f8fc] px-6 md:gap-3 md:px-10">
        {/* Left: Search icon (mobile) */}
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            aria-label="Toggle search"
          >
            {searchOpen ? <XIcon className="size-5" /> : <SearchIcon className="size-5" />}
          </button>
        </div>

        {/* Desktop search — left side */}
        <div className="hidden md:flex md:flex-1">
          <div className="group relative w-full max-w-lg">
            <SearchIcon
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary"
            />
            <Input
              type="text"
              aria-label="Search reports and community updates"
              placeholder="Search reports, posts, or residents"
              className={cn(
                "h-10 rounded-none border-0 border-b border-border bg-transparent pl-9 text-sm shadow-none",
                "focus-visible:border-b-primary focus-visible:shadow-none",
                "focus:placeholder:text-primary",
              )}
            />
          </div>
        </div>

        {/* Right: Create + Bell + Avatar */}
        <div className="ml-auto flex items-center gap-3 md:ml-auto">
          {!isStaffRole ? <div className="hidden md:block">
            <CreateReportDialog />
          </div> : null}

          <NotificationPopover />

        </div>
      </header>

      {/* Mobile search expanded */}
      {searchOpen && (
        <div className="px-5 py-4 pt-2 md:hidden">
          <div className="group relative w-full">
            <SearchIcon
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary"
            />
            <Input
              type="text"
              aria-label="Search reports and community updates"
              placeholder="Search reports, posts, or residents"
              className={cn(
                "h-10 rounded-none border-0 border-b border-border bg-transparent pl-9 text-sm shadow-none",
                "focus-visible:border-b-primary focus-visible:shadow-none",
              )}
              autoFocus
            />
          </div>
        </div>
      )}
    </>
  )
}
