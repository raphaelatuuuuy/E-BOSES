"use client"

import { Bell } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { useNotifications } from "@/features/dashboard/components/notification-context"

/**
 * Bell control — navigates to full notifications page (mobile + desktop main column).
 *
 * `tone="dark"` is for the responder shell (right rail, dark mobile header).
 * The light styling below is hardcoded neutral rather than tokenised, so on the
 * `.staff-dark` scope the bell rendered near-black-on-black and its count chip
 * used white text on orange (2.86:1 — fails AA). The dark tone routes both
 * through nav tokens instead.
 */
export function NotificationPopover({ tone = "light" }: { tone?: "light" | "dark" }) {
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const isNotificationsRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/dashboard/notifications")
  const dark = tone === "dark"

  return (
    <button
      type="button"
      onClick={() => navigate("/dashboard/notifications")}
      className={cn(
        "group relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
        dark ? "hover:bg-nav-raised" : "hover:bg-neutral-50",
      )}
      aria-label={
        unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : "Open notifications"
      }
      aria-current={isNotificationsRoute ? "page" : undefined}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center transition-opacity duration-150",
          dark ? "size-5" : "size-7",
          dark
            ? isNotificationsRoute
              ? "text-brand-orange"
              : "text-nav-muted group-hover:text-nav-text-active"
            : cn(
                "text-neutral-700",
                isNotificationsRoute
                  ? "opacity-100"
                  : "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
              ),
        )}
        aria-hidden="true"
      >
        <Bell className="size-full" />
      </span>
      {unreadCount > 0 ? (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] font-bold",
            dark
              ? "bg-brand-orange text-brand-orange-ink"
              : "bg-[#ff6a1a] text-white",
          )}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}
