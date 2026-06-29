import { BellIcon, PlusIcon, SearchIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function Topbar() {
  return (
    <div className="flex h-16 items-center justify-between px-6">
      {/* Left: Search */}
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-3 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search"
          className={cn(
            "w-64 bg-transparent py-2 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground",
            "border-b border-transparent focus:border-border/50 transition-colors",
          )}
        />
      </div>

      {/* Right: Create + Notification */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <PlusIcon className="size-4" />
          Create
        </button>

        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BellIcon className="size-5" />
        </button>
      </div>
    </div>
  )
}
