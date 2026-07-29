"use client"

import { Bell } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { useNotifications } from "@/features/dashboard/components/notification-context"

/**
 * Bell control — navigates to full notifications page (mobile + desktop main column).
 */
export function NotificationPopover() {
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const isNotificationsRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/dashboard/notifications")

  return (
    <button
      type="button"
      onClick={() => navigate("/dashboard/notifications")}
      className="group relative flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-50"
      aria-label="Open notifications"
      aria-current={isNotificationsRoute ? "page" : undefined}
    >
      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center text-neutral-700 transition-opacity duration-150",
          isNotificationsRoute
            ? "opacity-100"
            : "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
        )}
        aria-hidden="true"
      >
        <Bell className="size-full" />
      </span>
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a1a] px-0.5 text-[10px] font-bold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}
