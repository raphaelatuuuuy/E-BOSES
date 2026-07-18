"use client"

import { useNavigate } from "react-router-dom"

import { BoxBellIcon } from "@/components/box-bell-icon"
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
      <BoxBellIcon sizeClass="size-7" active={isNotificationsRoute} />
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a1a] px-0.5 text-[10px] font-bold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}
