import { TriangleAlertIcon, Asterisk, Info, type LucideIcon } from "lucide-react"

import type { NotificationItem } from "@/features/dashboard/components/notification-context"

export type NotificationVisual = {
  Icon: LucideIcon
  chipClass: string
  iconBgClass: string
}

export function isConversationNotification(item: NotificationItem) {
  const type = item.type ?? ""
  return item.category === "chat" || type === "chat_message"
}

export function isEmergencyNotification(item: NotificationItem) {
  const type = item.type ?? ""
  if (isConversationNotification(item)) return false
  return (
    item.category === "emergency" ||
    Boolean(item.emergency_id) ||
    type.startsWith("emergency") ||
    type === "witness_alert"
  )
}

export function notificationActionLink(item: NotificationItem): string | null {
  const type = item.type ?? ""
  if (type === "witness_alert") return "View Incident"
  if (type.startsWith("emergency_") && type.includes("appeal")) {
    if (type.includes("approved")) return "View Incident"
    if (type.includes("denied")) return "View Incident"
  }
  if (type === "resolved") return "View Report"
  if (type === "rejected") return "View Details"
  if (type === "clarification_requested") return "Reply"
  if (type === "appeal_approved") return "View Report"
  if (type === "appeal_denied") return "View Details"
  if (type === "concern_mention") return "View Thread"
  return null
}

export function notificationIconFor(item: NotificationItem): NotificationVisual {
  if (item.type === "witness_alert") {
    return { Icon: Asterisk, chipClass: "", iconBgClass: "" }
  }
  if (isEmergencyNotification(item)) {
    return { Icon: TriangleAlertIcon, chipClass: "", iconBgClass: "" }
  }
  return { Icon: Info, chipClass: "", iconBgClass: "" }
}
