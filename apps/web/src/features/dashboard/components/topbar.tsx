import { SearchIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <>
      <header className="flex h-16 items-center bg-background/95 px-4 md:relative md:gap-3 md:px-10">
        {/* Left: Search icon (mobile) */}
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Toggle search"
          >
            {searchOpen ? <XIcon className="size-5" /> : <SearchIcon className="size-5" />}
          </button>
        </div>

        {/* Spacer on mobile so logo can center absolutely */}
        <div className="flex-1 md:hidden" />

        {/* Logo — absolutely centered on mobile, left on desktop */}
        <img
          src="/contents/logo.png"
          alt="E-Boses"
          className="size-10 object-contain max-md:absolute max-md:left-1/2 max-md:-translate-x-1/2 md:mx-0"
        />

        {/* Spacer on mobile so logo can center absolutely */}
        <div className="flex-1 md:hidden" />

        {/* Desktop search — absolutely centered relative to the header */}
        <div className="hidden md:absolute md:left-1/2 md:flex md:w-full md:max-w-lg md:-translate-x-1/2">
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
              )}
            />
          </div>
        </div>

        {/* Right: Create + Notification */}
        <div className="flex items-center gap-3 md:ml-auto">
          <div className="hidden md:block">
            <CreateReportDialog />
          </div>
          <NotificationPopover />
        </div>
      </header>

      {/* Mobile search expanded */}
      {searchOpen && (
        <div className="border-b border-border/60 bg-background/95 px-4 pb-4 pt-2 md:hidden">
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
