import type { NotificationItem } from "@/features/dashboard/components/notification-context"

export type Filter = "all" | "unread" | "reports" | "emergencies" | "announcements"

export function typeGroup(item: NotificationItem): Exclude<Filter, "all" | "unread"> {
  if (item.category === "announcement") return "announcements"
  if (item.category === "emergency") return "emergencies"
  if (item.emergency_id || item.type.startsWith("emergency") || item.type === "witness_alert") return "emergencies"
  if (item.type === "announcement") return "announcements"
  return "reports"
}
