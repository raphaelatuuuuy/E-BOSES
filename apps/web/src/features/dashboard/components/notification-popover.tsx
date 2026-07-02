import { useState } from "react"
import { BellIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

const tabs = ["All", "Announcements", "Alerts"] as const

export function NotificationPopover() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("All")

  return (
    <div className="relative">
      <Popover>
        <PopoverTrigger
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
          aria-label="Open notifications"
        >
          <BellIcon aria-hidden="true" className="size-5" />
        </PopoverTrigger>

        <PopoverContent className="w-80 max-sm:w-[calc(100vw-2rem)] max-sm:right-0 max-sm:left-auto max-sm:mx-2 right-0 left-auto max-h-[calc(100vh-80px)] overflow-y-auto">
          {/* Header */}
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 border-b px-3 py-2" role="tablist" aria-label="Notification filters">
            {tabs.map((tab) => (
              <Button
                key={tab}
                type="button"
                size="sm"
                variant={activeTab === tab ? "default" : "ghost"}
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn("h-7 rounded-full px-3 text-xs", activeTab !== tab && "text-muted-foreground")}
              >
                {tab}
              </Button>
            ))}
          </div>

          {/* Empty state */}
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <BellIcon aria-hidden="true" className="size-8 opacity-40" />
            <p className="text-sm">No notifications yet</p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
