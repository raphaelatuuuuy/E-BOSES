import { type NavigateFunction } from "react-router-dom"

import { type NotificationItem } from "@/features/dashboard/components/notification-context"
import { type NotificationsConfig } from "@/features/dashboard/components/notifications/notifications-panel"

/**
 * The resident's notifications configuration for the shared panel — used by
 * the standalone notifications page and the resident pop-up dialog/sheet so
 * both surfaces are identical.
 */

export const RESIDENT_NOTIFICATION_FILTERS = [
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
]

function typeGroup(item: NotificationItem): string | null {
  if (item.category === "announcement" || item.type === "announcement") return "announcements"
  if (
    item.category === "emergency" ||
    item.emergency_id ||
    item.type.startsWith("emergency") ||
    item.type === "witness_alert"
  ) {
    return "emergencies"
  }
  return "reports"
}

export function createResidentNotificationsConfig(
  navigate: NavigateFunction,
): NotificationsConfig {
  return {
    heading: "Your updates",
    filters: RESIDENT_NOTIFICATION_FILTERS,
    groupOf: typeGroup,
    filterStorageKey: "eboses:resident-notifications-filter",
    landingCopy:
      "Report updates, emergency activity, and barangay announcements will appear here.",
    onOpen: (item) => {
      if (item.safety_limited || item.type === "witness_alert") return
      if (item.emergency_id) {
        window.dispatchEvent(
          new CustomEvent("eboses:open-emergency-tracking", {
            detail: { emergencyId: item.emergency_id },
          }),
        )
        return
      }
      if (item.action_url) {
        navigate(item.action_url)
        return
      }
      if (item.concern_id) {
        navigate(`/dashboard/reports/${item.concern_public_id || item.concern_id}`)
        return
      }
      navigate("/dashboard/home")
    },
  }
}
