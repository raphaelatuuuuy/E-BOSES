import { SearchIcon, XIcon, CircleUserIcon, LogOutIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { useAuthSession } from "@/features/auth/auth-session"

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()

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
  const isStaffRole = user?.role === "barangay_official" || user?.role === "first_responder" || user?.is_staff || user?.is_superuser

  function handleSignOut() {
    signOut()
    navigate("/")
  }

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

          <div className="relative">
            <Popover>
            <PopoverTrigger className="hidden sm:flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-bold text-muted-foreground transition-colors hover:bg-muted/80">
              {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" /> : initials}
            </PopoverTrigger>
            <PopoverContent className="right-0 left-auto min-w-48 sm:w-auto max-sm:w-[calc(100vw-2rem)] max-sm:mx-2">
              <div className="p-3">
                <div className="flex items-center gap-3 border-b border-border/50 pb-3">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-bold text-muted-foreground">
                    {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" /> : initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {displayRole}
                    </p>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <Link
                    to="/dashboard/profile"
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <CircleUserIcon className="size-4 shrink-0" />
                    <span>Profile</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <LogOutIcon className="size-4 shrink-0" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            </PopoverContent>
            </Popover>
          </div>
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
